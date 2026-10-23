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


def detection_case(camera_from_cloud, centre, size=(0.6, 1.0, 0.6), w=640, h=480, fov=60.0, seed=4):
    """A box of points at `centre` (cloud frame) plus scattered background, and the 2D box a detector would draw
    around that object seen from the given camera."""
    rng = random.Random(seed)
    obj = [[centre[i] + rng.uniform(-size[i] / 2, size[i] / 2) for i in range(3)] + [200, 50, 50] for _ in range(400)]
    background = [[rng.uniform(-10, 10), rng.uniform(0, 3), rng.uniform(-10, 10), 90, 90, 90] for _ in range(400)]
    M = camera_from_cloud; focal = w / (2 * math.tan(math.radians(fov) / 2))
    cam = lambda p: [sum(M[i][k] * p[k] for k in range(3)) + M[i][3] for i in range(3)]
    uv = [sc.project(cam(p), w, h, focal) for p in obj]
    box = [min(u for u, _, _ in uv), min(v for _, v, _ in uv), max(u for u, _, _ in uv), max(v for _, v, _ in uv)]
    side = {"model": {"id": "test-detector"}, "frames": [{"id": "photo", "width": w, "height": h, "cameraFromCloud": M}],
            "observations": [{"id": "object-0", "frameId": "photo", "label": "chair", "box": box}]}
    return obj + background, side


class Detections(unittest.TestCase):
    def test_without_a_camera_pose_or_box_nothing_is_guessed(self):
        pts, side = detection_case([[1, 0, 0, -2], [0, 1, 0, -1.2], [0, 0, 1, 0], [0, 0, 0, 1]], (2.0, 0.5, -4.0))
        del side["frames"][0]["cameraFromCloud"]
        side["observations"].append({"id": "object-1", "frameId": "photo", "label": "table"})  # worker VLM labels carry no box
        placed, unplaced = sc.lift_detections(pts, side, 60.0, 12)
        self.assertEqual(placed, [])
        self.assertEqual([(u["name"], u["provenance"], u["reason"]) for u in unplaced],
                         [("object-0", "detected-unplaced", "no camera pose for this frame in the cloud's frame"),
                          ("object-1", "detected-unplaced", "no bounding box")])
        side["frames"][0]["cameraFromCloud"] = [[2, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]  # not rigid
        self.assertEqual(sc.lift_detections(pts, side, 60.0, 12)[0], [])

    def test_boxes_are_lifted_through_the_frames_camera_pose_into_the_cloud_frame(self):
        poses = {"identity camera at (2, 1.2, 0)": ([[1, 0, 0, -2], [0, 1, 0, -1.2], [0, 0, 1, 0], [0, 0, 0, 1]], (2.0, 0.5, -4.0)),
                 # Looking along +x from (0, 1.2, 0): world +x maps to camera -z.
                 "camera turned 90 degrees": ([[0, 0, 1, 0], [0, 1, 0, -1.2], [-1, 0, 0, 0], [0, 0, 0, 1]], (4.0, 0.5, 0.3))}
        for name, (M, centre) in poses.items():
            with self.subTest(name):
                pts, side = detection_case(M, centre)
                placed, unplaced = sc.lift_detections(pts, side, 60.0, 12)
                self.assertEqual(unplaced, []); self.assertEqual(len(placed), 1); det = placed[0]
                for i in range(3): self.assertLessEqual(det["min"][i], centre[i]); self.assertGreaterEqual(det["max"][i], centre[i])
                self.assertLess(max(det["max"][i] - det["min"][i] for i in range(3)), 2.0)
                self.assertEqual((det["label"], det["detector"]), ("chair", "test-detector"))


class Usd(unittest.TestCase):
    def test_usd_declares_metres_only_for_metric_scenes(self):
        import tempfile
        scene = {"schema": "brainsnn.scene.v1", "units": "arbitrary", "floor_y": 0, "objects": [], "walls": [], "unknown": []}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scene.usda"
            with self.assertRaisesRegex(ValueError, "arbitrary units"): sc.write_usda(path, scene, [[0, 0, 0, 1, 2, 3]])
            self.assertFalse(path.exists())
            sc.write_usda(path, {**scene, "units": "m"}, [[0, 0, 0, 1, 2, 3]])
            self.assertIn("metersPerUnit = 1", path.read_text())

    def test_a_skipped_usd_removes_one_left_from_an_earlier_metric_run(self):
        import tempfile
        scene = lambda units: {"schema": "brainsnn.scene.v1", "units": units, "floor_y": 0, "objects": [], "walls": [], "unknown": []}
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(sc.emit_usd(tmp, scene("m"), [[0, 0, 0, 1, 2, 3]]), {"written": True, "metersPerUnit": 1})
            self.assertTrue((Path(tmp) / "scene.usda").is_file())
            record = sc.emit_usd(tmp, scene("arbitrary"), [[0, 0, 0, 1, 2, 3]])
            self.assertFalse(record["written"]); self.assertIn("arbitrary units", record["reason"])
            self.assertFalse((Path(tmp) / "scene.usda").exists())


class GridBound(unittest.TestCase):
    def test_footprint_cells_match_the_unknown_pass_and_are_capped(self):
        self.assertEqual(sc.grid_cells([0, 4], [0, 3]), 8 * 6)
        self.assertEqual(sc.grid_cells([-0.25, 0.25], [0, 0.5]), 2 * 1)
        self.assertLessEqual(sc.grid_cells([0, 249.5], [0, 249.5]), sc.MAX_GRID_CELLS)
        self.assertGreater(sc.grid_cells([-9e6, 9e6], [-9e6, 9e6]), sc.MAX_GRID_CELLS)

