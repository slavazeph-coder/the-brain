import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import test_orchestration_worker as existing
import runtime

class GPUDecodeModeTests(unittest.TestCase):
    def test_opt_in_retains_only_operator_gpu_visibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=existing.OrchestrationTests().config(Path(tmp))
            c['COMFY_GPU_DECODE']='1'
            with patch.dict(os.environ,{'CUDA_VISIBLE_DEVICES':'GPU-owned'}):
                r=runtime.Runtime(c)
                self.assertEqual(r.child_env('comfy_cpu')['CUDA_VISIBLE_DEVICES'],'GPU-owned')

    def test_missing_or_invalid_opt_in_keeps_cpu_hidden_gpu(self):
        for value in ('0','yes','',None):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as tmp:
                c=existing.OrchestrationTests().config(Path(tmp))
                if value is not None:c['COMFY_GPU_DECODE']=value
                with patch.dict(os.environ,{'CUDA_VISIBLE_DEVICES':'GPU-owned'}):
                    self.assertEqual(runtime.Runtime(c).child_env('comfy_cpu')['CUDA_VISIBLE_DEVICES'],'')

if __name__=='__main__':unittest.main()
