"""Pure-geometry contracts of the scene compiler (no Blender needed): python3 -m unittest tests.scene_compiler.test_geometry"""
import math, random, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "scene_compiler"))
import scene_compiler as sc
from opening_geometry import wall_parts, door_parts, plan_wall_parts


class ReviewedOpenings(unittest.TestCase):
    def setUp(self):
        self.wall = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', 'centre': [3, 2, -4], 'size': [4, 3, .2], 'yaw_degrees': 30}
        self.opening = {'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1, 'widthMeters': 1.2, 'heightMeters': 2.1, 'sillMeters': 0, 'kind': 'opening', 'reviewed': True}

    def test_rotated_cut_preserves_net_volume_and_contains_no_void(self):
        import copy
        original = copy.deepcopy(self.wall); parts = wall_parts(self.wall, [self.opening])
        self.assertEqual(self.wall, original)
        self.assertAlmostEqual(sum(math.prod(p['size']) for p in parts), (4 * 3 - 1.2 * 2.1) * .2)
        angle = math.radians(30)
        for part in parts:
            along = (part['centre'][0] - 3) * math.cos(angle) + (part['centre'][2] + 4) * math.sin(angle) + 2
            x0, x1 = along - part['size'][0] / 2, along + part['size'][0] / 2
            y0, y1 = part['centre'][1] - part['size'][1] / 2 - .5, part['centre'][1] + part['size'][1] / 2 - .5
            self.assertTrue(x1 <= 1 + 1e-8 or x0 >= 2.2 - 1e-8 or y0 >= 2.1 - 1e-8 or y1 <= 0)
            self.assertEqual(part['yaw_degrees'], 30)

    def test_raised_void_has_a_sill_and_closed_door_remains_blocked_in_plan(self):
        raised = {**self.opening, 'sillMeters': .9, 'heightMeters': 1.2}
        parts = wall_parts(self.wall, [raised])
        self.assertEqual(len(parts), 4)
        self.assertEqual(plan_wall_parts(self.wall, [raised]), [self.wall])
        door = {**self.opening, 'kind': 'door'}
        self.assertEqual(plan_wall_parts(self.wall, [door]), [self.wall])
        self.assertEqual(len(plan_wall_parts(self.wall, [door], closed_doors_block=False)), 2)
        leaf = door_parts([self.wall], [door])[0]
        for got, expected in zip(leaf['size'], [1.2, 2.1, .05]): self.assertAlmostEqual(got, expected)
        self.assertEqual(leaf['yaw_degrees'], 30)
        self.assertAlmostEqual(leaf['centre'][1], .5 + 2.1 / 2)

    def test_usd_uses_cut_parts_and_closed_leaf_while_semantic_wall_stays_whole(self):
        import tempfile
        scene = {'schema': 'brainsnn.scene.v1', 'units': 'm', 'floor_y': .5, 'objects': [], 'walls': [self.wall], 'unknown': [], 'openings': [{**self.opening, 'id': 'front-entry', 'kind': 'door'}]}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'scene.usda'; sc.write_usda(path, scene, [])
            text = path.read_text()
        self.assertNotIn('def Cube "wall_1"', text)
        self.assertIn('def Cube "wall_1_part_1"', text); self.assertIn('def Cube "door_reference_1"', text)
        self.assertIn('sourceName = "door_front-entry"', text)
        self.assertIn('xformOp:rotateXYZ = (0, -30, 0)', text)
        self.assertEqual(scene['walls'][0]['size'], [4, 3, .2])


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
                walls, rest = sc.find_walls(wall_cloud(yaw), floor_y=0.0)
                self.assertEqual(len(walls), 1, f"expected one wall, got {len(walls)}")
                w = walls[0]; fitted = math.degrees(w["yaw"]) % 180; want = yaw % 180
                self.assertLess(min(abs(fitted - want), 180 - abs(fitted - want)), 4)
                self.assertAlmostEqual(w["length"], 6.0, delta=0.4); self.assertAlmostEqual(w["y1"] - w["y0"], 3.0, delta=0.3)
                self.assertGreater(w["support"], 3500); self.assertLess(w["thickness"], 0.3); self.assertLess(len(rest), 300)

    def test_a_doorway_splits_a_wall_and_a_short_hidden_stretch_does_not(self):
        def with_openings(openings, length=6.0, n=6000, seed=3):
            # A wall along x at z = -2, with no points below 2.0 m inside each opening (a lintel above it).
            rng = random.Random(seed); pts = []
            while len(pts) < n:
                t, y = rng.uniform(-length / 2, length / 2), rng.uniform(0.05, 2.6)
                if y < 2.0 and any(a < t < b for a, b in openings): continue
                pts.append([t, y, -2.0 + rng.gauss(0, 0.02), 120, 120, 120])
            return pts
        for openings, want in (([(-0.5, 0.5)], [(-3.0, -0.5), (0.5, 3.0)]), ([(-0.15, 0.15)], [(-3.0, 3.0)]),
                               ([(-1.2, -0.2), (0.2, 1.2)], [(-3.0, -1.2), (-0.2, 0.2), (1.2, 3.0)])):
            with self.subTest(openings=openings):
                walls, rest = sc.find_walls(with_openings(openings), 0.0)
                got = sorted((w["centre"][0] - w["length"] / 2, w["centre"][0] + w["length"] / 2) for w in walls)
                self.assertEqual(len(got), len(want), got)
                for (g0, g1), (w0, w1) in zip(got, want):
                    self.assertAlmostEqual(g0, w0, delta=0.15); self.assertAlmostEqual(g1, w1, delta=0.15)
                self.assertTrue(all(abs(w["centre"][1] + 2.0) < 0.05 for w in walls))
                self.assertLess(len(rest), 60, "the lintel above an opening stays with the wall, not an object")

    def test_floor_only_has_no_walls(self):
        pts = [p for p in wall_cloud(0) if p[1] < 0.04]
        self.assertEqual(sc.find_walls(pts, floor_y=0.0), ([], []))

    def test_the_floor_margin_follows_the_floors_scatter(self):
        rng = random.Random(3)
        tight = [[0, rng.gauss(0, 0.005), 0] for _ in range(500)]; loose = [[0, rng.gauss(0, 0.06), 0] for _ in range(500)]
        self.assertEqual(sc.floor_margin(tight, 0.0), 0.05); self.assertAlmostEqual(sc.floor_margin(loose, 0.0), 0.12, delta=0.02)

    def test_floor_plane_prefers_handoff_estimate(self):
        self.assertEqual(sc.floor_plane([[0, 5, 0, 0, 0, 0]], {"y": -0.26}), -0.26)
        self.assertAlmostEqual(sc.floor_plane([[0, y / 100, 0, 0, 0, 0] for y in range(101)], None), 0.05, places=6)


def room_cloud(seed=2):
    """A 6 m wall, a bookshelf against it, a table turned 30 degrees and a chair, on a floor (metres, Y-up)."""
    rng = random.Random(seed); pts = []
    def box(cx, cz, length, width, height, yaw_deg=0.0, n=600, y0=0.0, rgb=(150, 120, 90)):
        ca, sa = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
        for _ in range(n):  # points on the box's surface, as a reconstruction sees it
            u, v, y = rng.uniform(-length / 2, length / 2), rng.uniform(-width / 2, width / 2), rng.uniform(y0, y0 + height)
            face = rng.randrange(3)
            if face == 0: u = rng.choice((-length / 2, length / 2))
            elif face == 1: v = rng.choice((-width / 2, width / 2))
            else: y = y0 + height
            pts.append([cx + u * ca - v * sa, y, cz + u * sa + v * ca, *rgb])
    box(0.0, -3.0, 6.0, 0.08, 2.6, n=3000)                   # wall along x at z = -3
    box(-1.5, -2.6, 0.9, 0.4, 1.8, n=900)                    # bookshelf, 14 cm in front of the wall
    box(0.8, -0.5, 1.6, 0.8, 0.75, yaw_deg=30, n=900)        # table
    box(-1.0, 0.6, 0.5, 0.5, 0.9, n=500)                     # chair
    box(2.4, 1.8, 0.05, 0.05, 0.05, n=8)                     # a few stray points: not an object
    for _ in range(1500): pts.append([rng.uniform(-3, 3), rng.gauss(0, 0.005), rng.uniform(-3, 2.5), 90, 80, 70])
    return pts


class Objects(unittest.TestCase):
    def test_the_wall_is_a_plane_and_furniture_against_it_is_not(self):
        pts = room_cloud(); walls, rest = sc.find_walls(pts, 0.0)
        self.assertEqual(len(walls), 1); w = walls[0]
        self.assertAlmostEqual(w["length"], 6.0, delta=0.3); self.assertAlmostEqual(w["centre"][1], -3.0, delta=0.08)
        self.assertGreaterEqual(w["y1"] - w["y0"], 2.4)
        shelf = [i for i in rest if abs(pts[i][0] + 1.5) < 0.5 and abs(pts[i][2] + 2.6) < 0.25]
        self.assertGreater(len(shelf), 600, "the bookshelf's points are left for object separation")
        self.assertEqual(sc.find_walls([p for p in pts if abs(p[2] + 3.0) > 0.1], 0.0)[0], [], "a lone bookshelf is not a wall")

    def test_a_long_shelf_top_in_the_wall_band_is_not_a_wall(self):
        rng = random.Random(5)
        floor = [[rng.uniform(-3, 3), rng.gauss(0, 0.005), rng.uniform(-3, 3), 90, 80, 70] for _ in range(1500)]
        shelf = [[rng.uniform(-0.8, 0.8), rng.uniform(1.45, 1.6), rng.uniform(-0.15, 0.15), 200, 200, 200] for _ in range(800)]  # 15 cm deep
        walls, rest = sc.find_walls(floor + shelf, 0.0)
        self.assertEqual(walls, []); self.assertEqual(len(rest), 800, "its points stay free for object separation")
        objects = sc.separate_objects(floor + shelf, 0.0, rest)
        self.assertEqual(len(objects), 1); self.assertAlmostEqual(objects[0]["length"], 1.6, delta=0.1)

    def test_every_object_is_separated_and_measured(self):
        pts = room_cloud(); _, rest = sc.find_walls(pts, 0.0)
        objects = sc.separate_objects(pts, 0.0, rest)
        self.assertEqual(len(objects), 3, [(round(o["length"], 2), round(o["thickness"], 2)) for o in objects])
        by_height = sorted(objects, key=lambda o: o["y1"] - o["y0"])
        for o, (length, width, height, cx, cz) in zip(by_height, [(1.6, 0.8, 0.75, 0.8, -0.5), (0.5, 0.5, 0.9, -1.0, 0.6), (0.9, 0.4, 1.8, -1.5, -2.6)]):
            with self.subTest(height=height):
                self.assertAlmostEqual(o["length"], length, delta=0.1); self.assertAlmostEqual(o["thickness"], width, delta=0.1)
                self.assertAlmostEqual(o["y1"] - o["y0"], height, delta=0.08); self.assertEqual(o["y0"], 0.0)
                self.assertAlmostEqual(o["centre"][0], cx, delta=0.08); self.assertAlmostEqual(o["centre"][1], cz, delta=0.08)
        table = by_height[0]; yaw = math.degrees(table["yaw"]) % 180
        self.assertLess(min(abs(yaw - 30), 180 - abs(yaw - 30)), 5)

    def test_furniture_over_unseen_floor_stands_on_it_and_an_object_over_seen_floor_does_not(self):
        rng = random.Random(9); floor = []
        for _ in range(6000):  # 8 x 8 m of floor, with no points under the sofa (x 1..3, z 1..2)
            x, z = rng.uniform(-4, 4), rng.uniform(-4, 4)
            if not (1 <= x <= 3 and 1 <= z <= 2): floor.append([x, rng.gauss(0, 0.005), z, 90, 80, 70])
        sofa = [[rng.uniform(1, 3), rng.uniform(0.5, 0.9), rng.uniform(1, 2), 60, 60, 60] for _ in range(600)]  # seat and back only
        shelf = [[rng.uniform(-2, -1), rng.uniform(0.6, 0.8), rng.uniform(-2, -1.5), 200, 200, 200] for _ in range(300)]  # floor seen below
        cup = [[rng.uniform(-3.1, -2.9), rng.uniform(0.55, 0.75), rng.uniform(2.9, 3.1), 250, 250, 250] for _ in range(60)]
        pts = floor + sofa + shelf + cup; cover = sc.floor_coverage(pts, 0.0, 0.05)
        rest = [i for i, p in enumerate(pts) if p[1] > 0.05]
        found = {round(o["centre"][0]): o for o in sc.separate_objects(pts, 0.0, rest, min_points=30, floor=cover)}
        self.assertEqual((found[2]["y0"], found[2].get("base")), (0.0, "inferred"), "the sofa stands on the floor nobody saw")
        self.assertAlmostEqual(found[-2]["y0"], 0.6, delta=0.02); self.assertNotIn("base", found[-2])
        self.assertAlmostEqual(found[-3]["y0"], 0.55, delta=0.02, msg="a footprint too small to judge is never grounded")
        plain = {round(o["centre"][0]): o for o in sc.separate_objects(pts, 0.0, rest, min_points=30)}
        self.assertAlmostEqual(plain[2]["y0"], 0.5, delta=0.02, msg="without the floor's coverage nothing is inferred")

    def test_a_sparse_rooms_chair_is_an_object_however_many_points_its_walls_carry(self):
        # 30,000 wall points and a compact 45-point object: a minimum of 0.3% of the whole cloud (90) left it as points.
        rng = random.Random(4); walls = []
        for _ in range(30000):
            side, u, y = rng.randrange(4), rng.uniform(0, 1), rng.uniform(0.2, 2.6)
            walls.append([(6 * u, y, 0), (6 * u, y, 4.8), (0, y, 4.8 * u), (6, y, 4.8 * u)][side] + (0, 0, 0))
        chair = [[rng.uniform(2.0, 2.3), rng.uniform(0.4, 0.6), rng.uniform(2.0, 2.3), 50, 50, 50] for _ in range(45)]
        pts = [list(p) for p in walls] + chair; rest = list(range(len(walls), len(pts)))
        objects = sc.separate_objects(pts, 0.0, rest)
        self.assertEqual(len(objects), 1); self.assertAlmostEqual(objects[0]["length"], 0.3, delta=0.08)

    def test_detections_name_the_object_they_overlap(self):
        pts = room_cloud(); _, rest = sc.find_walls(pts, 0.0)
        objects = sc.separate_objects(pts, 0.0, rest)
        chair = {"label": "chair", "detector": "detr", "min": [-1.3, 0.0, 0.3], "max": [-0.7, 1.0, 0.9]}
        nowhere = {"label": "tv", "detector": "detr", "min": [5, 0, 5], "max": [6, 1, 6]}
        left = sc.label_objects(objects, pts, [chair, nowhere])
        self.assertEqual(left, [nowhere])
        named = [o for o in objects if o.get("label") == "chair"]
        self.assertEqual(len(named), 1); self.assertAlmostEqual(named[0]["y1"] - named[0]["y0"], 0.9, delta=0.08)


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
        # A flat axis on a cell boundary still counts one cell, so the other axis alone is bounded.
        self.assertEqual(sc.grid_cells([-9e6, 9e6], [0, 0]), 36_000_000)

    def test_multi_view_comes_from_colmap_or_an_explicit_flag(self):
        self.assertTrue(sc.multi_view({"sourceFrame": "colmap"}))
        self.assertTrue(sc.multi_view({"sourceFrame": "right-handed-y-up", "multiView": True}))
        for cloud in [{"sourceFrame": "right-handed-y-up"}, {"sourceFrame": "right-handed-y-up", "multiView": "yes"}, {}]:
            self.assertFalse(sc.multi_view(cloud))



class Names(unittest.TestCase):
    def objects(self):
        return [{"centre": [0.8, -0.5], "y0": 0.0, "y1": 0.75}, {"centre": [-1.0, 0.6], "y0": 0.0, "y1": 0.9},
                {"centre": [2.0, 2.0], "y0": 0.0, "y1": 1.8, "label": "bookshelf", "detector": "detr"}]

    def test_names_land_on_the_object_they_were_made_for(self):
        objects = self.objects()
        names = {"model": "claude-opus-5-5", "objects": [
            {"label": "dining table", "category": "furniture", "confidence": "high", "centre": [0.82, -0.48], "height": 0.75},
            {"label": "floor lamp", "category": "lighting", "confidence": "medium", "centre": [-1.0, 0.6], "height": 0.9}]}
        self.assertEqual(sc.apply_names(objects, names), 2)
        self.assertEqual((objects[0]["label"], objects[0]["ifcClass"], objects[0]["labelReviewed"]), ("dining table", "IfcFurniture", False))
        self.assertEqual((objects[1]["label"], objects[1]["ifcClass"], objects[1]["detector"]), ("floor lamp", "IfcBuildingElementProxy", "claude-opus-5-5"))

    def test_low_confidence_far_wrong_height_and_already_named_objects_keep_their_names(self):
        objects = self.objects()
        names = {"model": "m", "objects": [
            {"label": "table", "category": "furniture", "confidence": "low", "centre": [0.8, -0.5]},
            {"label": "unknown", "category": "unknown", "confidence": "high", "centre": [0.8, -0.5]},
            {"label": "lamp", "category": "lighting", "confidence": "high", "centre": [-1.3, 0.6]},
            {"label": "chair", "category": "furniture", "confidence": "high", "centre": [-1.0, 0.6], "height": 0.45},
            {"label": "cabinet", "category": "furniture", "confidence": "high", "centre": [2.0, 2.0], "height": 1.8}]}
        self.assertEqual(sc.apply_names(objects, names), 0)
        self.assertEqual([o.get("label") for o in objects], [None, None, "bookshelf"])
        self.assertEqual(sc.apply_names(objects, None), 0)
