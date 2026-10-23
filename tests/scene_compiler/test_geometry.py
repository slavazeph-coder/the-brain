"""Pure-geometry contracts of the scene compiler (no Blender needed): python3 -m unittest tests.scene_compiler.test_geometry"""
import math, random, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "scene_compiler"))
import scene_compiler as sc


def wall_cloud(yaw_deg, length=6.0, height=3.0, n=4000, seed=1):
    rng = random.Random(seed); ca, sa = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    pts = []
    for _ in range(n):
        t, y = rng.uniform(-length / 2, length / 2), rng.uniform(0.05, height); d = rng.gauss(0, 0.03)
        pts.append([t * ca - d * sa + 1.0, y, t * sa + d * ca - 2.0, 120, 120, 120])
    for _ in range(n // 4):  # floor points
        pts.append([rng.uniform(-3, 3) + 1.0, rng.gauss(0, 0.01), rng.uniform(-3, 3) - 2.0, 90, 80, 70])
    return pts


class Walls(unittest.TestCase):
    def test_diagonal_wall_is_one_oriented_box(self):
        for yaw in (0, 17, -40, 80):
            with self.subTest(yaw=yaw):
                walls = sc.wall_segments(wall_cloud(yaw), floor_y=0.0)
                self.assertEqual(len(walls), 1, f"expected one wall, got {len(walls)}")
                w = walls[0]; fitted = math.degrees(w["yaw"]) % 180; want = yaw % 180
                self.assertLess(min(abs(fitted - want), 180 - abs(fitted - want)), 4)
                self.assertAlmostEqual(w["length"], 6.0, delta=0.4); self.assertAlmostEqual(w["y1"] - w["y0"], 3.0, delta=0.3)
                self.assertGreater(w["support"], 3500); self.assertLess(w["thickness"], 0.3)

    def test_floor_only_has_no_walls(self):
        pts = [p for p in wall_cloud(0) if p[1] < 0.04]
        self.assertEqual(sc.wall_segments(pts, floor_y=0.0), [])

    def test_floor_plane_prefers_handoff_estimate(self):
        self.assertEqual(sc.floor_plane([[0, 5, 0, 0, 0, 0]], {"y": -0.26}), -0.26)
        self.assertAlmostEqual(sc.floor_plane([[0, y / 100, 0, 0, 0, 0] for y in range(101)], None), 0.05, places=6)


class Lift(unittest.TestCase):
    def test_box_depth_from_supporting_points(self):
        box = sc.unproject_box([0.25, 0.25, 0.75, 0.75], 400, 400, 60, [2.0] * 50 + [2.2] * 50)
        (x0, y0, z0), (x1, y1, z1) = box
        self.assertLess(z0, z1); self.assertAlmostEqual(-z1, 2.0, delta=0.05); self.assertAlmostEqual(-z0, 2.2, delta=0.05)
        self.assertAlmostEqual(x1 - x0, 2 * 100 / (400 / (2 * math.tan(math.radians(30)))) * 2.1, delta=0.05)
        self.assertIsNone(sc.unproject_box([0, 0, 1, 1], 10, 10, 60, []))


if __name__ == "__main__":
    unittest.main()
