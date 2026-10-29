"""Real video decoding preserves small captures and caps larger ones without distorting them."""
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

from robotics.world_worker import sparse_colmap


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg and FFprobe required')
class VideoNativeResolutionTests(unittest.TestCase):
    def check_prepared_size(self, source_size, prepared_size):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            capture = root / 'capture.mp4'
            width, height = source_size
            subprocess.run([
                shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                '-i', f'testsrc2=size={width}x{height}:rate=6', '-t', '2',
                '-c:v', 'mpeg4', '-q:v', '2', '-threads', '1', str(capture),
            ], check=True, timeout=30)
            images = root / 'images'
            images.mkdir()

            evidence = sparse_colmap.extract_video(capture, images)

            self.assertEqual(len(evidence['frames']), 6)
            for frame in evidence['frames']:
                with Image.open(images / frame['image']) as raster:
                    self.assertEqual(raster.size, prepared_size)
                prepared = frame['preparation']
                self.assertEqual((prepared['width'], prepared['height']), prepared_size)
                # Check the intermediate too: a later thumbnail cannot undo the
                # cost and loss of information from first enlarging the raster.
                self.assertEqual((prepared['sourceWidth'], prepared['sourceHeight']), prepared_size)
                self.assertLessEqual(prepared['width'], width)
                self.assertLessEqual(prepared['height'], height)
                self.assertLessEqual(max(prepared_size), sparse_colmap.MAX_IMAGE_EDGE)
                self.assertEqual(prepared['width'] * height, prepared['height'] * width)

    def test_small_portrait_keeps_demo_upload_resolution(self):
        self.check_prepared_size((512, 910), (512, 910))

    def test_small_landscape_is_not_enlarged(self):
        self.check_prepared_size((640, 360), (640, 360))

    def test_hd_landscape_is_capped_without_stretching(self):
        self.check_prepared_size((1920, 1080), (1280, 720))

    def test_hd_portrait_is_capped_without_stretching(self):
        self.check_prepared_size((1080, 1920), (720, 1280))
