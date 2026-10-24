"""BrainSNN scene compiler — stage 1 (Blender headless, GB10).

Turns what the World Builder already exports into a simulation-ready scene:

  in : Arena point-cloud JSON  (brainsnn-point-cloud.json: points [x,y,z,r,g,b], units, floorEstimate, scale)
       observation sidecar JSON (optional: on-device detections, 2D boxes per frame, COCO labels)
       camera model for the sidecar frame (fov degrees; the site's depth path uses 60)
  out: scene.glb  (browser Arena / three.js)       scene.usda  (Isaac Sim / Omniverse, written directly)
       scene.json (every object: label, box, centre, size, provenance: observed | detected | unknown)
       In metres, every cluster of points above the floor that is not a wall becomes its own measured object.

Everything here is derived from observed geometry. Nothing is invented: unseen space is exported as an
explicit "unknown" volume, never as free floor. Inferred fill (stage 2) will be a separate, tagged layer.

Run:  blender -b --python scene_compiler.py -- --cloud X.json [--detections Y.json --fov 60] --out DIR
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ifc_export import emit_ifc  # noqa: E402  (pure Python; runs inside Blender too)

try:
    import bpy
except ImportError:  # pure-geometry functions stay importable for tests outside Blender
    bpy = None


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--cloud", required=True); p.add_argument("--detections"); p.add_argument("--fov", type=float, default=60.0)
    p.add_argument("--out", required=True); p.add_argument("--min-cluster", type=int, default=12)
    p.add_argument("--allow-unverified", action="store_true", help="compile non-multi-view clouds anyway (experiments only)")
    return p.parse_args(argv)


# ---------- geometry helpers (pure python; clouds are ≤50k points) ----------
UNKNOWN_CELL = 0.5
# The unknown-space pass visits every cell of the 2–98% footprint. 250,000 cells is 250 × 250 m at 0.5 m: anything larger
# is a wrong scale or stray points, not a room, and would only tie up the worker. The worker checks the same bound at upload.
MAX_GRID_CELLS = 250_000


def grid_cells(ex, ez, cell=UNKNOWN_CELL):
    """Unknown-space cells spanned by the footprint [x0, x1] × [z0, z1]."""
    # At least one cell per axis: the pass loops over every x cell even when the z range is empty.
    return max(1, math.ceil(ex[1] / cell) - math.floor(ex[0] / cell)) * max(1, math.ceil(ez[1] / cell) - math.floor(ez[0] / cell))


def multi_view(cloud):
    """COLMAP clouds are multi-view by construction; other frames (dense MapAnything) must declare it."""
    return cloud.get("sourceFrame") == "colmap" or cloud.get("multiView") is True


def percentile(v, q):
    s = sorted(v); i = (len(s) - 1) * q; lo = math.floor(i); return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (i - lo)


def floor_plane(pts, floor):
    """Floor y from the hand-off's RANSAC estimate when present, else the 5th percentile of y (lowest dense layer)."""
    if floor and isinstance(floor.get("y"), (int, float)): return float(floor["y"])
    return percentile([p[1] for p in pts], 0.05)


def floor_margin(pts, floor_y):
    """How far above the floor plane points still belong to the floor: twice the floor layer's own scatter, between 5
    and 15 cm. Sparse points sit on the floor to a centimetre; dense model-depth points scatter several centimetres."""
    near = sorted(p[1] - floor_y for p in pts if abs(p[1] - floor_y) < 0.3)
    if len(near) < 20: return 0.05
    return min(0.15, max(0.05, percentile(near, 0.84) - percentile(near, 0.16)))


# Walls are found from points above most furniture (1.3–2.3 m over the floor) as vertical planes, then given every point
# along that stretch within 2.5 times the wall's own scatter (WALL_TOLERANCE to 15 cm) of the plane. A wall is at least a
# metre long and 1.2 m tall. A line whose points mostly lie along a wall already found (within its band plus 5 cm) is
# that wall again, seen through noisy depth, not another wall.
WALL_HIGH, WALL_TOP, WALL_TOLERANCE, WALL_MIN_LENGTH, WALL_MIN_HEIGHT, WALL_LIMIT = 1.3, 2.3, 0.06, 1.0, 1.2, 8


def along_wall(w, XZ):
    """The share of plan points XZ (N × 2) lying on wall w: within its band (plus 5 cm) of its line and its length."""
    import numpy as np
    d = np.array([math.cos(w["yaw"]), math.sin(w["yaw"])]); n = np.array([-d[1], d[0]]); rel = XZ - np.array(w["centre"])
    return float(((np.abs(rel @ n) < w["band"] + 0.05) & (np.abs(rel @ d) < w["length"] / 2 + 0.2)).mean())


def find_walls(pts, floor_y, margin=0.05, iterations=400, seed=0):
    """Walls by RANSAC on vertical planes. Returns (walls, rest): walls with centre (x, z), yaw, length, thickness, y0, y1,
    support and member indices; rest, the indices of points above the floor margin that belong to no wall."""
    import numpy as np
    P = np.asarray([p[:3] for p in pts], float); rng = np.random.default_rng(seed)
    above = np.flatnonzero(P[:, 1] > floor_y + margin)
    high = above[(P[above, 1] > floor_y + WALL_HIGH) & (P[above, 1] < floor_y + WALL_TOP)]
    taken = np.zeros(len(P), bool); tried = np.zeros(len(P), bool); walls, attempts = [], 0
    while len(walls) < WALL_LIMIT and attempts < 2 * WALL_LIMIT:
        pool = high[~taken[high] & ~tried[high]]
        if len(pool) < 20: break
        attempts += 1; XZ = P[pool][:, [0, 2]]; best, best_count = None, 0
        for _ in range(iterations):
            i, j = rng.choice(len(pool), 2, replace=False); d = XZ[j] - XZ[i]; length = math.hypot(*d)
            if length < 0.3: continue
            normal = np.array([-d[1], d[0]]) / length; count = int((np.abs((XZ - XZ[i]) @ normal) < WALL_TOLERANCE).sum())
            if count > best_count: best, best_count = (XZ[i], normal), count
        if best is None or best_count < max(20, 0.02 * len(high)): break
        inl = np.abs((XZ - best[0]) @ best[1]) < WALL_TOLERANCE
        Q = XZ[inl]; centre = Q.mean(0); _, _, vt = np.linalg.svd(Q - centre, full_matrices=False)  # refit the line
        direction, normal = vt[0], np.array([-vt[0][1], vt[0][0]])
        along = (Q - centre) @ direction; a0, a1 = np.percentile(along, [2, 98])
        near = np.abs((XZ - centre) @ normal); band = min(0.15, max(WALL_TOLERANCE, 2.5 * float(np.median(near[near < 0.15])) * 1.4826))
        rel = P[above][:, [0, 2]] - centre; t, n = rel @ direction, rel @ normal
        members = above[(np.abs(n) < band) & (t > a0 - 0.1) & (t < a1 + 0.1) & ~taken[above]]
        tried[pool[inl]] = True  # a rejected line is not sampled again, but its points stay free for objects
        if any(along_wall(w, Q) > 0.5 for w in walls):
            taken[pool[inl]] = True; continue  # the scatter of a wall already found
        if a1 - a0 < WALL_MIN_LENGTH or len(members) < 20: continue
        y0, y1 = floor_y, float(np.percentile(P[members, 1], 98))
        if y1 - y0 < WALL_MIN_HEIGHT: continue
        taken[members] = True; spread = n[np.isin(above, members)]
        mid = centre + direction * (a0 + a1) / 2
        walls.append({"centre": [float(mid[0]), float(mid[1])], "yaw": math.atan2(direction[1], direction[0]), "length": float(a1 - a0),
                      "thickness": max(0.1, float(np.percentile(spread, 90) - np.percentile(spread, 10))), "y0": y0, "y1": y1,
                      "support": int(len(members)), "band": band, "members": members.tolist()})
    return walls, [int(i) for i in above if not taken[i]]


# Object separation works in metres: 10 cm cells, up to 2.4 m above the floor (higher is ceiling and wall tops).
OBJECT_CELL, OBJECT_MAX_HEIGHT, OBJECT_LIMIT = 0.1, 2.4, 200


def object_box(P, floor_y):
    """A box oriented by PCA in plan around points P (rows x, y, z, ...), trimmed to the 3–97% extents so a few stray
    points do not inflate it. Its long side is `length`. An object whose lowest points are within 0.3 m of the floor
    stands on it, so its box starts at the floor."""
    mx, mz = sum(p[0] for p in P) / len(P), sum(p[2] for p in P) / len(P)
    def extents(yaw):
        ca, sa = math.cos(yaw), math.sin(yaw)
        along = [(p[0] - mx) * ca + (p[2] - mz) * sa for p in P]; across = [-(p[0] - mx) * sa + (p[2] - mz) * ca for p in P]
        return percentile(along, 0.03), percentile(along, 0.97), percentile(across, 0.03), percentile(across, 0.97)
    # The smallest trimmed rectangle over 5-degree steps: PCA alone picks an arbitrary axis for a square footprint.
    yaw = min((math.radians(d) for d in range(0, 90, 5)), key=lambda t: (lambda e: (e[1] - e[0]) * (e[3] - e[2]))(extents(t)))
    a0, a1, b0, b1 = extents(yaw)
    if b1 - b0 > a1 - a0: yaw += math.pi / 2; a0, a1, b0, b1 = extents(yaw)  # length is the long side
    ca, sa = math.cos(yaw), math.sin(yaw)
    ys = [p[1] for p in P]; y0, y1 = percentile(ys, 0.03), percentile(ys, 0.97)
    ac, bc = (a0 + a1) / 2, (b0 + b1) / 2
    return {"centre": [mx + ac * ca - bc * sa, mz + ac * sa + bc * ca], "yaw": yaw, "length": max(a1 - a0, 0.02),
            "thickness": max(b1 - b0, 0.02), "y0": floor_y if y0 - floor_y < 0.3 else y0, "y1": y1, "support": len(P)}


def separate_objects(pts, floor_y, candidates, cell=OBJECT_CELL, min_points=None, limit=OBJECT_LIMIT):
    """Every cluster of the candidate points (above the floor, in no wall) below OBJECT_MAX_HEIGHT, as its own measured
    object: occupied cells joined through their faces (a diagonal touch does not join two objects), each cluster fitted
    with object_box. Clusters smaller than min_points (0.3% of the cloud, at least 30), under 15 cm long or 5 cm thick
    stay points. Largest first, with member indices."""
    top = floor_y + OBJECT_MAX_HEIGHT
    min_points = min_points or max(30, round(0.003 * len(pts)))
    cells = {}
    for i in candidates:
        p = pts[i]
        if p[1] < top:
            cells.setdefault((math.floor(p[0] / cell), math.floor(p[1] / cell), math.floor(p[2] / cell)), []).append(i)
    seen, objects = set(), []
    for k in cells:
        if k in seen: continue
        members, stack = [], [k]; seen.add(k)
        while stack:
            c = stack.pop(); members += cells[c]
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                n = (c[0] + dx, c[1] + dy, c[2] + dz)
                if n in cells and n not in seen: seen.add(n); stack.append(n)
        if len(members) < min_points: continue
        box = object_box([pts[i] for i in members], floor_y)
        if box["length"] < 0.15 or box["thickness"] < 0.05 or box["y1"] - box["y0"] < 0.1: continue  # slivers stay points
        box["members"] = members; objects.append(box)
    objects.sort(key=lambda o: -o["support"])
    return objects[:limit]


def label_objects(objects, pts, placed):
    """Name separated objects from lifted detections: a detection labels the object with the most of its points inside
    the detection's box, if that is at least 30% of the object. Returns the detections that labelled nothing."""
    left = []
    for det in placed:
        lo, hi = det["min"], det["max"]
        inside = lambda p: all(lo[i] <= p[i] <= hi[i] for i in range(3))
        scores = [(sum(1 for i in o["members"] if inside(pts[i])) / len(o["members"]), n) for n, o in enumerate(objects) if "label" not in o]
        best = max(scores, default=(0, None))
        if best[0] >= 0.3:
            objects[best[1]].update(label=det["label"], detector=det["detector"])
        else:
            left.append(det)
    return left


def unproject_box(box, w, h, fov, depth_samples):
    """2D box (normalised) + depth from the cloud points that project inside it -> 3D AABB in camera frame.
    Camera: looks down -z, y up, pinhole with the given horizontal fov (matches visual-geometry.fromDepth)."""
    focal = w / (2 * math.tan(math.radians(fov) / 2))
    if not depth_samples: return None
    zs = sorted(depth_samples); z0, z1 = percentile(zs, 0.15), percentile(zs, 0.85); zc = (z0 + z1) / 2
    x0 = (box[0] * w - w / 2) / focal * zc; x1 = (box[2] * w - w / 2) / focal * zc
    y0 = -(box[3] * h - h / 2) / focal * zc; y1 = -(box[1] * h - h / 2) / focal * zc
    return [[x0, y0, -z1], [x1, y1, -z0]]


def valid_pose(m):
    """A rigid 4x4 (row-major) mapping cloud coordinates to camera coordinates: finite, orthonormal, det +1."""
    if not (isinstance(m, list) and len(m) == 4 and all(isinstance(r, list) and len(r) == 4 for r in m)): return False
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for r in m for v in r): return False
    if any(abs(a - b) > 1e-6 for a, b in zip(m[3], (0, 0, 0, 1))): return False
    R = [r[:3] for r in m[:3]]
    for i in range(3):
        for j in range(3):
            if abs(sum(R[i][k] * R[j][k] for k in range(3)) - (i == j)) > 1e-3: return False
    det = (R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
           + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]))
    return abs(det - 1) < 1e-3


def lift_detections(pts, side, fov, min_cluster):
    """Lift 2D detections into 3D boxes in the cloud's frame. The points behind a box are only meaningful in the camera
    that saw it, so each frame must carry `cameraFromCloud` (rigid 4x4, row-major, camera looking down -z with y up)
    in the cloud's own frame. Without that pose, or without a box, a detection stays `detected-unplaced` with the
    reason: nothing is guessed. Returns (placed, unplaced); placed boxes are axis-aligned in the cloud's frame."""
    frames = {f.get("id"): f for f in side.get("frames", []) if isinstance(f, dict)}
    only = next(iter(frames.values())) if len(frames) == 1 else None
    placed, unplaced = [], []
    for ob in side.get("observations", []):
        name, label = str(ob.get("id", "detection")), str(ob.get("label", "object"))
        box, frame = ob.get("box"), frames.get(ob.get("frameId")) or only
        reason = None
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)): reason = "no bounding box"
        elif not frame or not valid_pose(frame.get("cameraFromCloud")): reason = "no camera pose for this frame in the cloud's frame"
        if reason:
            unplaced.append({"name": name, "label": label, "provenance": "detected-unplaced", "reason": reason}); continue
        M, w, h = frame["cameraFromCloud"], frame["width"], frame["height"]
        focal = w / (2 * math.tan(math.radians(fov) / 2))
        cam = lambda p: [sum(M[i][k] * p[k] for k in range(3)) + M[i][3] for i in range(3)]
        inside = []
        for p in pts:
            pr = project(cam(p), w, h, focal)
            if pr and box[0] <= pr[0] <= box[2] and box[1] <= pr[1] <= box[3]: inside.append(pr[2])
        if len(inside) < min_cluster:
            unplaced.append({"name": name, "label": label, "provenance": "detected-unplaced", "reason": f"{len(inside)} supporting points"}); continue
        lo, hi = unproject_box(box, w, h, fov, inside)
        # Camera-frame corners back to the cloud's frame (inverse of a rigid transform: R^T (c - t)).
        R, t = [r[:3] for r in M[:3]], [M[i][3] for i in range(3)]
        corners = [[sum(R[k][i] * (c[k] - t[k]) for k in range(3)) for i in range(3)]
                   for c in ([x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2]))]
        placed.append({"name": f"{label}_{name}".replace(" ", "_"), "label": label, "support_points": len(inside), "detector": side.get("model", {}).get("id"),
                       "min": [min(c[i] for c in corners) for i in range(3)], "max": [max(c[i] for c in corners) for i in range(3)]})
    return placed, unplaced


def project(p, w, h, focal):
    x, y, z = p[0], p[1], p[2]
    if z >= -1e-6: return None
    return ((x / -z) * focal + w / 2) / w, ((-y / -z) * focal + h / 2) / h, -z


# ---------- blender scene ----------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"; bpy.context.scene.unit_settings.scale_length = 1.0


def add_points(pts, name="observed_points"):
    """Point cloud as a real mesh (tiny tetrahedra per point) so glTF keeps it; Blender itself holds the raw verts too."""
    me = bpy.data.meshes.new(name); verts, faces = [], []
    r = 0.03
    for p in pts:
        b = len(verts); x, y, z = p[0], -p[2], p[1]
        verts += [(x + r, y, z - r), (x - r, y, z - r), (x, y + r, z - r), (x, y, z + r)]
        faces += [[b, b + 1, b + 2], [b, b + 1, b + 3], [b + 1, b + 2, b + 3], [b, b + 2, b + 3]]
    me.from_pydata(verts, [], faces)
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, p in enumerate(pts):
        c = (p[3] / 255, p[4] / 255, p[5] / 255, 1.0)
        for j in range(4): col.data[i * 4 + j].color = c
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob["provenance"] = "observed"
    mat = bpy.data.materials.new(name + "_mat"); mat.use_nodes = True
    attr = mat.node_tree.nodes.new("ShaderNodeVertexColor"); attr.layer_name = "Col"
    mat.node_tree.links.new(attr.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"]); ob.data.materials.append(mat)
    return ob


USD_NEEDS_METRES = ("Isaac Sim reads USD in metres (metersPerUnit), and this cloud is in arbitrary units, so no scene.usda was "
                    "written. Set a measured scale in World Builder and export again.")


def write_usda(path, scene, pts):
    """Flat USD (text) for Isaac Sim / Omniverse: Y-up, metres. Boxes as Cube prims, points as a Points prim,
    provenance as custom attributes. Ubuntu's Blender 4.0 ships without the USD exporter, so this is written directly.
    Only metric scenes: metersPerUnit = 1 on arbitrary units would make every reconstruction unit a metre."""
    if scene.get("units") != "m": raise ValueError(USD_NEEDS_METRES)
    CUBE = ('    def Cube "%(name)s"\n    {\n        double size = 1\n        double3 xformOp:translate = (%(cx)s, %(cy)s, %(cz)s)\n'
            '        float3 xformOp:rotateXYZ = (0, %(yaw)s, 0)\n'
            '        float3 xformOp:scale = (%(sx)s, %(sy)s, %(sz)s)\n        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]\n'
            '        custom string provenance = "%(prov)s"\n        custom string label = "%(label)s"\n    }\n')
    def cube(prim, name=None):
        c, s = prim["centre"], prim["size"]
        return CUBE % dict(name=name or prim["name"], cx=c[0], cy=c[1], cz=c[2], sx=s[0], sy=s[1], sz=s[2], yaw=-prim.get("yaw_degrees", 0), prov=prim["provenance"], label=prim["label"])
    head = ('#usda 1.0\n(\n    defaultPrim = "World"\n    metersPerUnit = 1\n    upAxis = "Y"\n'
            '    customLayerData = { string schema = "%s", string units = "%s" }\n)\n\ndef Xform "World"\n{\n') % (scene["schema"], scene["units"])
    body = [head] + [cube(o) for o in scene["objects"] if "centre" in o] + [cube(w) for w in scene["walls"]]
    xyz = ", ".join("(%g, %g, %g)" % (p[0], p[1], p[2]) for p in pts)
    rgb = ", ".join("(%.3f, %.3f, %.3f)" % (p[3] / 255, p[4] / 255, p[5] / 255) for p in pts)
    body.append('    def Points "observed_points"\n    {\n        point3f[] points = [%s]\n        color3f[] primvars:displayColor = [%s] (interpolation = "vertex")\n'
                '        float[] widths = [0.02]\n        custom string provenance = "observed"\n    }\n' % (xyz, rgb))
    if scene["unknown"]:
        fy = scene["floor_y"]; body.append('    def Xform "unknown_space"\n    {\n        custom string provenance = "unknown"\n')
        for i, (x, z, c) in enumerate(scene["unknown"]):
            body.append(cube({"centre": [x + c / 2, fy + 0.15, z + c / 2], "size": [c, 0.3, c], "provenance": "unknown", "label": "unknown"}, name="cell_%d" % i).replace("\n    ", "\n        "))
        body.append('    }\n')
    body.append('}\n'); Path(path).write_text("".join(body))


def emit_usd(out, scene, pts):
    """Write scene.usda for a metric scene, or record why not. A reused output folder must not keep an older USD that
    scene.json no longer describes, so a skipped USD also removes any stale file."""
    path = Path(out) / "scene.usda"
    if scene.get("units") == "m":
        write_usda(path, scene, pts); scene["usd"] = {"written": True, "metersPerUnit": 1}
    else:
        path.unlink(missing_ok=True); scene["usd"] = {"written": False, "reason": USD_NEEDS_METRES}; print("NOTE:", USD_NEEDS_METRES)
    return scene["usd"]


def add_oriented_box(name, w, provenance, label, color):
    """A box rotated about the vertical axis (Y-up yaw -> Blender Z rotation): walls and separated objects."""
    cx, cz, y0, y1 = w["centre"][0], w["centre"][1], w["y0"], w["y1"]
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, -cz, (y0 + y1) / 2)); ob = bpy.context.active_object
    ob.scale = (w["length"], w["thickness"], y1 - y0); ob.rotation_euler = (0, 0, -w["yaw"]); ob.name = name
    mat = bpy.data.materials.new(name + "_mat"); mat.diffuse_color = color; ob.data.materials.append(mat)
    ob["provenance"] = provenance; ob["label"] = label; ob["support_points"] = w["support"]
    return ob, {"name": name, "label": label, "provenance": provenance, "centre": [cx, (y0 + y1) / 2, cz], "size": [w["length"], y1 - y0, w["thickness"]],
                "yaw_degrees": math.degrees(w["yaw"]), "support_points": w["support"]}


# Distinct colours for separated objects (BrainSNN purple first), so neighbouring objects read as separate in the viewer.
OBJECT_COLOURS = [(0.66, 0.33, 0.97, 1), (0.0, 0.80, 0.85, 1), (0.98, 0.70, 0.25, 1), (0.45, 0.85, 0.45, 1),
                  (0.95, 0.45, 0.60, 1), (0.40, 0.60, 1.0, 1), (0.95, 0.90, 0.40, 1), (0.80, 0.55, 1.0, 1)]


def add_box(name, lo, hi, provenance, label, color):
    """Axis-aligned box from Y-up min/max corners; Blender Z-up."""
    cx, cy, cz = (lo[0] + hi[0]) / 2, -(lo[2] + hi[2]) / 2, (lo[1] + hi[1]) / 2
    sx, sy, sz = max(hi[0] - lo[0], 0.02), max(hi[2] - lo[2], 0.02), max(hi[1] - lo[1], 0.02)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, cz)); ob = bpy.context.active_object
    ob.scale = (sx, sy, sz); ob.name = name
    mat = bpy.data.materials.new(name + "_mat"); mat.diffuse_color = color; ob.data.materials.append(mat)
    ob["provenance"] = provenance; ob["label"] = label; ob["size_m"] = [sx, sz, sy]
    return ob, {"name": name, "label": label, "provenance": provenance, "centre": [cx, cz, -cy], "size": [sx, sz, sy], "min": lo, "max": hi}


def main():
    a = args(); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    cloud = json.loads(Path(a.cloud).read_text()); pts = cloud["points"]
    metric = cloud.get("units") == "m"; k = 1.0
    # Hard gate: a single-photo relative-depth cloud has no consistent geometry (every object is a perspective wedge),
    # so compiling it produces confident nonsense (a 22 m "refrigerator" in the mezzanine test). The hand-off JSON
    # only names its frame today: 'colmap' means multi-view SfM; anything else is treated as unverified geometry.
    if not multi_view(cloud) and not a.allow_unverified:
        sys.exit("REFUSED: this cloud is not a multi-view reconstruction (sourceFrame=%r, multiView not set). The scene compiler needs "
                 "COLMAP/MapAnything/VIPE geometry from at least two views; single-photo depth is a visual preview only. Record a "
                 "walkthrough, or pass --allow-unverified for experiments." % cloud.get("sourceFrame"))
    if not metric:  # arbitrary units: keep them but say so loudly; the site's scale card is the way to fix it
        print("WARNING: cloud is in arbitrary units; exporting unscaled (scale.source = none), and no USD")
    floor_y = floor_plane(pts, cloud.get("floorEstimate"))
    xs, zs = [p[0] for p in pts], [p[2] for p in pts]
    ex = [percentile(xs, 0.02), percentile(xs, 0.98)]; ez = [percentile(zs, 0.02), percentile(zs, 0.98)]
    ceiling = percentile([p[1] for p in pts], 0.98)
    if grid_cells(ex, ez) > MAX_GRID_CELLS:
        sys.exit("REFUSED: the footprint spans %d grid cells (limit %d). Check the scale or remove stray points." % (grid_cells(ex, ez), MAX_GRID_CELLS))

    reset(); scene = {"schema": "brainsnn.scene.v1", "units": "m" if metric else "arbitrary", "scale": cloud.get("scale"),
                      "source": cloud.get("source"), "floor_y": floor_y, "objects": [], "walls": [], "unknown": []}
    add_points(pts)
    # Floor: the observed footprint (2–98% core), a thin slab at floor_y.
    _, rec = add_box("floor_observed", [ex[0], floor_y - 0.02, ez[0]], [ex[1], floor_y, ez[1]], "observed", "floor", (0.55, 0.45, 0.30, 1))
    scene["objects"].append(rec)
    # Walls: vertical planes found above furniture height. Whatever stands against them is left for object separation.
    margin = floor_margin(pts, floor_y); walls, rest = find_walls(pts, floor_y, margin)
    for i, w in enumerate(walls):
        _, rec = add_oriented_box(f"wall_{i+1}", w, "observed", "wall", (0.75, 0.75, 0.78, 1)); scene["walls"].append(rec)
    # Objects: in metres, every other cluster above the floor is separated and measured. Sizes need a measured scale.
    separated = separate_objects(pts, floor_y, rest) if metric else []
    scene["separation"] = ({"done": True, "cell_m": OBJECT_CELL, "floor_margin_m": round(margin, 3), "max_height_m": OBJECT_MAX_HEIGHT} if metric
                           else {"done": False, "reason": "Object sizes need a measured scale."})
    # Detections: lift each 2D box with the cloud points that project inside it, and name the object it overlaps.
    placed, unplaced = (lift_detections(pts, json.loads(Path(a.detections).read_text()), a.fov, a.min_cluster)
                        if a.detections else ([], []))
    for det in label_objects(separated, pts, placed):
        _, rec = add_box(det["name"], det["min"], det["max"], "detected", det["label"], (0.20, 0.55, 0.85, 1))
        rec["support_points"] = det["support_points"]; rec["detector"] = det["detector"]; scene["objects"].append(rec)
    for i, ob in enumerate(separated):
        _, rec = add_oriented_box(f"object_{i+1}", ob, "observed", ob.get("label", "object"), OBJECT_COLOURS[i % len(OBJECT_COLOURS)])
        rec["kind"] = "separated"
        if "detector" in ob: rec["labelSource"] = ob["detector"]
        scene["objects"].append(rec)
    scene["objects"].extend(unplaced)
    # Unknown: everything inside the room box that no observed point touches, as a tagged volume (coarse grid).
    cell = UNKNOWN_CELL; occupied = {(math.floor(p[0] / cell), math.floor(p[2] / cell)) for p in pts if p[1] > floor_y + 0.05}
    seen_floor = {(math.floor(p[0] / cell), math.floor(p[2] / cell)) for p in pts if p[1] <= floor_y + 0.05}
    for i in range(math.floor(ex[0] / cell), math.ceil(ex[1] / cell)):
        for j in range(math.floor(ez[0] / cell), math.ceil(ez[1] / cell)):
            if (i, j) not in occupied and (i, j) not in seen_floor:
                scene["unknown"].append([i * cell, j * cell, cell])
    if scene["unknown"]:
        me = bpy.data.meshes.new("unknown_space"); verts, faces = [], []
        for x, z, c in scene["unknown"]:
            b = len(verts); y0, y1 = floor_y, floor_y + 0.3
            for vx, vy, vz in [(x, y0, z), (x + c, y0, z), (x + c, y0, z + c), (x, y0, z + c), (x, y1, z), (x + c, y1, z), (x + c, y1, z + c), (x, y1, z + c)]:
                verts.append((vx, -vz, vy))
            faces += [[b, b+1, b+2, b+3], [b+4, b+5, b+6, b+7], [b, b+1, b+5, b+4], [b+1, b+2, b+6, b+5], [b+2, b+3, b+7, b+6], [b+3, b, b+4, b+7]]
        me.from_pydata(verts, [], faces); ob = bpy.data.objects.new("unknown_space", me); bpy.context.collection.objects.link(ob)
        mat = bpy.data.materials.new("unknown_mat"); mat.diffuse_color = (0.9, 0.3, 0.3, 0.35); ob.data.materials.append(mat); ob["provenance"] = "unknown"

    bpy.ops.export_scene.gltf(filepath=str(out / "scene.glb"), export_format="GLB", export_extras=True, export_apply=True)
    emit_usd(out, scene, pts)
    emit_ifc(out, scene)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "scene.blend"))
    scene["counts"] = {"points": len(pts), "walls": len(scene["walls"]), "objects": sum(1 for o in scene["objects"] if o["provenance"] == "detected"),
                       "separated": len(separated),
                       "unplaced": sum(1 for o in scene["objects"] if o["provenance"] == "detected-unplaced"), "unknown_cells": len(scene["unknown"])}
    (out / "scene.json").write_text(json.dumps(scene, indent=1))
    print("SCENE_OK", json.dumps(scene["counts"]), "floor_y=%.3f extent=%.2fx%.2f ceiling=%.2f" % (floor_y, ex[1] - ex[0], ez[1] - ez[0], ceiling - floor_y))


if __name__ == "__main__" and bpy is not None:
    main()
