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
