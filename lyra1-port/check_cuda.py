import torch
print(f"torch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")
print(f"device: {torch.cuda.get_device_name(0)}")
print(f"memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GiB")
