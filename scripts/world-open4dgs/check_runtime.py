"""Check an operator-installed CUDA environment and the paired camera inputs."""

from importlib.metadata import distribution, version
import json
from pathlib import Path, PurePosixPath
import sys

import numpy as np
from PIL import Image
import pycolmap
import torch


def check(condition, message):
    if not condition:
        raise ValueError(message)


def check_install(package, expected_commit):
    direct_url = distribution(package).read_text("direct_url.json")
    revision = json.loads(direct_url or "{}").get("vcs_info", {}).get("commit_id")
    check(revision == expected_commit, f"Install {package} at commit {expected_commit} as documented.")
    return revision


def check_cameras(reference_path, model_path, first, last):
    reference = json.loads(reference_path.read_text(encoding="utf-8"))["cameras"]
    reconstruction = pycolmap.Reconstruction(str(model_path))
    by_folder = {}
    for image in reconstruction.images.values():
        name = PurePosixPath(image.name)
        check(len(name.parts) == 2 and not name.is_absolute() and name.parent.name not in by_folder,
              "COLMAP model must contain one registered reference image per numbered camera folder.")
        by_folder[name.parent.name] = image

    check(set(by_folder) == {row["folder"] for row in reference},
          "COLMAP and reference_export.json do not identify the same cameras.")
    for row in reference:
        folder = row["folder"]
        image = by_folder[folder]
        camera = reconstruction.cameras[image.camera_id]
        pose = image.cam_from_world()
        expected_size = (row["width"], row["height"])
        pairs = ((pose.rotation.matrix(), row["R"]), (pose.translation, row["t"]), (camera.params, row["params"]))
        check(image.name == row["name"] and camera.model.name == row["camera_model_name"] and
              (camera.width, camera.height) == expected_size and all(
                  np.shape(actual) == np.shape(expected) and np.allclose(actual, expected, rtol=1e-6, atol=1e-8)
                  for actual, expected in pairs), f"Camera {folder} calibration differs between COLMAP and reference_export.json.")
        for frame in range(first, last + 1):
            files = (("images", "jpg", "JPEG"), ("masks", "png", "PNG"))
            for directory, extension, file_type in files:
                path = reference_path.parent / directory / folder / f"{frame:06d}.{extension}"
                with Image.open(path) as source:
                    check(source.size == expected_size and source.format == file_type,
                          f"{directory}/{folder}/{path.name} does not match the calibrated dimensions and format.")


def main():
    ref, model, first, last, roma_commit, memfof_commit = sys.argv[1:]
    check(sys.version_info[:2] == (3, 11) and torch.version.cuda == "12.8" and
          torch.__version__ == "2.10.0+cu128" and torch.cuda.is_available(),
          "Install the pinned Python 3.11 / PyTorch 2.10.0 CUDA 12.8 environment on an available NVIDIA device.")
    check(version("gsplat") == "1.5.3" and version("gsply") == "0.2.16",
          "Install the trainer's locked gsplat and gsply dependencies.")
    check_cameras(Path(ref), Path(model), int(first), int(last))
    runtime = {
        "python": ".".join(str(part) for part in sys.version_info[:3]), "torch": torch.__version__,
        "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(),
        "capability": list(torch.cuda.get_device_capability()),
        "gsplat": version("gsplat"), "gsply": version("gsply"), "numpy": np.__version__,
        "pycolmap": pycolmap.__version__,
        "roma_commit": check_install("romav2", roma_commit), "memfof_commit": check_install("memfof", memfof_commit),
    }
    print(json.dumps(runtime))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Runtime/input check: {error}") from error
