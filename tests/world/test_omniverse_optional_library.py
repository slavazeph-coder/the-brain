"""Source-only fallback remains independent of optional asset cache health."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tests.world.test_omniverse_pack import fixture
from robotics.world_worker import omniverse_pack as pack
from robotics.world_worker.omniverse_templates.verify_pack import verify


class OptionalLibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source, self.library, self.request, _ = fixture(self.root)

    def build(self):
        return pack.package_scene(self.source, self.root / 'pack', self.request, self.library)

    def test_source_only_does_not_inspect_optional_library(self):
        self.request['placements'] = []
        with patch.object(pack, 'installed_assets', side_effect=AssertionError('Must not inspect optional cache')) as inspect:
            proof = self.build()
        inspect.assert_not_called()
        self.assertEqual(proof['library_placements'], [])
        self.assertFalse(proof['physics_ready'])
        verify(self.root / 'pack')

    def test_source_only_survives_corrupt_installed_asset(self):
        self.request['placements'] = []
        (self.library / 'IV_pole_a01/.metadata/LICENSE.txt').write_text('damaged optional fixture')
        proof = self.build()
        self.assertEqual(proof['library_placements'], [])
        self.assertFalse((self.root / 'pack/assets').exists())
        verify(self.root / 'pack')

    def test_requested_asset_still_rejects_corruption(self):
        (self.library / 'IV_pole_a01/.metadata/LICENSE.txt').write_text('damaged requested fixture')
        with self.assertRaisesRegex(ValueError, 'asset bytes changed'):
            self.build()
        self.assertFalse((self.root / 'pack').exists())

    def test_falsey_malformed_placements_are_not_an_export_bypass(self):
        for malformed in ({}, None, '', False, 0):
            with self.subTest(placements=malformed):
                self.request['placements'] = malformed
                with self.assertRaises(ValueError):
                    self.build()
                self.assertFalse((self.root / 'pack').exists())

    def test_source_only_still_requires_review_and_source_hashes(self):
        self.request['placements'] = []
        self.request['reviewed'] = False
        with self.assertRaises(ValueError):
            self.build()
        self.request['reviewed'] = True
        self.request['scene_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'changed since package review'):
            self.build()
        self.assertFalse((self.root / 'pack').exists())


if __name__ == '__main__':
    unittest.main()
