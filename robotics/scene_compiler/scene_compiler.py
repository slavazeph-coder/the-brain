"""BrainSNN scene compiler — stage 1 (Blender headless, GB10).

Turns what the World Builder already exports into a simulation-ready scene:

  in : Arena point-cloud JSON  (brainsnn-point-cloud.json: points [x,y,z,r,g,b], units, floorEstimate, scale)
       observation sidecar JSON (optional: on-device detections, 2D boxes per frame, COCO labels)
       camera model for the sidecar frame (fov degrees; the site's depth path uses 60)
  out: scene.glb  (browser Arena / three.js)       scene.usda  (Isaac Sim / Omniverse, written directly)
       scene.json (every object: label, box, centre, size, provenance: observed | detected | unknown)

Everything here is derived from observed geometry. Nothing is invented: unseen space is exported as an
explicit "unknown" volume, never as free floor. Inferred fill (stage 2) will be a separate, tagged layer.

Run:  blender -b --python scene_compiler.py -- --cloud X.json [--detections Y.json --fov 60] --out DIR
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path

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
def percentile(v, q):
    s = sorted(v); i = (len(s) - 1) * q; lo = math.floor(i); return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (i - lo)


def floor_plane(pts, floor):
    """Floor y from the hand-off's RANSAC estimate when present, else the 5th percentile of y (lowest dense layer)."""
    if floor and isinstance(floor.get("y"), (int, float)): return float(floor["y"])
    return percentile([p[1] for p in pts], 0.05)


def wall_segments(pts, floor_y, cell=0.25, min_height=0.8, min_cells=4):
    """Vertical structure: XZ cells whose points span >= min_height above the floor, grouped into 8-connected
    components, each fitted with a PCA-oriented box (so a wall seen diagonally is one wall, not a staircase).
    Returns per wall: centre (x,z), yaw (radians about Y), length, thickness, height, support (point count)."""
    span, members = {}, {}
    for i, (x, y, z, *_) in enumerate(pts):
        if y < floor_y + 0.05: continue
        k = (math.floor(x / cell), math.floor(z / cell)); lo, hi = span.get(k, (y, y)); span[k] = (min(lo, y), max(hi, y))
        members.setdefault(k, []).append(i)
    tall = {k for k, (lo, hi) in span.items() if hi - lo >= min_height}
    walls, seen = [], set()
    for k in sorted(tall):
        if k in seen: continue
        comp, stack = [], [k]; seen.add(k)
        while stack:
            c = stack.pop(); comp.append(c)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    n = (c[0] + dx, c[1] + dz)
                    if n in tall and n not in seen: seen.add(n); stack.append(n)
        if len(comp) < min_cells: continue
        idx = [i for c in comp for i in members[c]]; P = [(pts[i][0], pts[i][2]) for i in idx]
        mx, mz = sum(x for x, _ in P) / len(P), sum(z for _, z in P) / len(P)
        sxx = sum((x - mx) ** 2 for x, _ in P); szz = sum((z - mz) ** 2 for _, z in P); sxz = sum((x - mx) * (z - mz) for x, z in P)
        yaw = 0.5 * math.atan2(2 * sxz, sxx - szz)  # principal axis in XZ
        ca, sa = math.cos(yaw), math.sin(yaw)
        along = [ (x - mx) * ca + (z - mz) * sa for x, z in P]; across = [-(x - mx) * sa + (z - mz) * ca for x, z in P]
        ys = [pts[i][1] for i in idx]
        walls.append({"centre": [mx, mz], "yaw": yaw, "length": percentile(along, 0.98) - percentile(along, 0.02),
                      "thickness": max(0.1, percentile(across, 0.9) - percentile(across, 0.1)),
                      "y0": max(floor_y, percentile(ys, 0.02)), "y1": percentile(ys, 0.98), "support": len(idx), "cells": len(comp)})
    return walls


def unproject_box(box, w, h, fov, depth_samples):
    """2D box (normalised) + depth from the cloud points that project inside it -> 3D AABB in camera frame.
    Camera: looks down -z, y up, pinhole with the given horizontal fov (matches visual-geometry.fromDepth)."""
    focal = w / (2 * math.tan(math.radians(fov) / 2))
    if not depth_samples: return None
    zs = sorted(depth_samples); z0, z1 = percentile(zs, 0.15), percentile(zs, 0.85); zc = (z0 + z1) / 2
    x0 = (box[0] * w - w / 2) / focal * zc; x1 = (box[2] * w - w / 2) / focal * zc
    y0 = -(box[3] * h - h / 2) / focal * zc; y1 = -(box[1] * h - h / 2) / focal * zc
    return [[x0, y0, -z1], [x1, y1, -z0]]


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


def write_usda(path, scene, pts):
    """Flat USD (text) for Isaac Sim / Omniverse: Y-up, metres when metric. Boxes as Cube prims, points as a Points prim,
    provenance as custom attributes. Ubuntu's Blender 4.0 ships without the USD exporter, so this is written directly."""
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


def add_oriented_box(name, w, provenance, label, color):
    """Wall box rotated about the vertical axis (Y-up yaw -> Blender Z rotation)."""
    cx, cz, y0, y1 = w["centre"][0], w["centre"][1], w["y0"], w["y1"]
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, -cz, (y0 + y1) / 2)); ob = bpy.context.active_object
    ob.scale = (w["length"], w["thickness"], y1 - y0); ob.rotation_euler = (0, 0, -w["yaw"]); ob.name = name
    mat = bpy.data.materials.new(name + "_mat"); mat.diffuse_color = color; ob.data.materials.append(mat)
    ob["provenance"] = provenance; ob["label"] = label; ob["support_points"] = w["support"]
    return ob, {"name": name, "label": label, "provenance": provenance, "centre": [cx, (y0 + y1) / 2, cz], "size": [w["length"], y1 - y0, w["thickness"]],
                "yaw_degrees": math.degrees(w["yaw"]), "support_points": w["support"]}


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
    if cloud.get("sourceFrame") != "colmap" and not a.allow_unverified:
        sys.exit("REFUSED: sourceFrame=%r is not a multi-view reconstruction. The scene compiler needs COLMAP/MapAnything/VIPE "
                 "geometry; single-photo depth is a visual preview only. Record a walkthrough, or pass --allow-unverified for experiments."
                 % cloud.get("sourceFrame"))
    if not metric:  # arbitrary units: keep them but say so loudly; the site's scale card is the way to fix it
        print("WARNING: cloud is in arbitrary units; exporting unscaled (scale.source = none)")
    floor_y = floor_plane(pts, cloud.get("floorEstimate"))
    xs, zs = [p[0] for p in pts], [p[2] for p in pts]
    ex = [percentile(xs, 0.02), percentile(xs, 0.98)]; ez = [percentile(zs, 0.02), percentile(zs, 0.98)]
    ceiling = percentile([p[1] for p in pts], 0.98)

    reset(); scene = {"schema": "brainsnn.scene.v1", "units": "m" if metric else "arbitrary", "scale": cloud.get("scale"),
                      "source": cloud.get("source"), "floor_y": floor_y, "objects": [], "walls": [], "unknown": []}
    add_points(pts)
    # Floor: the observed footprint (2–98% core), a thin slab at floor_y.
    _, rec = add_box("floor_observed", [ex[0], floor_y - 0.02, ez[0]], [ex[1], floor_y, ez[1]], "observed", "floor", (0.55, 0.45, 0.30, 1))
    scene["objects"].append(rec)
    # Walls: vertical runs of tall cells.
    for i, w in enumerate(wall_segments(pts, floor_y)):
        _, rec = add_oriented_box(f"wall_{i+1}", w, "observed", "wall", (0.75, 0.75, 0.78, 1)); scene["walls"].append(rec)
    # Objects from detections: lift each 2D box with the cloud points that project inside it.
    if a.detections:
        side = json.loads(Path(a.detections).read_text()); frame = side["frames"][0]; w, h = frame["width"], frame["height"]
        focal = w / (2 * math.tan(math.radians(a.fov) / 2))
        proj = [(project(p, w, h, focal), p) for p in pts]
        for ob in side.get("observations", []):
            b = ob["box"]; inside = [pr[2] for pr, p in proj if pr and b[0] <= pr[0] <= b[2] and b[1] <= pr[1] <= b[3]]
            if len(inside) < a.min_cluster:
                scene["objects"].append({"name": ob["id"], "label": ob["label"], "provenance": "detected-unplaced", "reason": f"{len(inside)} supporting points"}); continue
            aabb = unproject_box(b, w, h, a.fov, inside)
            if not aabb: continue
            _, rec = add_box(f"{ob['label']}_{ob['id']}".replace(" ", "_"), aabb[0], aabb[1], "detected", ob["label"], (0.20, 0.55, 0.85, 1))
            rec["support_points"] = len(inside); rec["detector"] = side.get("model", {}).get("id"); scene["objects"].append(rec)
    # Unknown: everything inside the room box that no observed point touches, as a tagged volume (coarse grid).
    cell = 0.5; occupied = {(math.floor(p[0] / cell), math.floor(p[2] / cell)) for p in pts if p[1] > floor_y + 0.05}
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
    write_usda(out / "scene.usda", scene, pts)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "scene.blend"))
    scene["counts"] = {"points": len(pts), "walls": len(scene["walls"]), "objects": sum(1 for o in scene["objects"] if o["provenance"] == "detected"),
                       "unplaced": sum(1 for o in scene["objects"] if o["provenance"] == "detected-unplaced"), "unknown_cells": len(scene["unknown"])}
    (out / "scene.json").write_text(json.dumps(scene, indent=1))
    print("SCENE_OK", json.dumps(scene["counts"]), "floor_y=%.3f extent=%.2fx%.2f ceiling=%.2f" % (floor_y, ex[1] - ex[0], ez[1] - ez[0], ceiling - floor_y))


if __name__ == "__main__" and bpy is not None:
    main()
