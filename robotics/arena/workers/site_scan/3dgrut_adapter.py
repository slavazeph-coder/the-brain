"""Optional operator-pinned NVIDIA 3DGRUT adapter, invoked after real COLMAP reconstruction.
Not enabled by default. Must use a separately installed 3DGRUT environment and a clean pinned checkout.
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: 3dgrut_adapter.py DATASET_DIR ARTIFACTS_DIR")
    dataset, artifacts = (Path(x).resolve() for x in sys.argv[1:])
    root = Path(os.environ.get("BRAIN_SITE_3DGRUT_ROOT", "")).resolve()
    python = os.environ.get("BRAIN_SITE_3DGRUT_PYTHON", "")
    revision = os.environ.get("BRAIN_SITE_3DGRUT_REVISION", "")
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or not root.is_dir() or not (root / "train.py").is_file() or not Path(python).is_absolute() or not Path(python).is_file():
        raise SystemExit("Configure a pinned 3DGRUT checkout and its absolute Python environment path.")
    actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True, timeout=10).strip()
    if actual != revision:
        raise SystemExit("3DGRUT HEAD differs from the configured revision.")
    if subprocess.run(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--"], timeout=10).returncode:
        raise SystemExit("The tracked 3DGRUT checkout contains modifications.")
    # The pinned upstream loader expects a single reconstruction under sparse/0.
    models = [p for p in (dataset / "sparse").iterdir() if p.is_dir() and (p / "images.bin").exists()]
    if not models:
        raise SystemExit("COLMAP reconstruction is missing.")
    model = max(models, key=lambda p: (p / "images.bin").stat().st_size)
    selected = dataset.parent / "visual-dataset"
    selected.mkdir()
    os.symlink(dataset / "images", selected / "images", target_is_directory=True)
    (selected / "sparse").mkdir()
    shutil.copytree(model, selected / "sparse" / "0")
    output = dataset.parent / "3dgrut-output"
    subprocess.run([python, str(root / "train.py"), "--config-name", "apps/colmap_3dgut.yaml",
                    "path=" + str(selected), "out_dir=" + str(output), "experiment_name=site_scan",
                    "dataset.downsample_factor=1", "export_ply.enabled=true", "export_usd.enabled=true"],
                   cwd=root, check=True, stdin=subprocess.DEVNULL)
    # PLY is an optional visual Gaussian export, not an inferred collision surface.
    candidates = [p for p in output.rglob("*.ply") if p.is_file() and not p.is_symlink()]
    if not candidates:
        raise SystemExit("3DGRUT finished without an exported PLY. Check this pinned release's export settings.")
    shutil.copyfile(max(candidates, key=lambda p: p.stat().st_mtime), artifacts / "visual.ply")
    usdz = [p for p in output.rglob("*.usdz") if p.is_file() and not p.is_symlink()]
    if usdz:
        shutil.copyfile(max(usdz, key=lambda p: p.stat().st_mtime), artifacts / "visual.usdz")


if __name__ == "__main__":
    main()
