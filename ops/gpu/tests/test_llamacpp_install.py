import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
import runtime


class LlamaCppInstallTests(unittest.TestCase):
    def test_installed_launcher_receives_config_and_keeps_key_out_of_argv(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--destination', str(root)],
                           check=True, capture_output=True, text=True)
            launcher = root / 'llamacpp_launch.py'
            self.assertTrue(launcher.is_file())
            model = root / 'fixture.gguf'
            model.write_bytes(b'GGUF-test-fixture')
            fake_server = root / 'llama-server'
            fake_server.write_text('#!' + sys.executable + '\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
            fake_server.chmod(0o700)
            config_path = root / 'runtime.env'
            content = config_path.read_text()
            values = {
                'LLAMACPP_EXECUTABLE': str(fake_server), 'MODEL_PATH': str(model),
                'MODEL_SHA256': hashlib.sha256(model.read_bytes()).hexdigest(),
                'MODEL_REVISION': 'fixture-content-digest', 'GPU_LAYERS': '37',
                'BACKEND_PARALLEL': '3', 'MAX_MODEL_LEN': '4096',
            }
            config_path.write_text('\n'.join(
                line.partition('=')[0] + '=' + values[line.partition('=')[0]]
                if line.partition('=')[0] in values else line
                for line in content.splitlines()) + '\n')
            saved_config = config_path.read_bytes()
            subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--destination', str(root)],
                           check=True, capture_output=True)
            self.assertEqual(saved_config, config_path.read_bytes())
            config = runtime.read_config(config_path)
            instance = runtime.Runtime(config)
            try:
                child = instance.child_env('inference')
                self.assertNotIn('GPU_API_KEY', child)
                self.assertNotIn('BACKGROUND_API_KEY', child)
                completed = subprocess.run([sys.executable, str(launcher)], env=child,
                                           check=True, capture_output=True, text=True, timeout=5)
                argv = json.loads(completed.stdout)
                for flag, expected in [('--host', '127.0.0.1'), ('--model', str(model)),
                                       ('--n-gpu-layers', '37'), ('--parallel', '3'), ('--ctx-size', '4096')]:
                    self.assertEqual(argv[argv.index(flag) + 1], expected)
                self.assertNotIn('--json-schema', argv)
                self.assertNotIn(config['BACKEND_API_KEY'], completed.stdout)
                key_file = Path(argv[argv.index('--api-key-file') + 1])
                self.assertEqual(key_file.stat().st_mode & 0o777, 0o600)
                self.assertEqual(key_file.read_text().strip(), config['BACKEND_API_KEY'])
                model.write_bytes(b'changed GGUF-test-fixture')
                rejected = subprocess.run([sys.executable, str(launcher)], env=child,
                                          capture_output=True, text=True, timeout=5)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn('does not match MODEL_SHA256', rejected.stderr)
            finally:
                for handler in instance.log.handlers[:]:
                    instance.log.removeHandler(handler)
                    handler.close()


if __name__ == '__main__':
    unittest.main()
