"""Pin and verify the actual local OpenPI checkpoint contents, not a mutable URL."""
import argparse
import hashlib
import json
from pathlib import Path


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def contents(checkpoint):
    checkpoint = Path(checkpoint).resolve(strict=True)
    if not checkpoint.is_dir():
        raise ValueError("Checkpoint must be a directory.")
    files = {}
    for path in sorted(checkpoint.rglob("*")):
        if path.is_symlink():
            raise ValueError("Copy checkpoint symlink targets into the pinned directory before creating the manifest.")
        if path.is_file():
            files[path.relative_to(checkpoint).as_posix()] = file_sha256(path)
    if not files:
        raise ValueError("Checkpoint directory is empty.")
    return {"format": 1, "config": "pi05_libero", "files": files}


def canonical(manifest):
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")


def revision(manifest):
    return "sha256:" + hashlib.sha256(canonical(manifest)).hexdigest()


def verify(checkpoint, manifest_path):
    manifest = json.loads(Path(manifest_path).read_text())
    if manifest != contents(checkpoint):
        raise ValueError("Checkpoint content differs from its manifest. Do not serve or relabel it as the pinned revision.")
    return revision(manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True, help="A JSON file outside the checkpoint directory")
    args = parser.parse_args()
    target = Path(args.output).resolve()
    if target.is_relative_to(Path(args.checkpoint).resolve()):
        raise SystemExit("The manifest must be saved outside the checkpoint directory.")
    manifest = contents(args.checkpoint)
    target.write_bytes(canonical(manifest) + b"\n")
    print(revision(manifest))
