"""The building model's identity and provenance contracts: python3 -m unittest tests.scene_compiler.test_building_model

An element keeps its ID through a recompile that finds it again, whatever order the compiler lists it in. A wall is its
observed face with an inferred thickness behind it. Openings are hosted by wall ID. Two captures never share a model ID,
and so never share an IFC GlobalId."""
import copy, math, re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "scene_compiler"))
import building_model as bm
import ifc_export as ie

W, D, H, T = 6.0, 4.8, 2.7, 0.12  # the benchmark meeting room


def wall(name, a, b, height=H, thickness=T):
    (ax, az), (bx, bz) = a, b
    return {"name": name, "label": "wall", "provenance": "observed", "centre": [(ax + bx) / 2, height / 2, (az + bz) / 2],
            "size": [math.hypot(bx - ax, bz - az), height, thickness], "yaw_degrees": math.degrees(math.atan2(bz - az, bx - ax)), "support_points": 900}


def room(order=(0, 1, 2, 3), jitter=0.0, openings=()):
    """The compiled scene of a 6 x 4.8 m room: four faces, the observed floor and a table, walls in `order`."""
    faces = [((0, 0), (W, 0)), ((W, 0), (W, D)), ((W, D), (0, D)), ((0, D), (0, 0))]
    walls = []
    for n, i in enumerate(order):
        (ax, az), (bx, bz) = faces[i]
        walls.append(wall(f"wall_{n + 1}", (ax + jitter, az - jitter), (bx + jitter, bz - jitter)))
    floor = {"name": "floor_observed", "label": "floor", "provenance": "observed", "centre": [W / 2, -0.01, D / 2], "size": [W, 0.02, D],
             "min": [0, -0.02, 0], "max": [W, 0, D]}
    table = {"name": "object_1", "label": "table", "provenance": "observed", "kind": "separated", "centre": [3, 0.37, 2.4],
             "size": [2.4, 0.74, 1.0], "yaw_degrees": 0, "support_points": 139}
    scene = {"schema": "brainsnn.scene.v1", "units": "m", "floor_y": 0.0,
             "scale": {"source": "user-measured", "metresPerUnit": 0.5675, "distance": 2.4, "selfReported": True, "verified": False},
             "objects": [floor, table], "walls": walls, "unknown": [[0, 0, 0.5]]}
    for o in openings:
        host = next(w for w in walls if w["name"] == o["hostWall"])
        scene.setdefault("openings", []).append({**o, "reviewed": True, "host": {k: copy.deepcopy(host[k]) for k in ("centre", "size", "yaw_degrees")}})
    return scene


POINTS = [[0.1 * i, 0, 0.2 * i, 90, 80, 70] for i in range(50)]


def walls_of(building):
    return [e for e in building["elements"] if e["kind"] == "wall"]


def face_of(building, ident):
    return next(e for e in building["elements"] if e["id"] == ident)["face"]


class BuildingModel(unittest.TestCase):
    def test_a_wall_is_its_observed_face_with_the_inferred_thickness_behind_it(self):
        b = bm.build(room(), POINTS)
        self.assertEqual(b["schema"], "brainsnn.building.v1")
        for w in walls_of(b):
            self.assertEqual(w["provenance"]["face"], "observed"); self.assertEqual(w["provenance"]["thickness"], "inferred")
            fx, fz = [(s + e) / 2 for s, e in zip(w["face"]["start"], w["face"]["end"])]
            cx, cz = [(s + e) / 2 for s, e in zip(w["centreline"]["start"], w["centreline"]["end"])]
            centre = (W / 2, D / 2)
            # The centreline is half a thickness further from the room than the face: the box no longer stands inside.
            self.assertAlmostEqual(math.dist((cx, cz), (fx, fz)), T / 2, places=6)
            self.assertGreater(abs(cx - centre[0]) + abs(cz - centre[1]), abs(fx - centre[0]) + abs(fz - centre[1]))
        storey = next(e for e in b["elements"] if e["kind"] == "storey")
        self.assertTrue(all(e["storey"] == storey["id"] for e in b["elements"] if e["kind"] != "storey"))
        self.assertEqual(len({e["id"] for e in b["elements"]}), len(b["elements"]), "IDs are unique in a model")

    def test_ids_survive_a_recompile_that_lists_the_walls_in_another_order(self):
        first = bm.build(room(), POINTS)
        again = bm.build(room(order=(2, 0, 3, 1), jitter=0.008), POINTS, previous=first)
        self.assertEqual(again["model"]["id"], first["model"]["id"])
        for w in walls_of(first):  # the same face carries the same ID, though its compiled name changed
            match = next(x for x in walls_of(again) if x["id"] == w["id"])
            self.assertLess(math.dist(match["face"]["start"], w["face"]["start"]), 0.02)
        self.assertNotEqual([w["name"] for w in walls_of(again) if w["id"] == walls_of(first)[0]["id"]], ["wall_1"])
        self.assertEqual(again["identity"]["matched"], {"storey": 1, "slab": 1, "wall": 4, "object": 1})
        self.assertEqual((again["identity"]["added"], again["identity"]["removed"]), ([], []))

    def test_a_wall_that_is_gone_is_removed_and_a_new_one_is_added(self):
        first = bm.build(room(), POINTS)
        scene = room(); scene["walls"] = scene["walls"][:3] + [wall("wall_4", (1.5, 0.8), (1.5, 3.8))]  # a partition, not the west wall
        again = bm.build(scene, POINTS, previous=first)
        west = walls_of(first)[3]["id"]
        self.assertEqual(again["identity"]["removed"], [west])
        self.assertEqual(len(again["identity"]["added"]), 1); self.assertNotIn(west, again["identity"]["added"])

    def test_openings_are_hosted_by_wall_id_and_follow_it_through_a_recompile(self):
        door = {"id": "entry", "hostWall": "wall_3", "offsetMeters": 0.5, "widthMeters": 0.9, "heightMeters": 2.0, "sillMeters": 0, "kind": "door"}
        first = bm.build(room(openings=[door]), POINTS)
        host = next(e for e in first["elements"] if e["id"] == "entry")["host"]
        self.assertEqual(face_of(first, host), walls_of(first)[2]["face"])
        moved = dict(door, hostWall="wall_1")  # after the reorder, the same face is wall_1
        again = bm.build(room(order=(2, 0, 3, 1), openings=[moved]), POINTS, previous=first)
        self.assertEqual(next(e for e in again["elements"] if e["id"] == "entry")["host"], host)
        self.assertEqual(next(e for e in again["elements"] if e["id"] == "entry")["review"], {"state": "accepted", "selfReported": True})

    def test_a_review_carries_over_only_while_the_element_has_not_moved(self):
        first = bm.build(room(), POINTS)
        for e in first["elements"]:
            e["review"] = {"state": "accepted"}
        still = bm.build(room(jitter=0.01), POINTS, previous=first)
        self.assertTrue(all(w["review"] == {"state": "accepted"} for w in walls_of(still)))
        shifted = bm.build(room(jitter=0.05), POINTS, previous=first)
        self.assertTrue(all(w["review"]["state"] == "needs-review" and w["review"]["previousState"] == "accepted" for w in walls_of(shifted)))

    def test_a_new_capture_in_its_own_frame_matches_nothing_and_says_so(self):
        first = bm.build(room(), POINTS)
        scene = room()
        for w in scene["walls"] + scene["objects"]:  # the same room, 20 m away in another reconstruction's frame
            w["centre"][0] += 20
            for key in ("min", "max"):
                if key in w:
                    w[key][0] += 20
        again = bm.build(scene, POINTS, previous=first)
        self.assertEqual(again["identity"]["matched"], {"storey": 1, "slab": 1})
        self.assertEqual(len(again["identity"]["removed"]), 5)

    def test_two_captures_never_share_a_model_id_or_an_ifc_global_id(self):
        one, other = bm.build(room(), POINTS), bm.build(room(), POINTS[1:])
        self.assertEqual(bm.build(room(), POINTS)["model"]["id"], one["model"]["id"], "the same points give the same model")
        self.assertNotEqual(one["model"]["id"], other["model"]["id"])
        texts = []
        for b in (one, other):
            scene = bm.stamp(room(), b)
            with tempfile.TemporaryDirectory() as d:
                ie.emit_ifc(d, scene); texts.append((Path(d) / "scene.ifc").read_text())
        ids = [set(re.findall(r"^#\d+=IFC(?!PROPERTYSINGLEVALUE)\w+\('([0-9A-Za-z_$]{22})'", t, re.M)) for t in texts]
        self.assertTrue(ids[0] and ids[1]); self.assertFalse(ids[0] & ids[1], "no GlobalId is shared between captures")
        self.assertIn(f"'ModelId',$,IFCLABEL('{one['model']['id']}')", texts[0])
        self.assertIn(f"'ElementId',$,IFCLABEL('{walls_of(one)[0]['id']}')", texts[0])

    def test_a_wall_keeps_its_ifc_global_id_through_a_reorder(self):
        first = bm.build(room(), POINTS)
        again = bm.build(room(order=(2, 0, 3, 1)), POINTS, previous=first)
        def guid_by_face(b, scene):  # each physical face's GlobalId, whatever the compiler named it
            with tempfile.TemporaryDirectory() as d:
                ie.emit_ifc(d, bm.stamp(scene, b)); text = (Path(d) / "scene.ifc").read_text()
            faces = {w["name"]: (round(w["centre"][0], 2), round(w["centre"][2], 2)) for w in scene["walls"]}
            return {faces[name]: guid for guid, name in re.findall(r"IFCWALL\('([^']+)',\$,'([^']+)'", text)}
        before, after = guid_by_face(first, room()), guid_by_face(again, room(order=(2, 0, 3, 1)))
        self.assertEqual(len(before), 4); self.assertEqual(before, after)

    def test_a_previous_model_in_other_units_is_not_matched(self):
        first = bm.build(room(), POINTS); first["units"] = "arbitrary"
        again = bm.build(room(), POINTS, previous=first)
        self.assertIsNone(again["identity"]["previousModel"]); self.assertIn("other units", again["identity"]["note"])


if __name__ == "__main__":
    unittest.main()
