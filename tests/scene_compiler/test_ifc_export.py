"""IFC4 export contracts without Blender or IfcOpenShell: python3 -m unittest tests.scene_compiler.test_ifc_export
(IfcOpenShell's full EXPRESS validation of real scenes is a local check; see docs/world-studio-implementation.md.)"""
import re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "scene_compiler"))
import ifc_export as ie


def metric_scene(**over):
    scene = {"schema": "brainsnn.scene.v1", "units": "m", "floor_y": -0.4,
             "scale": {"source": "user-measured", "metresPerUnit": 0.136, "distance": 2.976, "selfReported": True, "verified": False},
             "objects": [{"name": "floor_observed", "label": "floor", "provenance": "observed", "centre": [0, -0.41, 2], "size": [3, 0.02, 2.4]},
                         {"name": "chair_0", "label": "chair", "provenance": "detected", "centre": [1, 0, 2], "size": [0.5, 0.9, 0.5], "support_points": 40, "detector": "detr"},
                         {"name": "tv_1", "label": "tv", "provenance": "detected-unplaced", "reason": "no camera pose"}],
             "walls": [{"name": "wall_1", "label": "wall", "provenance": "observed", "centre": [0, 0.5, 3], "size": [2, 1.8, 0.2], "yaw_degrees": 90, "support_points": 120}],
             "unknown": [[0, 0, 0.5], [0.5, 0, 0.5], [1.5, 0, 0.5], [0, 0.5, 0.5]]}
    scene.update(over)
    return scene


def parse(text):
    rows = dict(re.findall(r"^(#\d+)=(.*);$", text, re.M))
    return rows, {ref for body in rows.values() for ref in re.findall(r"#\d+", body)}


class IfcExport(unittest.TestCase):
    def test_metric_scene_writes_a_self_consistent_ifc4_file(self):
        with tempfile.TemporaryDirectory() as d:
            scene = metric_scene(); record = ie.emit_ifc(d, scene)
            self.assertEqual(record, {"written": True, "schema": "IFC4", "elements": {"walls": 1, "slabs": 1, "objects": 1, "separated": 0, "unknownRuns": 3}})
            text = (Path(d) / "scene.ifc").read_text(encoding="ascii")
        self.assertTrue(text.startswith("ISO-10303-21;") and "FILE_SCHEMA(('IFC4'));" in text and text.rstrip().endswith("END-ISO-10303-21;"))
        rows, refs = parse(text)
        self.assertLessEqual(refs, set(rows), "every #reference resolves")
        kinds = [body.split("(")[0] for body in rows.values()]
        for kind, n in [("IFCWALL", 1), ("IFCSLAB", 1), ("IFCFURNITURE", 1), ("IFCBUILDINGELEMENTPROXY", 1), ("IFCPROJECT", 1),
                        ("IFCBUILDINGSTOREY", 1), ("IFCRELCONTAINEDINSPATIALSTRUCTURE", 1), ("IFCPROPERTYSET", 5)]:
            self.assertEqual(kinds.count(kind), n, kind)
        self.assertIn("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)", text)
        guids = re.findall(r"IFC[A-Z]+\('([0-9A-Za-z_$]{22})'", text)
        self.assertEqual(len(guids), len(set(guids)))
        # Provenance travels with each element; the unplaced detection has no geometry and is not invented.
        self.assertIn("IFCLABEL('detected')", text); self.assertIn("IFCLABEL('unknown')", text); self.assertNotIn("tv", text)
        self.assertIn("IFCPROPERTYSINGLEVALUE('MetricVerified',$,IFCBOOLEAN(.F.),$)", text)
        self.assertIn("IFCPROPERTYSINGLEVALUE('SelfReported',$,IFCBOOLEAN(.T.),$)", text)
        # A wall at 90° yaw (Y-up) runs along -Y in IFC's Z-up frame: Blender and IFC use the same (x, -z, y) mapping.
        self.assertIn("IFCDIRECTION((0.,-1.,0.))", text)
        self.assertIn("IFCCARTESIANPOINT((0.,-3.,-0.4))", text)  # wall base: centre y 0.5 minus half its 1.8 m height

    def test_separated_objects_keep_their_orientation_and_measurements(self):
        separated = [{"name": "object_1", "label": "object", "provenance": "observed", "kind": "separated", "centre": [1, 0.45, -2],
                      "size": [1.6, 0.9, 0.8], "yaw_degrees": 90, "support_points": 300},
                     {"name": "object_2", "label": "chair", "provenance": "observed", "kind": "separated", "centre": [0, 0.45, 0],
                      "size": [0.5, 0.9, 0.5], "yaw_degrees": 0, "support_points": 120, "labelSource": "detr"}]
        with tempfile.TemporaryDirectory() as d:
            record = ie.emit_ifc(d, metric_scene(objects=separated, walls=[], unknown=[]))
            text = (Path(d) / "scene.ifc").read_text(encoding="ascii")
        self.assertEqual(record["elements"], {"walls": 0, "slabs": 0, "objects": 0, "separated": 2, "unknownRuns": 0})
        rows, refs = parse(text); self.assertLessEqual(refs, set(rows))
        # Unnamed: a proxy called "Object 1", not furniture. Named by a detector: furniture.
        self.assertIn("IFCBUILDINGELEMENTPROXY(", text); self.assertIn("'Object 1'", text); self.assertIn("IFCFURNITURE(", text); self.assertIn("'chair'", text)
        for key, value in (("LengthMetres", "1.6"), ("WidthMetres", "0.8"), ("HeightMetres", "0.9"), ("Detector", "'detr'")):
            self.assertRegex(text, rf"IFCPROPERTYSINGLEVALUE\('{key}',\$,IFC(REAL|LABEL)\({value}")
        self.assertIn("IFCDIRECTION((0.,-1.,0.))", text)  # 90 degrees of yaw (Y-up) runs along -Y in IFC, like walls
        self.assertIn("IFCCARTESIANPOINT((1.,2.,0.))", text)  # the box stands on its base: centre y 0.45 minus half its height

    def test_model_named_objects_say_they_are_unreviewed_and_only_furniture_is_furniture(self):
        named = [{"name": "object_1", "label": "sofa", "provenance": "observed", "kind": "separated", "centre": [0, 0.45, 0], "size": [2, 0.9, 0.9],
                  "yaw_degrees": 0, "labelSource": "claude-opus-5-5", "labelConfidence": "high", "labelReviewed": False, "ifcClass": "IfcFurniture"},
                 {"name": "object_2", "label": "potted plant", "provenance": "observed", "kind": "separated", "centre": [2, 0.6, 0], "size": [0.4, 1.2, 0.4],
                  "yaw_degrees": 0, "labelSource": "claude-opus-5-5", "labelConfidence": "medium", "labelReviewed": False, "ifcClass": "IfcBuildingElementProxy"}]
        with tempfile.TemporaryDirectory() as d:
            record = ie.emit_ifc(d, metric_scene(objects=named, walls=[], unknown=[]))
            text = (Path(d) / "scene.ifc").read_text(encoding="ascii")
        self.assertEqual(record["elements"]["separated"], 2)
        self.assertRegex(text, r"IFCFURNITURE\('[^']+',\$,'sofa'"); self.assertRegex(text, r"IFCBUILDINGELEMENTPROXY\('[^']+',\$,'potted plant','[^']*not reviewed")
        self.assertEqual(text.count("IFCPROPERTYSINGLEVALUE('LabelReviewed',$,IFCBOOLEAN(.F.),$)"), 2)
        self.assertIn("IFCPROPERTYSINGLEVALUE('Detector',$,IFCLABEL('claude-opus-5-5'),$)", text)
        self.assertIn("IFCPROPERTYSINGLEVALUE('LabelConfidence',$,IFCLABEL('medium'),$)", text)

    def test_arbitrary_units_write_no_ifc_and_remove_a_stale_one(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "scene.ifc").write_text("stale")
            record = ie.emit_ifc(d, metric_scene(units="arbitrary"))
            self.assertEqual(record["written"], False); self.assertIn("metres", record["reason"])
            self.assertFalse((Path(d) / "scene.ifc").exists())
        with self.assertRaises(ValueError):
            ie.write_ifc("unused.ifc", metric_scene(units="arbitrary"))

    def test_unknown_cells_merge_into_runs_and_labels_are_escaped(self):
        self.assertEqual(ie.merge_unknown([[0, 0, .5], [.5, 0, .5], [1.5, 0, .5], [0, .5, .5]]), [(0, 1.0, 0, .5), (1.5, 2.0, 0, .5), (0, .5, .5, .5)])
        self.assertEqual(ie.label("O'Brien\\é😀"), "'O''Brien\\\\\\X2\\00E9\\X0\\?'")
        self.assertEqual(len(ie.ifc_guid("x")), 22); self.assertEqual(ie.ifc_guid("x"), ie.ifc_guid("x")); self.assertNotEqual(ie.ifc_guid("x"), ie.ifc_guid("y"))
        self.assertEqual(ie.real(2), "2."); self.assertEqual(ie.real(-0.25), "-0.25")
