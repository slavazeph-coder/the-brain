"""Build the fly feeding circuit the Fly Brain toy simulates.

Cuts a small, checkable slice out of the published FlyWire (v783) fruit-fly
connectome: every neuron within two strong hops (>= 5 synapses) downstream of
the 21 sugar and 21 bitter gustatory receptor neurons and the MN9 proboscis
motor neuron used by Shiu et al. (Nature 2024), plus every connection among
them. That slice (2,621 neurons, 195,759 connections) reproduces the paper's
headline result in the browser-sized LIF model: sugar drives MN9, bitter
leaves it silent. `flyCircuit.test.js` holds that line.

Inputs (put them in one folder and pass it as the first argument):
  Connectivity_783.parquet, Completeness_783.csv
      from https://github.com/philshiu/Drosophila_brain_model (MIT code;
      the wiring is FlyWire data — see public/fly/ATTRIBUTION.md)
  coordinates.csv.gz, classification.csv.gz
      from https://storage.googleapis.com/flywire-data/codex/data/fafb/783/
  brain_mesh.frag
      https://storage.googleapis.com/flywire_neuropil_meshes/whole_neuropil/brain_mesh_v141.surf/mesh/1:0:0

  python3 scripts/fly/build-fly-circuit.py <input-dir> [public/fly/feeding-circuit.bin.gz]

Needs numpy, pandas, pyarrow and pyfqmr (mesh decimation).

Output layout (little endian; every section starts 4-byte aligned):
  char[4]   magic "FLY1"
  uint32    N neurons, M connections, V mesh vertices, T mesh triangles
  float32   bbox min xyz, bbox max xyz (micrometres, FlyWire space)
  uint32    row pointers [N + 1]       (CSR by presynaptic neuron)
  uint16    postsynaptic index [M]
  int16     signed weight [M]          (synapse count x +1 excitatory / -1 inhibitory)
  int16     neuron position [N * 3]    (quantised to the bbox)
  uint8     neuron kind [N]            (see KINDS)
  int16     mesh vertex [V * 3]        (quantised to the bbox)
  uint16    mesh triangle index [T * 3]
"""
import gzip
import struct
import sys

import numpy as np
import pandas as pd
import pyfqmr

SUGAR = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768,
         720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691,
         720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543,
         720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
         720575940611875570]
BITTER = [720575940621778381, 720575940602353632, 720575940617094208, 720575940619197093, 720575940626287336,
          720575940618600651, 720575940627692048, 720575940630195909, 720575940646212996, 720575940610483162,
          720575940645743412, 720575940627578156, 720575940622298631, 720575940621008895, 720575940629146711,
          720575940610259370, 720575940610481370, 720575940619028208, 720575940614281266, 720575940613061118,
          720575940604027168]
MN9 = 720575940660219265

# Neuron kinds, shared with flyCircuit.js. 1-3 are the stimulus/readout cells;
# the rest are FlyWire super classes, used only for colour.
KINDS = {'sugar': 1, 'bitter': 2, 'mn9': 3, 'sensory': 4, 'ascending': 5, 'descending': 6, 'motor': 7,
         'central': 8, 'optic': 9, 'visual_projection': 10, 'visual_centrifugal': 11, 'endocrine': 12}
MESH_TRIANGLES = 2400


def align(buf):
    buf.extend(b'\0' * (-len(buf) % 4))


def main():
    src = sys.argv[1].rstrip('/')
    out = sys.argv[2] if len(sys.argv) > 2 else 'public/fly/feeding-circuit.bin.gz'

    conn = pd.read_parquet(f'{src}/Connectivity_783.parquet')
    ids = pd.read_csv(f'{src}/Completeness_783.csv', index_col=0).index.values.astype(np.int64)
    index_of = {root: i for i, root in enumerate(ids)}
    stim = [index_of[root] for root in SUGAR + BITTER + [MN9] if root in index_of]

    # Two strong hops downstream of the taste neurons and MN9.
    strong = conn[conn.Connectivity >= 5]
    kept, frontier = set(stim), set(stim)
    for _ in range(2):
        nxt = set(strong[strong.Presynaptic_Index.isin(frontier)].Postsynaptic_Index.unique()) - kept
        kept |= nxt
        frontier = nxt
    nodes = np.array(sorted(kept))
    keep = np.zeros(len(ids), bool)
    keep[nodes] = True
    edges = conn[keep[conn.Presynaptic_Index.values] & keep[conn.Postsynaptic_Index.values]]
    remap = -np.ones(len(ids), np.int64)
    remap[nodes] = np.arange(len(nodes))
    pre = remap[edges.Presynaptic_Index.values]
    post = remap[edges.Postsynaptic_Index.values]
    weight = edges['Excitatory x Connectivity'].values
    order = np.lexsort((post, pre))
    pre, post, weight = pre[order], post[order], weight[order]
    n, m = len(nodes), len(post)
    ptr = np.zeros(n + 1, np.int64)
    np.add.at(ptr, pre + 1, 1)
    ptr = np.cumsum(ptr)
    roots = ids[nodes]

    # Where each neuron is (a point on it, nanometres -> micrometres) and what it is.
    coords = pd.read_csv(f'{src}/coordinates.csv.gz').drop_duplicates('root_id').set_index('root_id')
    classes = pd.read_csv(f'{src}/classification.csv.gz').drop_duplicates('root_id').set_index('root_id')
    positions = np.zeros((n, 3), np.float64)
    kinds = np.zeros(n, np.uint8)
    for i, root in enumerate(roots):
        if root in coords.index:
            positions[i] = np.array(coords.at[root, 'position'].strip('[]').split(), float) / 1000
        else:
            positions[i] = np.nan
        if root in classes.index:
            kinds[i] = KINDS.get(str(classes.at[root, 'super_class']), 0)
    for root in SUGAR:
        if root in index_of and keep[index_of[root]]:
            kinds[remap[index_of[root]]] = KINDS['sugar']
    for root in BITTER:
        if root in index_of and keep[index_of[root]]:
            kinds[remap[index_of[root]]] = KINDS['bitter']
    kinds[remap[index_of[MN9]]] = KINDS['mn9']
    missing = np.isnan(positions).any(1)
    positions[missing] = np.nanmean(positions, 0)

    # The brain's outline: weld the triangle soup, then decimate.
    raw = open(f'{src}/brain_mesh.frag', 'rb').read()
    count = struct.unpack('<I', raw[:4])[0]
    vertices = np.frombuffer(raw[4:4 + 12 * count], np.float32).reshape(-1, 3).astype(np.float64) / 1000
    faces = np.frombuffer(raw[4 + 12 * count:], np.uint32).reshape(-1, 3)
    welded, inverse = np.unique(np.round(vertices, 3), axis=0, return_inverse=True)
    faces = inverse.reshape(-1)[faces]
    simplifier = pyfqmr.Simplify()
    simplifier.setMesh(welded, faces)
    simplifier.simplify_mesh(target_count=MESH_TRIANGLES, aggressiveness=6, preserve_border=True, verbose=0)
    mesh_v, mesh_f, _ = simplifier.getMesh()

    lo = np.minimum(mesh_v.min(0), positions.min(0)) - 5
    hi = np.maximum(mesh_v.max(0), positions.max(0)) + 5
    quantise = lambda points: np.round((points - lo) / (hi - lo) * 65534 - 32767).astype(np.int16)

    buf = bytearray(b'FLY1')
    buf += struct.pack('<4I', n, m, len(mesh_v), len(mesh_f))
    buf += struct.pack('<6f', *lo, *hi)
    buf += ptr.astype(np.uint32).tobytes()
    buf += post.astype(np.uint16).tobytes()
    align(buf)
    buf += np.clip(weight, -32768, 32767).astype(np.int16).tobytes()
    align(buf)
    buf += quantise(positions).tobytes()
    align(buf)
    buf += kinds.tobytes()
    align(buf)
    buf += quantise(mesh_v).tobytes()
    align(buf)
    buf += mesh_f.astype(np.uint16).tobytes()
    align(buf)

    with open(out, 'wb') as handle:
        handle.write(gzip.compress(bytes(buf), 9, mtime=0))
    print(f'neurons {n}, connections {m}, mesh {len(mesh_v)} vertices / {len(mesh_f)} triangles, '
          f'missing positions {int(missing.sum())}, raw {len(buf)} B, gzip -> {out}')
    print('kinds', {k: int((kinds == v).sum()) for k, v in KINDS.items()}, 'other', int((kinds == 0).sum()))


if __name__ == '__main__':
    main()
