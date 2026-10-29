"""The release version and extension package version are different upstream."""
import unittest
from unittest.mock import patch
from robotics.g1_trial.runtime import preflight

class VersionTests(unittest.TestCase):
    def test_release_and_extension_versions_are_not_confused(self):
        versions={'isaaclab':'0.47.2','rsl-rl-lib':'3.3.0','isaacsim':'5.1.0.0'}
        with patch('robotics.g1_trial.runtime.metadata.version',side_effect=versions.__getitem__), patch('robotics.g1_trial.runtime.platform.system',return_value='Linux'), patch('robotics.g1_trial.runtime.platform.machine',return_value='x86_64'), patch('robotics.g1_trial.runtime.subprocess.check_output',return_value='NVIDIA GeForce RTX 4090, 23000, 0\n'):
            self.assertEqual(preflight()['status'],'admitted')
            versions['isaaclab']='2.3.0'
            self.assertEqual(preflight()['status'],'blocked')

if __name__=='__main__':unittest.main()
