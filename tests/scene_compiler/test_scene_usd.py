"""Pure-Python contracts of the scene-usd adapter's Arena hand-off (no COLMAP or Blender needed):
python3 -m unittest tests.scene_compiler.test_scene_usd"""
import json, math, random, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "world_worker"))
import scene_usd as su


def room_cloud(n=3000, seed=3, colmap=True):
    """COLMAP-frame room (y down, z forward): floor at y=+1 (down), one wall, a few far outliers."""
    rng = random.Random(seed); rows = []
    for _ in range(n):
        rows.append([rng.uniform(-3, 3), 1.0 + rng.gauss(0, .01), rng.uniform(2, 8), 90, 80, 70])   # floor
    for _ in range(n // 2):
        rows.append([3.0 + rng.gauss(0, .02), rng.uniform(-1.5, 1.0), rng.uniform(2, 8), 120, 120, 120])  # wall
    for _ in range(20):
        rows.append([rng.uniform(-400, 400), rng.uniform(-400, 400), rng.uniform(-400, 400), 0, 0, 0])  # outliers
    return rows


class ArenaHandoff(unittest.TestCase):
    def test_colmap_cloud_is_turned_y_up_and_trimmed(self):
        cloud = su.to_arena_cloud(room_cloud(), coordinate_frame="colmap", source="sparse-preview.ply")
        self.assertEqual(cloud["kind"], "colmap-sparse-point-cloud")
        self.assertEqual((cloud["coordinateFrame"], cloud["sourceFrame"], cloud["units"]), ("right-handed-y-up", "colmap", "arbitrary"))
        self.assertIsNone(cloud["scale"]); self.assertFalse(cloud["provenance"]["metricVerified"])
        # Percentile core: the 20 far points go, plus the outermost ~2% per axis of real points (as in the browser).
        self.assertGreaterEqual(cloud["provenance"]["outliersDropped"], 20); self.assertLess(cloud["provenance"]["outliersDropped"], 4520 * .12)
        self.assertEqual(len(cloud["points"]) + cloud["provenance"]["outliersDropped"], 4520)
        ys = [p[1] for p in cloud["points"]]
        self.assertLess(cloud["floorEstimate"]["y"], 0.1)              # floor near y=0 after alignment, not at +1
        self.assertGreater(max(ys) - min(ys), 2.0)                      # wall stands above the floor
        self.assertTrue(cloud["provenance"]["floorAligned"]); self.assertGreater(cloud["floorEstimate"]["support"], .5)
        self.assertTrue(all(len(p) == 6 and all(isinstance(c, int) for c in p[3:]) for p in cloud["points"]))

    def test_frame_flip_only_for_colmap(self):
        # A floorless blob (<10% plane inliers) is never rotated, so the frame handling shows through directly.
        rng = random.Random(5); rows = [[rng.uniform(-3, 3), rng.uniform(-3, 3), rng.uniform(-3, 3), 1, 2, 3] for _ in range(2000)]
        kept = su.to_arena_cloud(rows, coordinate_frame="right-handed-y-up")
        self.assertFalse(kept["provenance"]["floorAligned"])
        first = next(r for r in rows if all(abs(v) < 2.5 for v in r[:3]))
        self.assertIn(first, kept["points"])
        flipped = su.to_arena_cloud(rows, coordinate_frame="colmap")
        self.assertIn([first[0], -first[1], -first[2], 1, 2, 3], flipped["points"])

    def test_measured_scale_turns_units_into_metres(self):
        cloud = su.to_arena_cloud(room_cloud(), coordinate_frame="colmap", metres_per_unit=0.5, measurement={"distance": 2.0, "span": 4.0})
        self.assertEqual(cloud["units"], "m"); self.assertEqual(cloud["floorEstimate"]["units"], "m")
        self.assertEqual(cloud["scale"], {"source": "user-measured", "metresPerUnit": 0.5, "distance": 2.0, "spanUnits": 4.0, "selfReported": True, "verified": False})

    def test_budget_thins_deterministically(self):
        cloud = su.to_arena_cloud(room_cloud(), coordinate_frame="colmap", budget=1000)
        self.assertLessEqual(len(cloud["points"]), 1000); self.assertTrue(cloud["provenance"]["thinned"])

    def test_read_ply_round_trip(self):
        import numpy as np
        from geometry import write_point_cloud
        pts = np.array([[1.5, -2.25, 3.0], [0.1, 0.2, 0.3]]); cols = np.array([[1, 2, 3], [250, 251, 252]])
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "p.ply"; write_point_cloud(path, pts, cols, coordinate_frame="colmap")
            rows = su.read_ply(path)
        self.assertEqual(rows[0], [1.5, -2.25, 3.0, 1, 2, 3]); self.assertEqual(rows[1][3:], [250, 251, 252])
        self.assertTrue(json.dumps(rows))


if __name__ == "__main__":
    unittest.main()


class CompileScene(unittest.TestCase):
    """The adapter accepts scene.usda only when the compiler says it wrote one (metric clouds only)."""
    def fake_blender(self, written, write_file):
        def run(command, **kwargs):
            out = Path(command[command.index('--out') + 1]); out.mkdir(parents=True, exist_ok=True)
            (out / 'scene.glb').write_bytes(b'glTF')
            (out / 'scene.json').write_text(json.dumps({'schema': 'brainsnn.scene.v1', 'usd': {'written': written}}))
            if write_file: (out / 'scene.usda').write_text('#usda 1.0\n')
        return run

    def test_usd_must_match_the_compilers_record(self):
        original = su.subprocess.run
        try:
            with tempfile.TemporaryDirectory() as tmp:
                for written, write_file, ok in [(False, False, True), (True, True, True), (True, False, False), (False, True, False)]:
                    su.subprocess.run = self.fake_blender(written, write_file); out = Path(tmp) / f'{written}-{write_file}'
                    if ok: self.assertEqual(su.compile_scene(Path(tmp) / 'cloud.json', out, blender='/usr/bin/blender')['usd'], {'written': written})
                    else: self.assertRaises(RuntimeError, su.compile_scene, Path(tmp) / 'cloud.json', out, blender='/usr/bin/blender')
        finally:
            su.subprocess.run = original


FAKE_BLENDER = '''#!/usr/bin/env python3
"""Stand-in for the blender binary: writes the compiler's output contract (metric clouds get scene.usda). No Blender runs."""
import json, sys
from pathlib import Path
if sys.argv[1:] == ["--version"]:
    print("Blender test stand-in"); sys.exit(0)
args = sys.argv[sys.argv.index("--") + 1:]
cloud, out = json.loads(Path(args[args.index("--cloud") + 1]).read_text()), Path(args[args.index("--out") + 1])
out.mkdir(parents=True, exist_ok=True); metric = cloud["units"] == "m"
(out / "scene.glb").write_bytes(b"glTF-stand-in")
if metric: (out / "scene.usda").write_text("#usda 1.0\\n"); (out / "scene.ifc").write_text("ISO-10303-21;\\n")
(out / "scene.json").write_text(json.dumps({"schema": "brainsnn.scene.v1", "units": "m" if metric else "arbitrary", "scale": cloud["scale"],
    "usd": {"written": metric}, "ifc": {"written": metric}, "counts": {"points": len(cloud["points"]), "walls": 0, "objects": 0, "unplaced": 0, "unknown_cells": 0}, "walls": []}))
'''


def handoff(units="m", source_frame="colmap"):
    rows = [[x * .1, 0, z * .1, 90, 80, 70] for x in range(10) for z in range(10)]
    scale = {"source": "user-measured", "metresPerUnit": .5, "distance": 1.0, "spanUnits": 2.0, "selfReported": True, "verified": False}
    return {"version": 1, "kind": "colmap-sparse-point-cloud", "units": units, "coordinateFrame": "right-handed-y-up", "sourceFrame": source_frame,
            "source": "sparse-preview.ply", "points": rows, "floorEstimate": {"y": 0, "units": units}, "scale": scale if units == "m" else None,
            "provenance": {"metricVerified": False}}


class CloudHandoff(unittest.TestCase):
    def run_handoff(self, cloud, extra_inputs=()):
        d = Path(tempfile.mkdtemp()); blender = d / "blender"; blender.write_text(FAKE_BLENDER); blender.chmod(0o755)
        path = d / "brainsnn-point-cloud.json"; path.write_text(json.dumps(cloud))
        out = d / "job" / "output"
        request = {"schema": "brainsnn.adapter.v1", "output_dir": str(out),
                   "inputs": [{"kind": "cloud", "path": str(path), "name": path.name}, *extra_inputs]}
        return su.run(request, blender=str(blender)), out

    def test_measured_cloud_compiles_to_a_metric_scene_without_colmap(self):
        evidence, out = self.run_handoff(handoff("m"))
        self.assertEqual((evidence["units"], evidence["input"]["kind"], evidence["reconstruction"]), ("m", "browser-handoff", None))
        self.assertEqual(len(evidence["input"]["sha256"]), 64); self.assertFalse(evidence["metric_verified"])
        self.assertEqual(evidence["handoff"]["scale"]["selfReported"], True)
        self.assertTrue(any("self-reported" in w for w in evidence["warnings"]))
        names = [a["name"] for a in json.loads((out / "manifest.json").read_text())["artifacts"]]
        self.assertEqual(names, ["scene.glb", "scene.usda", "scene.ifc", "scene.json", "scene-usd.json", "arena-cloud.json"])
        self.assertEqual(evidence["ifc"], {"written": True})
        self.assertFalse((out / "sparse-preview.ply").exists())

    def test_unscaled_cloud_writes_no_usd(self):
        evidence, out = self.run_handoff(handoff("arbitrary"))
        self.assertEqual(evidence["units"], "arbitrary"); self.assertFalse((out / "scene.usda").exists()); self.assertFalse((out / "scene.ifc").exists())
        self.assertNotIn("scene.usda", [a["name"] for a in json.loads((out / "manifest.json").read_text())["artifacts"]])

    def test_single_photo_previews_and_mixed_inputs_are_refused(self):
        with self.assertRaisesRegex(ValueError, "multi-view"):
            self.run_handoff(handoff("m", source_frame="right-handed-y-up"))
        with self.assertRaisesRegex(ValueError, "on its own"):
            self.run_handoff(handoff("m"), extra_inputs=[{"kind": "video", "path": "/dev/null", "name": "walk.mp4"}])

    def test_dense_y_up_cloud_compiles_when_it_declares_multiple_views(self):
        evidence, out = self.run_handoff({**handoff("m", source_frame="right-handed-y-up"), "multiView": True})
        self.assertEqual(evidence["handoff"]["sourceFrame"], "right-handed-y-up"); self.assertTrue((out / "scene.usda").exists())

