"""CPU-only adapter for the pinned ETH Zurich foothold predictor, NOT its policy.

Only the known upstream TorchScript bytes are loadable. No arbitrary model file,
remote job, ROS transport, or actuator output is accepted by this adapter.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request

REPO = 'leggedrobotics/foothold-prediction-model'
REVISION = '20009c33639a55c100c21e0c4747bec13b22f161'
FILES = {
    'demo/foot_model_10002.pt': (121778, '50704c50fec735bce9e22e27ed071bd3dd9187df'),
    'LICENSE': (1067, 'b20650b4ea7ce273fd1671cdf85a0cc6dbf1095c'),
}
LAYOUT = 'fpm-system-state-70-v1'


def verified_bytes(path, relative):
    size, oid = FILES[relative]
    if path.is_symlink() or path.stat().st_size != size:
        raise ValueError('Model or license size/path mismatch.')
    data = path.read_bytes()
    if hashlib.sha1(f'blob {size}\0'.encode() + data).hexdigest() != oid:
        raise ValueError('Bytes do not match the pinned upstream Git blob.')
    return data


def download(destination, license_reviewed=False):
    if license_reviewed is not True:
        raise ValueError('Explicit MIT license review required before download.')
    destination = Path(destination)
    if destination.exists():
        raise ValueError('Choose a new model directory; existing files are never overwritten.')
    destination.mkdir(parents=True)
    receipt = {'repository': REPO, 'revision': REVISION, 'license': 'MIT', 'files': []}
    for relative, (size, _) in FILES.items():
        url = f'https://raw.githubusercontent.com/{REPO}/{REVISION}/{relative}'
        with urllib.request.urlopen(url, timeout=45) as response:
            if not response.geturl().startswith(f'https://raw.githubusercontent.com/{REPO}/{REVISION}/'):
                raise ValueError('Unexpected upstream redirect.')
            data = response.read(size + 1)
        target = destination / Path(relative).name
        with target.open('xb') as out:
            out.write(data)
        verified_bytes(target, relative)
        receipt['files'].append({'name': target.name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    (destination / 'source-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def predict(model_directory, payload):
    if not isinstance(payload, dict) or payload.get('layout') != LAYOUT or payload.get('joint_order_reviewed') is not True:
        raise ValueError('Explicit upstream system-state layout and reviewed joint order required.')
    rows = payload.get('states')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 128 or any(not isinstance(row, list) or len(row) != 70 for row in rows):
        raise ValueError('Expected 1 to 128 rows of exactly 70 system-state values.')
    import math
    if any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 10000 for row in rows for v in row):
        raise ValueError('State values must be finite bounded numbers, not booleans.')
    directory = Path(model_directory)
    data = verified_bytes(directory / 'foot_model_10002.pt', 'demo/foot_model_10002.pt')
    verified_bytes(directory / 'LICENSE', 'LICENSE')
    # Verification is performed BEFORE deserializing the executable TorchScript.
    import torch
    model = torch.jit.load(io.BytesIO(data), map_location='cpu').eval()
    with torch.inference_mode():
        output = model(torch.tensor(rows, dtype=torch.float32))
    if tuple(output.shape) != (len(rows), 4) or not torch.isfinite(output).all() or (output.abs() > 10).any():
        raise ValueError('Predictor returned invalid planar footholds.')
    return {'schema': 'brainsnn.fpm-predictions.v1', 'repository': REPO, 'revision': REVISION,
            'model_sha256': hashlib.sha256(data).hexdigest(), 'layout': LAYOUT,
            'footholds_base_xy_m': output.reshape(-1, 2, 2).tolist(), 'runtime': 'torch-cpu',
            'torch_version': torch.__version__, 'prediction_executed': True,
            'locomotion_policy_executed': False, 'physics_executed': False, 'robot_control_enabled': False,
            'warnings': ['Predictions describe this G1 gait; they are not safe foothold targets.',
                         'Body-frame predictions require the actual base and sensor transforms before sampling.',
                         '70 values must use unscaled SystemStateCfg order, not scaled actor observations.',
                         'No terrain accuracy, stability, checkpoint transfer or robot behavior is certified.']}



def observe(model_directory, payload, cloud, query):
    """Execute the actual predictor, then inspect its two patches in a scan snapshot.

    This bounded first adapter accepts only an upright body and coincident
    yaw-only sensor. It does not approximate tilted-body transforms silently.
    """
    import sys
    sys.dont_write_bytecode = True  # Research tools may live in an immutable pack.
    try:
        from .foothold_perception import inspect_cloud
    except ImportError:
        from foothold_perception import inspect_cloud
    if not isinstance(payload, dict) or not isinstance(payload.get('states'), list) or len(payload['states']) != 1:
        raise ValueError('Snapshot observation requires exactly one robot state.')
    state = payload['states'][0]
    if not isinstance(state, list) or len(state) != 70:
        raise ValueError('Expected the upstream 70-value system state.')
    if any(type(v) not in (int, float) for v in state[6:9]) or any(not abs(v-e) <= .01 for v,e in zip(state[6:9], [0,0,-1])):
        raise ValueError('Snapshot integration requires an upright body; tilted transforms are not approximated.')
    predictions = predict(model_directory, payload)
    if not isinstance(query, dict):
        raise ValueError('Explicit source-frame base position and yaw required.')
    request = {**query, 'footholds_base_xy_m': predictions['footholds_base_xy_m'][0]}
    report = inspect_cloud(cloud, request)
    report.update(foothold_basis='pinned-pretrained-fpm', prediction=predictions)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0]); sub = p.add_subparsers(dest='command', required=True)
    d = sub.add_parser('download'); d.add_argument('--out', type=Path, required=True); d.add_argument('--license-reviewed', action='store_true')
    r = sub.add_parser('predict'); r.add_argument('--model-dir', type=Path, required=True)
    r.add_argument('--state', type=Path, required=True); r.add_argument('--out', type=Path, required=True)
    r.add_argument('--cloud', type=Path); r.add_argument('--query', type=Path)
    a = p.parse_args()
    if a.command == 'download':
        print(json.dumps(download(a.out, a.license_reviewed))); return
    if a.state.stat().st_size > 512 * 1024:
        raise ValueError('State input too large.')
    payload = json.loads(a.state.read_bytes())
    if bool(a.cloud) != bool(a.query):
        raise ValueError('Provide both --cloud and --query, or neither.')
    if a.cloud:
        if a.cloud.stat().st_size > 64 * 1024**2 or a.query.stat().st_size > 16384:
            raise ValueError('Terrain or query file too large.')
        raw = a.cloud.read_bytes(); query_raw = a.query.read_bytes()
        result = observe(a.model_dir, payload, json.loads(raw), json.loads(query_raw))
        result['source_cloud_sha256'] = hashlib.sha256(raw).hexdigest()
        result['query_sha256'] = hashlib.sha256(query_raw).hexdigest()
    else:
        result = predict(a.model_dir, payload)
    with a.out.open('x') as out:
        json.dump(result, out, indent=2, allow_nan=False); out.write('\n')
    print(json.dumps({'prediction_executed': True, 'robot_control_enabled': False, 'rows': len(payload['states'])}))


if __name__ == '__main__':
    main()
