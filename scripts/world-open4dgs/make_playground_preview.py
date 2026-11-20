"""Prepare a bounded local World Builder preview from an Open4DGS PLY export."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import tempfile


MIB = 1024 ** 2
MAX_METADATA = 16 * MIB
MAX_HEADER = 64 * 1024
MAX_FRAME_BYTES = 64 * MIB
MAX_SEQUENCE_BYTES = 512 * MIB
MAX_FRAMES = 1800
MAX_POINTS = 20_000
MAX_SOURCE_BYTES = 128 * 1024 * MIB
MAX_SOURCE_ROWS = 10_000_000
SCALAR_TYPES = {"char": "b", "int8": "b", "uchar": "B", "uint8": "B", "short": "h", "int16": "h",
                "ushort": "H", "uint16": "H", "int": "i", "int32": "i", "uint": "I", "uint32": "I",
                "float": "f", "float32": "f", "double": "d", "float64": "d"}
REQUIRED = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3"}
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def source_file(path):
    require(path.is_file() and not path.is_symlink(), f"Missing regular source file {path.name}.")
    return path


def metadata_for(folder):
    with source_file(folder / "export_meta.json").open("rb") as stream:
        raw = stream.read(MAX_METADATA + 1)
    require(0 < len(raw) <= MAX_METADATA, "Source export_meta.json is empty or too large.")
    source = json.loads(raw)
    require(isinstance(source, dict), "Open4DGS metadata must be an object.")
    fps, start, count, counts = (source.get(k) for k in ("fps", "start_frame", "n_frames", "per_frame_counts"))
    require(type(fps) in (int, float) and math.isfinite(fps) and 1 <= fps <= 240 and
            type(start) is int and 0 <= start <= 9_999_999 and type(count) is int and
            2 <= count <= 10_000_000 - start and isinstance(counts, list) and len(counts) == count and
            all(type(n) is int and 0 < n <= MAX_SOURCE_ROWS for n in counts),
            "Source metadata has invalid Open4DGS timing or primitive counts.")
    return fps, start, counts, hashlib.sha256(raw).hexdigest()


def read_header(stream, expected_count):
    header = []
    size = 0
    names, codes = [], []
    vertex_line = None
    while size < MAX_HEADER:
        line = stream.readline(MAX_HEADER - size + 1)
        size += len(line)
        require(line.endswith(b"\n") and size <= MAX_HEADER, "Incomplete or oversized PLY header.")
        text = line.decode("ascii").strip()
        fields = text.split()
        header.append(line)
        if len(header) == 1:
            require(text == "ply", "Input frame must be a PLY.")
        elif len(header) == 2:
            require(text == "format binary_little_endian 1.0", "Use the trainer's uncompressed binary little-endian PLY frames.")
        elif text == "end_header":
            break
        elif fields and fields[0] in ("comment", "obj_info"):
            continue
        elif vertex_line is None:
            require(len(fields) == 3 and fields[:2] == ["element", "vertex"] and fields[2].isdigit() and
                    int(fields[2]) == expected_count, "PLY vertex count disagrees with export_meta.json.")
            vertex_line = len(header) - 1
        else:
            require(len(fields) == 3 and fields[0] == "property" and fields[1] in SCALAR_TYPES and
                    NAME.fullmatch(fields[2]) and fields[2] not in names and len(names) < 128,
                    "Use one PLY vertex element with unique scalar properties.")
            codes.append(SCALAR_TYPES[fields[1]])
            names.append(fields[2])
    require(text == "end_header" and vertex_line is not None and REQUIRED <= set(names),
            "PLY must include Gaussian positions, colours, opacity, log scales and rotations.")
    require(all(codes[i] in "fd" for i, name in enumerate(names) if name in REQUIRED),
            "Gaussian parameters must be floating point.")
    return header, vertex_line, struct.Struct("<" + "".join(codes)), names


def make_frame(source_path, destination_path, count, max_points, byte_budget):
    with source_file(source_path).open("rb") as source:
        header, vertex_line, record, names = read_header(source, count)
        source_bytes = os.fstat(source.fileno()).st_size
        require(source_bytes == source.tell() + record.size * count, "PLY payload length does not match its vertex data.")
        retained = min(count, max_points, (byte_budget - sum(map(len, header))) // record.size)
        require(retained > 0, "Preview budget is too small for one complete Gaussian row.")
        newline = b"\r\n" if header[vertex_line].endswith(b"\r\n") else b"\n"
        source_digest = hashlib.sha256(b"".join(header))
        header[vertex_line] = f"element vertex {retained}".encode("ascii") + newline
        output_header = b"".join(header)
        output_digest = hashlib.sha256(output_header)
        rotations = [names.index(f"rot_{i}") for i in range(4)]
        positions = [names.index(axis) for axis in ("x", "y", "z")]
        offset = selected = 0
        chunk_rows = max(1, MIB // record.size)
        with destination_path.open("xb") as destination:
            destination.write(output_header)
            while offset < count:
                rows = min(chunk_rows, count - offset)
                chunk = source.read(rows * record.size)
                require(len(chunk) == rows * record.size, "Source frame changed during preview preparation.")
                source_digest.update(chunk)
                while selected < retained and (index := selected * count // retained) < offset + rows:
                    at = (index - offset) * record.size
                    values = record.unpack_from(chunk, at)
                    require(all(math.isfinite(n) for n in values) and all(abs(values[i]) <= 1e7 for i in positions) and
                            math.hypot(*(values[i] for i in rotations)) >= 1e-8,
                            "A retained Gaussian row has invalid data.")
                    payload = chunk[at:at + record.size]
                    destination.write(payload)
                    output_digest.update(payload)
                    selected += 1
                offset += rows
            require(not source.read(1) and selected == retained, "Source frame changed during preview preparation.")
        output_bytes = destination_path.stat().st_size
        require(output_bytes <= byte_budget, "Prepared frame exceeded its byte budget.")
    return {"file": source_path.name, "source_rows": count, "retained_rows": retained,
            "source_bytes": source_bytes, "source_sha256": source_digest.hexdigest(),
            "preview_bytes": output_bytes, "preview_sha256": output_digest.hexdigest()}


def publish(ready, destination):
    # Reserving the name exclusively prevents an existing empty directory from
    # being replaced by POSIX rename. The sibling staging files are complete.
    destination.mkdir()
    linked = []
    try:
        for entry in ready.iterdir():
            output = destination / entry.name
            os.link(entry, output)
            linked.append(output)
    except BaseException:
        for output in linked:
            output.unlink(missing_ok=True)
        try:
            destination.rmdir()
        except OSError:
            pass
        raise


def make_preview(input_dir, output_dir, start_frame=None, frames=None, max_points=MAX_POINTS):
    fps, source_start, counts, metadata_hash = metadata_for(input_dir)
    first = source_start if start_frame is None else start_frame
    require(type(first) is int and source_start <= first < source_start + len(counts), "Start frame is outside the source export.")
    remaining = source_start + len(counts) - first
    length = min(120, remaining) if frames is None else frames
    require(type(length) is int and 2 <= length <= min(MAX_FRAMES, remaining), "Choose 2–1,800 consecutive source frames.")
    require(type(max_points) is int and 1 <= max_points <= MAX_POINTS, "Viewer accepts up to 20,000 retained points per frame.")
    require(not output_dir.exists() and not output_dir.is_symlink(), "Output directory already exists.")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    sources = [source_file(input_dir / f"frame_{index:06d}.ply") for index in range(first, first + length)]
    require(sum(path.stat().st_size for path in sources) <= MAX_SOURCE_BYTES, "Select a shorter source range under 128 GiB.")
    frame_budget = min(MAX_FRAME_BYTES, (MAX_SEQUENCE_BYTES - 2 * MIB) // length)
    with tempfile.TemporaryDirectory(dir=output_dir.parent, prefix=".open4d-preview-") as temporary:
        ready = Path(temporary)
        receipts = [make_frame(source, ready / source.name, counts[first - source_start + i], max_points, frame_budget)
                    for i, source in enumerate(sources)]
        metadata = {"fps": fps, "start_frame": first, "n_frames": length,
                    "per_frame_counts": [row["retained_rows"] for row in receipts]}
        metadata_bytes = (json.dumps(metadata, indent=2) + "\n").encode("utf-8")
        (ready / "export_meta.json").write_bytes(metadata_bytes)
        report = {"schema": "brainsnn.open4dgs.playground-preview.v1", "source_metadata_sha256": metadata_hash,
                  "preview_metadata_sha256": hashlib.sha256(metadata_bytes).hexdigest(), "source_start_frame": source_start,
                  "source_frame_count": len(counts), "fps": fps, "start_frame": first, "frame_count": length,
                  "max_retained_rows_per_frame": max_points, "sampling": "source-index floor(i * source_rows / retained_rows)",
                  "row_attributes_preserved": True, "frames": receipts}
        (ready / "preview-provenance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        require(sum(path.stat().st_size for path in ready.iterdir()) <= MAX_SEQUENCE_BYTES, "Prepared sequence exceeded 512 MiB.")
        publish(ready, output_dir)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True, help="Official Open4DGS PLY export directory")
    parser.add_argument("--output-dir", type=Path, required=True, help="New preview directory")
    parser.add_argument("--start-frame", type=int, help="Absolute source frame number (defaults to export start)")
    parser.add_argument("--frames", type=int, help="Number of consecutive frames (defaults to up to 120)")
    parser.add_argument("--max-points", type=int, default=MAX_POINTS, help="Maximum retained per frame (up to 20,000)")
    args = parser.parse_args()
    try:
        result = make_preview(args.input_dir, args.output_dir, args.start_frame, args.frames, args.max_points)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Preview preparation stopped: {error}\n")
    print(f"Prepared {result['frame_count']} frames at {result['fps']} FPS starting at {result['start_frame']}.")


if __name__ == "__main__":
    main()
