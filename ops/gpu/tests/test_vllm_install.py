import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
import runtime
import vllm_launch


class VllmInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        subprocess.run([sys.executable, str(SOURCE / 'install.py'), '--destination', str(self.root)],
                       check=True, capture_output=True)
        self.model = self.root / 'snapshot'
        self.model.mkdir()
        (self.model / 'config.json').write_text('{"model_type":"qwen3"}')
        (self.model / 'model.safetensors').write_bytes(b'fixture-weights')
        self.template = self.model / 'chat_template.jinja'
        self.template.write_bytes(b'{{ messages }}\r\n')
        self.manifest = self.root / 'model-manifest.json'
        self.manifest.write_text(json.dumps({'revision': 'c' * 40, 'files': [
            {'path': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in self.model.iterdir()]}))
        self.server = self.root / 'vllm'
        self.server.write_text('#!' + sys.executable + '\nimport json,os,sys\n'
                               'print(json.dumps({"argv":sys.argv[1:],"envNames":sorted(os.environ),'
                               '"authenticated":len(os.environ.get("VLLM_API_KEY",""))>=32,'
                               '"v1":os.environ.get("VLLM_USE_V1"),"backend":os.environ.get("VLLM_ATTENTION_BACKEND"),'
                               '"library":os.environ.get("LD_LIBRARY_PATH")}))\n')
        self.server.chmod(0o700)
        config_path = self.root / 'runtime.env'
        self.config = runtime.read_config(config_path)
        self.config.update(VLLM_EXECUTABLE=str(self.server), MODEL_PATH=str(self.model),
                           MODEL_REVISION='c' * 40, MODEL_MANIFEST=str(self.manifest),
                           CHAT_TEMPLATE_PATH=str(self.template),
                           CHAT_TEMPLATE_SHA256=hashlib.sha256(self.template.read_bytes()).hexdigest(),
                           MAX_MODEL_LEN='4096', GPU_MEMORY_UTILIZATION='0.50', VLLM_DTYPE='bfloat16',
                           VLLM_MAX_NUM_SEQS='1', VLLM_MAX_BATCHED_TOKENS='4096', VLLM_LD_LIBRARY_PATH='')
        self.instance = runtime.Runtime(self.config)

    def tearDown(self):
        for handler in self.instance.log.handlers[:]:
            self.instance.log.removeHandler(handler)
            handler.close()
        self.temp.cleanup()

    def test_installed_launcher_executes_filtered_configuration_without_secret_argv(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH': '/unrelated/cuda-12.2/lib64', 'VLLM_USE_V1': '1'}):
            env = self.instance.child_env('inference')
            completed = subprocess.run([sys.executable, str(self.root / 'vllm_launch.py')], env=env,
                                       check=True, capture_output=True, text=True, timeout=5)
            self.assertEqual(os.environ['LD_LIBRARY_PATH'], '/unrelated/cuda-12.2/lib64')
            for kind in ('background', 'bridge', 'backup'):
                self.assertNotIn('VLLM_LD_LIBRARY_PATH', self.instance.child_env(kind))
        result = json.loads(completed.stdout)
        argv = result['argv']
        self.assertEqual(argv[:2], ['serve', str(self.model)])
        for flag, expected in [('--host', '127.0.0.1'), ('--max-model-len', '4096'), ('--dtype', 'bfloat16'),
                               ('--max-num-seqs', '1'), ('--max-num-batched-tokens', '4096'),
                               ('--gpu-memory-utilization', '0.5'), ('--chat-template', str(self.template)),
                               ('--generation-config', 'vllm')]:
            self.assertEqual(argv[argv.index(flag) + 1], expected)
        self.assertTrue({'--enforce-eager', '--disable-custom-all-reduce', '--disable-log-requests'}.issubset(argv))
        self.assertTrue(result['authenticated'])
        self.assertEqual((result['v1'], result['backend'], result['library']), ('0', 'FLASH_ATTN', None))
        for key in ('BACKEND_API_KEY', 'GPU_API_KEY', 'BACKGROUND_API_KEY', 'GPU_BRIDGE_WORKER_KEY'):
            self.assertNotIn(key, result['envNames'])
            if self.config.get(key): self.assertNotIn(self.config[key], completed.stdout)
        self.assertNotIn('--api-key', argv)
        self.assertNotIn('--trust-remote-code', argv)

    def test_snapshot_and_template_tampering_prevents_execution(self):
        env = self.instance.child_env('inference')
        self.template.write_bytes(b'changed-template')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            vllm_launch.command(env)
        env.pop('MODEL_MANIFEST')
        with self.assertRaisesRegex(ValueError, 'Chat template failed'):
            vllm_launch.command(env)

    def test_manifest_rejects_unverified_files_invalid_digests_and_paths(self):
        original = self.manifest.read_text()
        (self.model / 'tokenizer.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'omits'):
            vllm_launch.command(self.config)
        (self.model / 'tokenizer.json').unlink()
        for record in ({'path': '../outside', 'sha256': 'a' * 64},
                       {'path': 'config.json', 'sha256': None}):
            self.manifest.write_text(json.dumps({'revision': 'c' * 40, 'files': [record]}))
            with self.assertRaises(ValueError):
                vllm_launch.command(self.config)
        self.manifest.write_text(original.replace('c' * 40, 'd' * 40))
        with self.assertRaisesRegex(ValueError, 'match MODEL_REVISION'):
            vllm_launch.command(self.config)

    def test_unsafe_or_unpinned_config_rejected(self):
        for changes in ({'MODEL_REVISION': 'main'}, {'VLLM_EXECUTABLE': 'vllm'},
                        {'VLLM_DTYPE': 'auto'}, {'VLLM_MAX_NUM_SEQS': '3'},
                        {'VLLM_MAX_BATCHED_TOKENS': '1024'}, {'GPU_MEMORY_UTILIZATION': 'nan'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                vllm_launch.command(dict(self.config, **changes))

    def test_driver_library_override_is_scoped_and_stubs_rejected(self):
        drivers = self.root / 'driver-libs'
        drivers.mkdir()
        env = dict(self.config, LD_LIBRARY_PATH='/cuda12.2', VLLM_LD_LIBRARY_PATH=str(drivers))
        self.assertEqual(vllm_launch.execution_environment(env)['LD_LIBRARY_PATH'], str(drivers))
        self.assertEqual(env['LD_LIBRARY_PATH'], '/cuda12.2')
        self.assertEqual(vllm_launch.execution_environment({'BACKEND_API_KEY': 'a' * 40,
                         'LD_LIBRARY_PATH': '/existing'})['LD_LIBRARY_PATH'], '/existing')
        stubs = self.root / 'stubs'
        stubs.mkdir()
        for value in (str(stubs), str(drivers) + ':', '.', '/does-not-exist'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                vllm_launch.execution_environment(dict(env, VLLM_LD_LIBRARY_PATH=value))


if __name__ == '__main__':
    unittest.main()
