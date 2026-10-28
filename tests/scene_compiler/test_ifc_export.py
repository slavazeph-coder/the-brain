"""IFC4 export contracts without Blender or IfcOpenShell: python3 -m unittest tests.scene_compiler.test_ifc_export
(IfcOpenShell's full EXPRESS validation of real scenes is a local check; see docs/world-studio-implementation.md.)"""
import copy, re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "robotics" / "scene_compiler"))
import ifc_export as ie
from component_graph import attach_component_ids, apply_edits, scene_sha256, EDIT_SCHEMA


def metric_scene(**over):
    scene = {"schema": "brainsnn.scene.v1", "units": "m", "floor_y": -0.4,
             "scale": {"source": "user-measured", "metresPerUnit": 0.136, "distance": 2.976, "selfReported": True, "verified": False},
             "objects": [{"name": "floor_observed", "label": "floor", "provenance": "observed", "centre": [0, -0.41, 2], "size": [3, 0.02, 2.4]},
                         {"name": "chair_0", "label": "chair", "ifcClass": "IfcFurniture", "provenance": "detected", "centre": [1, 0, 2], "size": [0.5, 0.9, 0.5], "support_points": 40, "detector": "detr"},
                         {"name": "tv_1", "label": "tv", "provenance": "detected-unplaced", "reason": "no camera pose"}],
             "walls": [{"name": "wall_1", "label": "wall", "provenance": "observed", "centre": [0, 0.5, 3], "size": [2, 1.8, 0.2], "yaw_degrees": 90, "support_points": 120}],
             "unknown": [[0, 0, 0.5], [0.5, 0, 0.5], [1.5, 0, 0.5], [0, 0.5, 0.5]]}
    scene.update(over)
    return scene


def parse(text):
    rows = dict(re.findall(r"^(#\d+)=(.*);$", text, re.M))
    return rows, {ref for body in rows.values() for ref in re.findall(r"#\d+", body)}


class IfcExport(unittest.TestCase):
    def test_source_scoped_ids_survive_label_edits_and_do_not_alias_other_captures(self):
        first = attach_component_ids(metric_scene(), 'a' * 64)
        renamed = apply_edits(first, {'schema': EDIT_SCHEMA, 'sourceSha256': 'a' * 64,
            'sceneSha256': scene_sha256(first), 'revision': 0, 'edits': [
                {'op': 'label', 'componentId': first['objects'][1]['componentId'], 'label': 'reviewed chair name'},
                {'op': 'label', 'componentId': first['walls'][0]['componentId'], 'label': 'North partition'}]})
        other = attach_component_ids(metric_scene(), 'b' * 64)
        with tempfile.TemporaryDirectory() as d:
            texts = []
            for index, scene in enumerate((first, renamed, other)):
                path = Path(d) / f'{index}.ifc'; ie.write_ifc(path, scene, name=f'Presentation title {index}')
                texts.append(path.read_text())
        def ids(text):
            return set(re.findall(r"IFC[A-Z]+\('([0-3][0-9A-Za-z_$]{21})'", text))
        self.assertEqual(ids(texts[0]), ids(texts[1]), 'presentation names do not replace component or hierarchy identity')
        self.assertIn("'North partition'", texts[1])
        self.assertTrue(ids(texts[0]).isdisjoint(ids(texts[2])), 'even identical geometry from another capture is a separate model')
        for item in first['objects'][:2] + first['walls']:
            self.assertIn(f"IFCLABEL('{item['componentId']}')", texts[0])
            self.assertIn(f"'{ie.ifc_guid(item['componentId'])}'", texts[0])
        self.assertIn(f"'SourceSha256',$,IFCLABEL('{'a' * 64}')", texts[0])

    def test_legacy_export_namespace_is_geometry_derived_and_ignores_receipts_and_labels(self):
        first = metric_scene(); renamed = copy.deepcopy(first)
        renamed['objects'][1]['label'] = 'chair renamed'
        renamed['ifc'] = {'written': True}; renamed['cad'] = {'written': True}
        changed = metric_scene(); changed['walls'][0]['centre'][0] += 1
        with tempfile.TemporaryDirectory() as d:
            models = []
            for index, scene in enumerate((first, renamed, changed)):
                path = Path(d) / f'{index}.ifc'; ie.write_ifc(path, scene)
                models.append(path.read_text())
        project_id = lambda text: re.search(r"IFCPROJECT\('([^']+)'", text).group(1)
        self.assertEqual(project_id(models[0]), project_id(models[1]))
        self.assertNotEqual(project_id(models[0]), project_id(models[2]))
        self.assertNotIn('componentGraph', first, 'standalone export does not mutate the source scene')

    def reviewed_scene(self, kind='opening'):
        wall = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', 'centre': [0, 1.5, 0],
                'size': [4, 3, .2], 'yaw_degrees': 30, 'support_points': 120}
        opening = {'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1, 'widthMeters': 1,
                   'heightMeters': 2, 'sillMeters': 0, 'kind': kind, 'reviewed': True,
                   'host': {key: copy.deepcopy(wall[key]) for key in ('centre', 'size', 'yaw_degrees')}}
        return metric_scene(objects=[], walls=[wall], unknown=[], openings=[opening])

    def test_reviewed_openings_are_hosted_voids_and_doors_are_explicit_fillings(self):
        for kind in ('opening', 'door'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                record = ie.emit_ifc(d, self.reviewed_scene(kind))
                text = (Path(d) / 'scene.ifc').read_text()
                self.assertEqual(record['elements']['openings'], 1)
                self.assertEqual(record['elements']['doors'], int(kind == 'door'))
                rows, refs = parse(text); self.assertLessEqual(refs, set(rows))
                kinds = [body.split('(')[0] for body in rows.values()]
                self.assertEqual(kinds.count('IFCOPENINGELEMENT'), 1)
                self.assertEqual(kinds.count('IFCRELVOIDSELEMENT'), 1)
                self.assertEqual(kinds.count('IFCRELFILLSELEMENT'), int(kind == 'door'))
                self.assertEqual(kinds.count('IFCDOOR'), int(kind == 'door'))
                self.assertIn("'ReviewSelfReported',$,IFCBOOLEAN(.T.)", text)
                self.assertIn("'ClearanceVerified',$,IFCBOOLEAN(.F.)", text)

    def test_stale_unreviewed_overlapping_or_out_of_bounds_openings_are_refused(self):
        original = self.reviewed_scene()
        variants = []
        for key, value in [('reviewed', False), ('widthMeters', 5), ('hostWall', 'missing'), ('heightMeters', float('nan'))]:
            scene = copy.deepcopy(original); scene['openings'][0][key] = value; variants.append(scene)
        stale = copy.deepcopy(original); stale['walls'][0]['centre'][0] += .1; variants.append(stale)
        overlap = copy.deepcopy(original); overlap['openings'].append({**copy.deepcopy(overlap['openings'][0]), 'id': 'other'}); variants.append(overlap)
        with tempfile.TemporaryDirectory() as d:
            for index, scene in enumerate(variants):
                path = Path(d) / f'invalid-{index}.ifc'
                with self.subTest(index=index), self.assertRaises(ValueError):
                    ie.write_ifc(path, scene)
                self.assertFalse(path.exists())

    def test_ifcopenshell_validates_and_subtracts_the_rotated_host_void(self):
        try:
            import ifcopenshell
            import ifcopenshell.geom
            import ifcopenshell.util.shape
            import ifcopenshell.validate
        except ImportError:
            self.skipTest('IfcOpenShell is needed for actual schema and solid validation.')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'scene.ifc'; ie.emit_ifc(d, self.reviewed_scene('door'))
            model = ifcopenshell.open(path)
            log = ifcopenshell.validate.json_logger()
            ifcopenshell.validate.validate(model, log, express_rules=True)
            self.assertEqual(log.statements, [])
            wall = model.by_type('IfcWall')[0]; opening = model.by_type('IfcOpeningElement')[0]; door = model.by_type('IfcDoor')[0]
            self.assertEqual(opening.VoidsElements[0].RelatingBuildingElement, wall)
            self.assertEqual(door.FillsVoids[0].RelatingOpeningElement, opening)
            self.assertEqual(opening.ObjectPlacement.PlacementRelTo, wall.ObjectPlacement)
            self.assertEqual(door.ObjectPlacement.PlacementRelTo, opening.ObjectPlacement)
            self.assertEqual(door.OverallWidth, 1); self.assertEqual(door.OverallHeight, 2)
            settings = ifcopenshell.geom.settings()
            actual = ifcopenshell.geom.create_shape(settings, wall)
            # 4*3*.2 = 2.4 m3 wall; the actual IFC void removes 1*2*.2 = .4 m3, even at 30 degrees yaw.
            self.assertAlmostEqual(ifcopenshell.util.shape.get_volume(actual.geometry), 2.0, places=6)
            leaf = ifcopenshell.geom.create_shape(settings, door)
            self.assertAlmostEqual(ifcopenshell.util.shape.get_volume(leaf.geometry), .1, places=6)
            saved = Path(d) / 'roundtrip.ifc'; model.write(saved); reopened = ifcopenshell.open(saved)
            self.assertEqual(reopened.by_type('IfcOpeningElement')[0].GlobalId, opening.GlobalId)
            self.assertEqual(reopened.by_type('IfcDoor')[0].FillsVoids[0].RelatingOpeningElement.GlobalId, opening.GlobalId)

    def test_ifcopenshell_reopens_shared_component_and_host_identity(self):
        try:
            import ifcopenshell
            import ifcopenshell.util.element
        except ImportError:
            self.skipTest('IfcOpenShell is needed for actual identity roundtrip validation.')
        scene = attach_component_ids(self.reviewed_scene('door'), 'c' * 64)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'scene.ifc'; ie.write_ifc(path, scene)
            model = ifcopenshell.open(path); saved = Path(d) / 'saved.ifc'; model.write(saved)
            reopened = ifcopenshell.open(saved)
            wall = reopened.by_type('IfcWall')[0]; opening = reopened.by_type('IfcOpeningElement')[0]; door = reopened.by_type('IfcDoor')[0]
            props = lambda element: ifcopenshell.util.element.get_pset(element, 'Pset_BrainSNN')
            reviewed = scene['openings'][0]
            self.assertEqual(props(wall)['ComponentId'], scene['walls'][0]['componentId'])
            self.assertEqual(props(opening)['ComponentId'], reviewed['componentId'])
            self.assertEqual(props(opening)['HostComponentId'], props(wall)['ComponentId'])
            self.assertEqual(props(door)['ComponentId'], reviewed['doorComponentId'])
            self.assertEqual(props(door)['OpeningComponentId'], props(opening)['ComponentId'])
            self.assertEqual(props(door)['HostComponentId'], props(wall)['ComponentId'])
            self.assertEqual(opening.VoidsElements[0].RelatingBuildingElement.GlobalId, wall.GlobalId)
            self.assertEqual(door.FillsVoids[0].RelatingOpeningElement.GlobalId, opening.GlobalId)

    def test_wall_candidate_and_legacy_spread_labels_never_become_verified_measurements(self):
        scene = metric_scene()
        wall = scene['walls'][0]
        wall.update(thicknessBasis='measured: both faces seen', thicknessMeasured=True)
        with tempfile.TemporaryDirectory() as d:
            ie.emit_ifc(d, scene)
            legacy = (Path(d) / 'scene.ifc').read_text()
            self.assertNotIn('measured: both faces seen', legacy)
            self.assertIn("IFCPROPERTYSINGLEVALUE('ThicknessMeasured',$,IFCBOOLEAN(.F.),$)", legacy)
            wall['wallEvidence'] = {'schema': 'brainsnn.wall-evidence.v1', 'status': 'two-surface-candidate',
                                    'thickness_m': .08, 'matched_cells': 12, 'subset_reviewed': False}
            ie.emit_ifc(d, scene)
            text = (Path(d) / 'scene.ifc').read_text()
        self.assertIn("IFCPROPERTYSINGLEVALUE('ThicknessCandidateMetres',$,IFCREAL(0.08),$)", text)
        self.assertIn("IFCPROPERTYSINGLEVALUE('PhysicalThicknessVerified',$,IFCBOOLEAN(.F.),$)", text)
        self.assertIn("IFCLABEL('candidate finish-face separation: unverified')", text)

    def test_ifcopenshell_reopens_candidate_limits(self):
        try:
            import ifcopenshell
            import ifcopenshell.util.element
        except ImportError:
            self.skipTest('IfcOpenShell is needed for actual evidence roundtrip validation.')
        scene = metric_scene()
        scene['walls'][0]['wallEvidence'] = {'schema': 'brainsnn.wall-evidence.v1', 'status': 'two-surface-candidate',
                                           'thickness_m': .08, 'matched_cells': 12, 'subset_reviewed': False}
        with tempfile.TemporaryDirectory() as d:
            ie.emit_ifc(d, scene)
            model = ifcopenshell.open(Path(d) / 'scene.ifc')
            props = ifcopenshell.util.element.get_pset(model.by_type('IfcWall')[0], 'Pset_BrainSNN')
        self.assertEqual(props['ThicknessCandidateMetres'], .08)
        self.assertFalse(props['PhysicalThicknessVerified'])
        self.assertFalse(props['ThicknessMeasured'])
        self.assertFalse(props['ThicknessSubsetReviewed'])

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
                     {"name": "object_2", "label": "chair", "ifcClass": "IfcFurniture", "provenance": "observed", "kind": "separated", "centre": [0, 0.45, 0],
                      "size": [0.5, 0.9, 0.5], "yaw_degrees": 0, "support_points": 120, "labelSource": "detr"}]
        with tempfile.TemporaryDirectory() as d:
            record = ie.emit_ifc(d, metric_scene(objects=separated, walls=[], unknown=[]))
            text = (Path(d) / "scene.ifc").read_text(encoding="ascii")
        self.assertEqual(record["elements"], {"walls": 0, "slabs": 0, "objects": 0, "separated": 2, "unknownRuns": 0})
        rows, refs = parse(text); self.assertLessEqual(refs, set(rows))
        # Unclassified: a proxy called "Object 1". Explicit furniture type: furniture.
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
        self.assertRegex(text, r"IFCFURNITURE\('[^']+',\$,'sofa'"); self.assertRegex(text, r"IFCBUILDINGELEMENTPROXY\('[^']+',\$,'potted plant','[^']*not independently verified")
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

    def test_the_floor_is_a_slab_by_its_fixed_name_not_its_editable_label(self):
        scene = metric_scene()
        scene["objects"][0]["label"] = "Ground floor"  # an operator's display label for the observed floor
        scene["objects"][1]["label"] = "floor"  # a detected chair someone called floor
        with tempfile.TemporaryDirectory() as d:
            ie.emit_ifc(d, scene); rows, _ = parse((Path(d) / "scene.ifc").read_text(encoding="ascii"))
        slabs = [body for body in rows.values() if body.startswith("IFCSLAB(")]
        self.assertEqual(len(slabs), 1); self.assertIn("'Floor bounding extent'", slabs[0])
        self.assertEqual(sum(body.startswith("IFCFURNITURE(") for body in rows.values()), 1, "the chair stays furniture")

    def test_floor_export_discloses_derived_extent_without_changing_source(self):
        scene = metric_scene(); before = copy.deepcopy(scene)
        with tempfile.TemporaryDirectory() as d:
            ie.emit_ifc(d, scene)
            text = (Path(d) / 'scene.ifc').read_text()
        self.assertEqual(scene['objects'], before['objects'])
        self.assertIn("'Floor bounding extent'", text)
        self.assertIn("'GeometryScope',$,IFCLABEL('derived-point-cloud-floor-bounding-extent')", text)
        self.assertIn("'RoomBoundaryVerified',$,IFCBOOLEAN(.F.)", text)
        self.assertIn("'ElementName',$,IFCLABEL('floor_observed')", text)
        self.assertIn("'SlabThicknessScope',$,IFCLABEL('display thickness; not a measured floor assembly')", text)

    def test_generic_and_unsupported_objects_are_proxies_even_when_named(self):
        items = []
        cases = [('untyped', None, 'chair', 'IfcBuildingElementProxy'),
                 ('duct', 'IfcDuctSegment', 'duct', 'IfcBuildingElementProxy'),
                 ('truss', 'IfcBeam', 'truss', 'IfcBuildingElementProxy'),
                 ('plant', 'IfcBuildingElementProxy', 'plant', 'IfcBuildingElementProxy'),
                 ('furniture', 'IfcFurniture', 'sofa', 'IfcFurniture')]
        for index, (name, assigned, label, expected) in enumerate(cases):
            item = {'name': name, 'label': label, 'provenance': 'detected',
                    'centre': [index, .5, 0], 'size': [.5, 1, .5]}
            if assigned is not None:
                item['ifcClass'] = assigned
            self.assertEqual(ie.object_ifc_class(item), expected)
            items.append(item)
        scene = metric_scene(objects=items, walls=[], unknown=[])
        with tempfile.TemporaryDirectory() as d:
            ie.write_ifc(Path(d) / 'scene.ifc', scene)
            text = (Path(d) / 'scene.ifc').read_text()
        for name, _assigned, label, expected in cases:
            self.assertRegex(text, rf"{expected.upper()}\('[^']+',\$,'{label}'")
        self.assertNotIn('IFCDUCTSEGMENT(', text); self.assertNotIn('IFCBEAM(', text)
        self.assertIn("'RequestedIfcClass',$,IFCLABEL('IfcDuctSegment')", text)

    def test_ifcopenshell_reopens_floor_scope_and_supported_object_classes(self):
        try:
            import ifcopenshell
            import ifcopenshell.util.element
            import ifcopenshell.validate
        except ImportError:
            self.skipTest('IfcOpenShell is needed for actual type and scope validation.')
        scene = metric_scene()
        scene['objects'].append({'name': 'duct', 'label': 'duct', 'ifcClass': 'IfcDuctSegment',
                                 'provenance': 'observed', 'centre': [0, 3, 0], 'size': [2, .4, .4]})
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'scene.ifc'; ie.write_ifc(path, scene)
            model = ifcopenshell.open(path)
            log = ifcopenshell.validate.json_logger()
            ifcopenshell.validate.validate(model, log, express_rules=True)
            self.assertEqual(log.statements, [])
            model.write(Path(d) / 'reopened.ifc'); model = ifcopenshell.open(Path(d) / 'reopened.ifc')
        props = lambda e: ifcopenshell.util.element.get_pset(e, 'Pset_BrainSNN')
        floor = model.by_type('IfcSlab')[0]
        self.assertEqual(floor.Name, 'Floor bounding extent')
        self.assertEqual(props(floor)['Provenance'], 'observed')
        self.assertEqual(props(floor)['GeometryScope'], 'derived-point-cloud-floor-bounding-extent')
        self.assertFalse(props(floor)['RoomBoundaryVerified'])
        duct = next(e for e in model.by_type('IfcElement') if e.Name == 'duct')
        self.assertEqual(duct.is_a(), 'IfcBuildingElementProxy')
        self.assertEqual(props(duct)['RequestedIfcClass'], 'IfcDuctSegment')
        self.assertEqual(len(model.by_type('IfcFurniture')), 1)

    def test_unknown_cells_merge_into_runs_and_labels_are_escaped(self):
        self.assertEqual(ie.merge_unknown([[0, 0, .5], [.5, 0, .5], [1.5, 0, .5], [0, .5, .5]]), [(0, 1.0, 0, .5), (1.5, 2.0, 0, .5), (0, .5, .5, .5)])
        self.assertEqual(ie.label("O'Brien\\é😀"), "'O''Brien\\\\\\X2\\00E9\\X0\\?'")
        self.assertEqual(len(ie.ifc_guid("x")), 22); self.assertEqual(ie.ifc_guid("x"), ie.ifc_guid("x")); self.assertNotEqual(ie.ifc_guid("x"), ie.ifc_guid("y"))
        self.assertEqual(ie.real(2), "2."); self.assertEqual(ie.real(-0.25), "-0.25")
