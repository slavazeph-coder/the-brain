"""The pycolmap shim accepts exactly the COLMAP commands and flags the worker issues. No reconstruction runs here."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.site_scan.colmap_cli import parse


class ColmapCliTests(unittest.TestCase):
    def test_worker_commands_parse(self):
        self.assertEqual(parse(["feature_extractor", "--database_path", "d.db", "--image_path", "images",
                                "--ImageReader.camera_model", "SIMPLE_RADIAL", "--ImageReader.single_camera", "1"]),
                         ("feature_extractor", {"--database_path": "d.db", "--image_path": "images",
                                                "--ImageReader.camera_model": "SIMPLE_RADIAL", "--ImageReader.single_camera": "1"}))
        for command in ("sequential_matcher", "exhaustive_matcher"):
            self.assertEqual(parse([command, "--database_path", "d.db"]), (command, {"--database_path": "d.db"}))
        self.assertEqual(parse(["mapper", "--database_path", "d", "--image_path", "i", "--output_path", "o"])[0], "mapper")
        self.assertEqual(parse(["model_converter", "--input_path", "m", "--output_path", "p", "--output_type", "PLY"])[0], "model_converter")

    def test_anything_else_is_refused(self):
        for argv in ([], ["gui"], ["automatic_reconstructor", "--workspace_path", "."],
                     ["mapper", "--database_path", "d"],
                     ["feature_extractor", "--database_path", "d", "--image_path", "i", "--SiftExtraction.use_gpu", "1"],
                     ["sequential_matcher", "--database_path"]):
            with self.assertRaises(SystemExit, msg=argv):
                parse(argv)


if __name__ == "__main__":
    unittest.main()
