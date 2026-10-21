"""The subset of the ``colmap`` command line the scan worker uses, implemented with pycolmap.

pycolmap wheels bundle a CPU build of COLMAP, so a worker can reconstruct without compiling COLMAP:

  BRAIN_SITE_COLMAP=/abs/path/.venv-site-scan/bin/brainsnn-colmap   (or: python -m workers.site_scan.colmap_cli)

Only these commands and flags are accepted, with the CLI's own spelling, so the worker's subprocess
calls (and their process-group cancellation) are identical for both backends:

  feature_extractor --database_path D --image_path I [--ImageReader.camera_model M] [--ImageReader.single_camera 0|1]
  sequential_matcher --database_path D
  exhaustive_matcher --database_path D
  mapper --database_path D --image_path I --output_path O
  model_converter --input_path M --output_path P --output_type TXT|PLY
  version
"""
import sys

COMMANDS = {
    "feature_extractor": {"--database_path", "--image_path", "--ImageReader.camera_model", "--ImageReader.single_camera"},
    "sequential_matcher": {"--database_path"},
    "exhaustive_matcher": {"--database_path"},
    "mapper": {"--database_path", "--image_path", "--output_path"},
    "model_converter": {"--input_path", "--output_path", "--output_type"},
}
REQUIRED = {
    "feature_extractor": {"--database_path", "--image_path"},
    "sequential_matcher": {"--database_path"},
    "exhaustive_matcher": {"--database_path"},
    "mapper": {"--database_path", "--image_path", "--output_path"},
    "model_converter": {"--input_path", "--output_path", "--output_type"},
}


def parse(argv):
    if not argv or argv[0] not in COMMANDS:
        raise SystemExit(f"usage: {{{','.join(sorted(COMMANDS))}|version}} --option value ...")
    command, rest = argv[0], argv[1:]
    if len(rest) % 2:
        raise SystemExit("options take exactly one value each")
    options = dict(zip(rest[::2], rest[1::2]))
    unknown = set(options) - COMMANDS[command]
    missing = REQUIRED[command] - set(options)
    if unknown or missing:
        raise SystemExit(f"{command}: unsupported {sorted(unknown)} missing {sorted(missing)}")
    return command, options


def run(command, options):
    import pycolmap
    if command == "feature_extractor":
        reader = pycolmap.ImageReaderOptions()
        reader.camera_model = options.get("--ImageReader.camera_model", "SIMPLE_RADIAL")
        single = options.get("--ImageReader.single_camera", "0")
        if single not in ("0", "1"):
            raise SystemExit("--ImageReader.single_camera takes 0 or 1")
        mode = pycolmap.CameraMode.SINGLE if single == "1" else pycolmap.CameraMode.AUTO
        pycolmap.extract_features(options["--database_path"], options["--image_path"], camera_mode=mode,
                                  reader_options=reader, device=pycolmap.Device.cpu)
    elif command == "sequential_matcher":
        pycolmap.match_sequential(options["--database_path"], device=pycolmap.Device.cpu)
    elif command == "exhaustive_matcher":
        pycolmap.match_exhaustive(options["--database_path"], device=pycolmap.Device.cpu)
    elif command == "mapper":
        pycolmap.incremental_mapping(options["--database_path"], options["--image_path"], options["--output_path"])
    elif command == "model_converter":
        model = pycolmap.Reconstruction(options["--input_path"])
        kind = options["--output_type"]
        if kind == "TXT":
            model.write_text(options["--output_path"])
        elif kind == "PLY":
            model.export_PLY(options["--output_path"])
        else:
            raise SystemExit("--output_type takes TXT or PLY")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["version"]:
        import pycolmap
        print(f"pycolmap {pycolmap.__version__}; {pycolmap.COLMAP_build}")
        return 0
    command, options = parse(argv)
    run(command, options)
    return 0


if __name__ == "__main__":
    sys.exit(main())
