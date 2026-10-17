"""Bounded LeRobot v3 and MCAP adapters for Arena's native evidence bundle.

Source format: huggingface/lerobot 146d8474932c8b566717eb2738ba459337ab71c4.
This module does not import LeRobot, torch or a model, fetch URLs, or execute data.
Original files are retained by the caller; bounded bundles include them when they
fit, otherwise explicitly retain their digest and omitted status. Dataset actions
are labels, never an attestation of controller or physical execution.
"""
from __future__ import annotations

import argparse
import base64
from decimal import Decimal
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys

MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
MAX_ORIGINAL_BYTES = 4 * 1024 * 1024
MAX_ROWS = 512
MAX_MESSAGES = 4000
MAX_MCAP_BYTES = 48 * 1024 * 1024
BUNDLE_SCHEMA = "brainsnn.arena.bundle.v1"
MANIFEST_SCHEMA = "brainsnn.arena.recording.v1"
NATIVE_ATTACHMENT = "brainsnn/manifest.json"


class ImportError(ValueError):
    """Invalid/unsupported source data; no network fallback is attempted."""


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def parse_json(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ImportError("Duplicate JSON key")
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ImportError("Nonfinite JSON value")))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def contained(root, relative):
    if not isinstance(relative, str) or "\\" in relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ImportError("Source paths must stay inside the dataset")
    candidate = root / relative
    if any(p.is_symlink() for p in [candidate, *candidate.parents] if p != root.parent):
        raise ImportError("Symlinked dataset paths are unsupported")
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
        raise ImportError("Missing or escaping dataset source: " + relative)
    if resolved.stat().st_size > MAX_SOURCE_BYTES:
        raise ImportError("Source file exceeds the 512 MiB import limit")
    return resolved


def file_digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class BundleBuilder:
    def __init__(self, recording_id, source, context, clocks):
        self.manifest = {"schema": MANIFEST_SCHEMA, "recordingId": recording_id,
                         "source": {"kind": "imported", "identityStatus": "declared", **source},
                         "context": context, "clocks": clocks, "events": [], "artifacts": [],
                         "findings": [], "outcome": {"status": "unknown", "policyExecuted": False}}
        self.payloads = {}
        self.used = 0
        self.paths = {}
        self.missing = 0

    def artifact(self, path, raw=None, *, source=None, media="application/octet-stream", **metadata):
        if path in self.paths:
            return self.paths[path]
        artifact_id = "artifact-" + str(len(self.paths) + 1)
        if raw is None and source is None:
            raise ImportError("Artifact needs exact bytes or an original file")
        length = len(raw) if raw is not None else source.stat().st_size
        sha = digest(raw) if raw is not None else file_digest(source)
        include = length <= MAX_PAYLOAD_BYTES - self.used and (raw is not None or length <= MAX_ORIGINAL_BYTES)
        item = {"id": artifact_id, "path": path, "sha256": sha, "byteLength": length,
                "mediaType": media, "retention": "included" if include else "omitted", **metadata}
        if include:
            content = raw if raw is not None else source.read_bytes()
            if len(content) != length or digest(content) != sha:
                raise ImportError("Source changed during import")
            self.payloads[path] = content
            self.used += length
        else:
            item["reason"] = "Original retained outside bundle; bounded local export limit"
        self.manifest["artifacts"].append(item)
        self.paths[path] = artifact_id
        return artifact_id

    def event(self, kind, data, *, sim_time=None, refs=None, artifacts=None, **other):
        seq = len(self.manifest["events"]) + 1
        event = {"id": f"event-{seq}", "seq": seq, "kind": kind, "data": data,
                 "refs": refs or [], "artifactIds": artifacts or [], **other}
        if sim_time is not None:
            if not isinstance(sim_time, (float, int)) or not math.isfinite(sim_time) or sim_time < 0:
                raise ImportError("Invalid episode timestamp")
            event["simTime"] = float(sim_time)
        self.manifest["events"].append(event)
        return event

    def finish(self):
        omitted = any(a["retention"] == "omitted" for a in self.manifest["artifacts"])
        seq = len(self.manifest["events"])
        self.manifest["completion"] = {"status": "partial" if omitted or self.missing else "complete",
            "committedSequence": seq, "lastObservedSequence": seq, "gapCount": self.missing, "unknownTail": False,
            "reason": "Imported data, not runtime-verified execution; source omissions are explicit"}
        from workers.arena.recording import seal_bundle, verify_bundle
        bundle = seal_bundle(self.manifest, self.payloads)
        verify_bundle(bundle)
        return bundle


def parquet_rows(path, *, limit=1_000_000, columns=None):
    import pyarrow.parquet as pq
    parquet = pq.ParquetFile(path)
    # Metadata permits rejection before decompression of an enormous table.
    if parquet.metadata.num_rows > limit:
        raise ImportError("Parquet row count exceeds bounded import limit")
    for row_group_index in range(parquet.metadata.num_row_groups):
        group = parquet.metadata.row_group(row_group_index)
        total = 0
        for column_index in range(group.num_columns):
            column = group.column(column_index)
            if columns is None or any(column.path_in_schema == name or column.path_in_schema.startswith(name + ".") for name in columns):
                total += column.total_uncompressed_size
        if total > 16 * 1024 * 1024:
            raise ImportError("Parquet selected row-group declared size exceeds 16 MiB before decompression")
    for batch in parquet.iter_batches(batch_size=256, columns=columns):
        if batch.nbytes > 16 * 1024 * 1024:
            raise ImportError("Parquet batch exceeds 16 MiB")
        yield from batch.to_pylist()


def episode_metadata(root, episode_index):
    files = sorted((root / "meta/episodes").glob("chunk-*/file-*.parquet"))
    if not files or len(files) > 256:
        raise ImportError("Expected bounded LeRobot v3 meta/episodes Parquet shards")
    found = []
    for candidate in files:
        path = contained(root, candidate.relative_to(root).as_posix())
        for row in parquet_rows(path, limit=100_000):
            if row.get("episode_index") == episode_index:
                found.append((row, path))
    if len(found) != 1:
        raise ImportError("Episode must have exactly one metadata row")
    return found[0]


def integer(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ImportError("Invalid nonnegative integer: " + field)
    return value


def video_frames(path, targets, start, end, fps):
    """Nearest actual decoded PTS within one declared frame interval and episode bounds."""
    import av
    tolerance = 1 / fps + 1e-6
    with av.open(str(path)) as container:
        if len(container.streams.video) != 1:
            raise ImportError("A camera shard must have one video stream")
        stream = container.streams.video[0]
        if not stream.time_base or stream.width * stream.height > 4096 * 2160:
            raise ImportError("Unsupported video time base or dimensions")
        container.seek(max(0, int(start / float(stream.time_base))), stream=stream, backward=True)
        decoded = container.decode(stream)
        previous = None
        current = None
        count = 0
        last_time = -math.inf
        for target in targets:
            while current is None or current[0] < target:
                if current is not None:
                    previous = current
                try:
                    frame = next(decoded)
                except StopIteration:
                    current = None
                    break
                count += 1
                if count > 20000:
                    raise ImportError("Video decode exceeds bounded frame limit")
                if frame.pts is None:
                    raise ImportError("Missing source frame PTS")
                t = float(frame.pts * frame.time_base)
                if t <= last_time:
                    raise ImportError("Nonmonotonic source video PTS")
                last_time = t
                current = (t, frame)
                if t > end + tolerance:
                    break
            candidates = [x for x in (previous, current) if x is not None and start - 1e-9 <= x[0] < end - 1e-9]
            selected = min(candidates, key=lambda x: abs(x[0] - target), default=None)
            if selected is None or abs(selected[0] - target) > tolerance:
                yield None
                continue
            t, frame = selected
            image = frame.to_image()
            output = io.BytesIO()
            image.save(output, format="PNG")
            yield {"bytes": output.getvalue(), "pts": str(frame.pts),
                   "timeBase": [frame.time_base.numerator, frame.time_base.denominator],
                   "sourceTime": t, "errorSeconds": abs(t - target), "shape": [image.height, image.width, 3]}


def import_lerobot(root, episode_index, *, max_rows=MAX_ROWS):
    root = Path(root).resolve()
    info_path = contained(root, "meta/info.json")
    if info_path.stat().st_size > 1024 * 1024:
        raise ImportError("LeRobot metadata exceeds 1 MiB")
    info = parse_json(info_path.read_bytes())
    if info.get("codebase_version") != "v3.0":
        raise ImportError("This adapter supports LeRobot v3.0 only")
    metadata, meta_path = episode_metadata(root, integer(episode_index, "episode_index"))
    data_relative = info.get("data_path", "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet").format(
        chunk_index=integer(metadata.get("data/chunk_index"), "data/chunk_index"),
        file_index=integer(metadata.get("data/file_index"), "data/file_index"))
    data_path = contained(root, data_relative)
    rows = []
    import pyarrow.parquet as pq
    available_columns = pq.ParquetFile(data_path).schema_arrow.names
    columns = [name for name in ("episode_index", "index", "frame_index", "timestamp", "observation.state", "action", "task_index") if name in available_columns]
    for row in parquet_rows(data_path, columns=columns):
        if row.get("episode_index") == episode_index:
            rows.append(row)
            if len(rows) > min(MAX_ROWS, max_rows):
                raise ImportError("Episode exceeds the bounded 512-frame import; split upstream")
    length = integer(metadata.get("length"), "length")
    if not rows or len(rows) != length:
        raise ImportError("Episode rows do not match metadata length")
    start_index = integer(metadata.get("dataset_from_index"), "dataset_from_index")
    end_index = integer(metadata.get("dataset_to_index"), "dataset_to_index")
    if end_index - start_index != length:
        raise ImportError("Episode offsets disagree with length")
    if [row.get("index") for row in rows] != list(range(start_index, end_index)):
        raise ImportError("Source row indexes disagree with episode offsets")
    if [row.get("frame_index") for row in rows] != list(range(length)):
        raise ImportError("Episode frame indexes must be contiguous")
    timestamps = [row.get("timestamp") for row in rows]
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0 for x in timestamps):
        raise ImportError("Missing or invalid recorded timestamps")
    if any(b <= a for a, b in zip(timestamps, timestamps[1:])):
        raise ImportError("Episode timestamps must be strictly increasing")
    fps = info.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or not 0 < fps <= 1000:
        raise ImportError("Invalid declared FPS")
    features = info.get("features", {})
    cameras = [key for key, feature in features.items() if isinstance(feature, dict) and feature.get("dtype") == "video"]
    if len(cameras) > 8:
        raise ImportError("At most eight camera streams may be imported")
    label = "lerobot-" + digest(json_bytes({"info": digest(info_path.read_bytes()), "metadata": metadata, "data": file_digest(data_path)}))[:24]
    builder = BundleBuilder(label, {"format": "LeRobot v3.0", "adapterRevision": "brainsnn-lerobot-v1",
        "limitations": ["Dataset actions are labels, not verified controller execution.",
                        "Decoded cameras are dataset observations, not attested policy inputs."]},
        {"taskId": "lerobot:" + str(metadata.get("tasks", rows[0].get("task_index", "unknown"))),
         "taskRevision": None, "judgeRevision": None, "environment": info.get("robot_type"),
         "actionSemantics": {"kind": "dataset-label", "feature": features.get("action")},
         "stateSemantics": features.get("observation.state"), "units": None, "preprocessingRevision": None,
         "initialState": rows[0].get("observation.state"), "episodeIndex": episode_index},
        [{"id": "episode", "unit": "seconds", "basis": "recorded dataset timestamp"}])
    builder.artifact("sources/meta/info.json", source=info_path, media="application/json")
    meta_id = builder.artifact("sources/" + meta_path.relative_to(root).as_posix(), source=meta_path, media="application/vnd.apache.parquet")
    data_id = builder.artifact("sources/" + data_relative, source=data_path, media="application/vnd.apache.parquet")
    row_id = builder.artifact("sources/episode-rows.json", json_bytes(rows), media="application/json")
    observations = []
    for row in rows:
        event = builder.event("observation", {"state": row.get("observation.state"), "cameras": [],
            "origin": "dataset-recorded", "consumedByPolicy": False, "sourceRowIndex": row["index"],
            "frameIndex": row["frame_index"], "timestamp": row["timestamp"]}, sim_time=row["timestamp"], artifacts=[data_id, row_id, meta_id])
        observations.append(event)
        if "action" in row:
            builder.event("dataset-action", {"action": row["action"], "semantics": "dataset label; execution unverified"},
                          sim_time=row["timestamp"], refs=[event["id"]], artifacts=[data_id, row_id])
    for camera_number, key in enumerate(cameras):
        prefix = "videos/" + key + "/"
        start, end = metadata.get(prefix + "from_timestamp"), metadata.get(prefix + "to_timestamp")
        if not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t) for t in (start, end)) or not 0 <= start < end:
            raise ImportError("Camera episode PTS offsets missing or invalid")
        targets = [start + t for t in timestamps]
        if targets[-1] >= end:
            raise ImportError("Recorded timestamp would cross camera episode boundary")
        relative = info.get("video_path", "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4").format(
            video_key=key, chunk_index=integer(metadata.get(prefix + "chunk_index"), "video chunk"),
            file_index=integer(metadata.get(prefix + "file_index"), "video file"))
        source = contained(root, relative)
        video_id = builder.artifact("sources/" + relative, source=source, media="video/mp4")
        builder.manifest["clocks"].append({"id": "camera-" + str(camera_number), "basis": "source video PTS",
            "episodeOffsetSeconds": start, "episodeEndSeconds": end, "sourceArtifactId": video_id})
        for index, frame in enumerate(video_frames(source, targets, start, end, fps)):
            event = observations[index]
            if frame is None:
                builder.missing += 1
                event["data"]["cameras"].append({"id": key, "available": False, "reason": "No source PTS within declared frame tolerance"})
                continue
            artifact_id = builder.artifact(f"frames/camera-{camera_number}/{index:06d}.png", frame.pop("bytes"),
                media="image/png", shape=frame.pop("shape"), dtype="uint8", endianness="not-applicable", derivedFrom=[video_id], sourceArtifactId=video_id,
                transform="lossless PNG of decoded source frame; original compressed video is retained or explicitly omitted")
            event["artifactIds"].append(artifact_id)
            event["data"]["cameras"].append({"id": key, "artifactId": artifact_id, "sourceArtifactId": video_id,
                "role": "dataset-camera", "consumedByPolicy": False, "offsetSeconds": start, **frame})
    builder.manifest["outcome"].update({"status": "unknown", "completedSteps": length, "actionsApplied": 0,
                                       "inferenceAttempts": 0, "inferenceCompletions": 0})
    return builder.finish()


def event_ns(event):
    raw = event.get("data", {}).get("logTimeNs") if event.get("kind") == "imported-message" else event.get("monotonicNs")
    if raw is not None:
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,20}", raw):
            raise ImportError("Invalid monotonic nanoseconds")
        value = int(raw)
    elif event.get("simTime") is not None:
        value = int(Decimal(str(event["simTime"])) * 1_000_000_000)
    else:
        value = event["seq"]
    if not 0 <= value < 2**64:
        raise ImportError("MCAP timestamp outside unsigned 64-bit range")
    return value


def publish_ns(event):
    if event.get("kind") != "imported-message":
        return event_ns(event)
    raw = event.get("data", {}).get("publishTimeNs")
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,20}", raw) or not 0 <= int(raw) < 2**64:
        raise ImportError("Invalid source publish timestamp")
    return int(raw)


def export_mcap(bundle, destination):
    from workers.arena.recording import verify_bundle
    from mcap.writer import Writer, CompressionType
    manifest = verify_bundle(bundle)
    with Path(destination).open("xb") as stream:
        writer = Writer(stream, compression=CompressionType.NONE, enable_data_crcs=True)
        writer.start(profile="brainsnn.arena.recording.v1", library="brainsnn-inspection/1")
        schema = writer.register_schema("brainsnn.arena.event.v1", "jsonschema", json_bytes({"type": "object"}))
        channels = {}
        for event in manifest["events"]:
            kind = event["kind"]
            if kind not in channels:
                channels[kind] = writer.register_channel("/brainsnn/" + kind, "json", schema,
                    {"clock": "event monotonicNs, else simTime ns, else sequence; retain original clocks in manifest"})
            timestamp = event_ns(event)
            writer.add_message(channels[kind], timestamp, json_bytes(event), publish_ns(event), sequence=event["seq"])
        header = {"schema": BUNDLE_SCHEMA, "manifestText": bundle["manifestText"], "manifestSha256": bundle["manifestSha256"]}
        writer.add_attachment(0, 0, NATIVE_ATTACHMENT, "application/json", json_bytes(header))
        descriptors = {a["path"]: a for a in manifest["artifacts"]}
        for path, encoded in sorted(bundle["payloads"].items()):
            writer.add_attachment(0, 0, "artifacts/" + path, descriptors[path]["mediaType"], base64.b64decode(encoded, validate=True))
        writer.finish()


def bounded_mcap_records(path):
    from mcap.records import Chunk
    from mcap.stream_reader import StreamReader
    path = Path(path)
    if path.stat().st_size > MAX_MCAP_BYTES:
        raise ImportError("MCAP import exceeds 48 MiB; export a shorter incident window")
    # Inspect declared chunk lengths before decoding. Refuse compressed chunks:
    # a malicious compressor can lie about its output size, and the SDK does not
    # provide a portable hard decompression-memory bound. Explicitly decompress
    # a trusted log with external tools before importing it here.
    with path.open("rb") as stream:
        count = 0
        for record in StreamReader(stream, emit_chunks=True, validate_crcs=True, record_size_limit=MAX_MCAP_BYTES).records:
            count += 1
            if count > MAX_MESSAGES * 4:
                raise ImportError("MCAP record count exceeds import limit")
            if isinstance(record, Chunk) and record.compression:
                raise ImportError("Compressed MCAP chunks are unsupported; decompress a trusted bounded recording first")
            if isinstance(record, Chunk) and record.uncompressed_size > MAX_MCAP_BYTES:
                raise ImportError("MCAP chunk exceeds import limit")
    with path.open("rb") as stream:
        yield from StreamReader(stream, validate_crcs=True, record_size_limit=MAX_MCAP_BYTES).records


def import_mcap(path):
    from mcap.records import Attachment, Channel, Message, Schema
    from workers.arena.recording import verify_bundle
    attachments, channels, schemas, messages = {}, {}, {}, []
    for record in bounded_mcap_records(path):
        if isinstance(record, Attachment):
            if record.name in attachments:
                raise ImportError("Duplicate MCAP attachment name")
            attachments[record.name] = record
        elif isinstance(record, Channel):
            channels[record.id] = record
        elif isinstance(record, Schema):
            schemas[record.id] = record
        elif isinstance(record, Message):
            if len(messages) >= MAX_MESSAGES or len(record.data) > 1024 * 1024:
                raise ImportError("MCAP message count or payload exceeds import limit")
            messages.append(record)
    if NATIVE_ATTACHMENT in attachments:
        header = parse_json(attachments[NATIVE_ATTACHMENT].data)
        if set(header) != {"schema", "manifestText", "manifestSha256"}:
            raise ImportError("Invalid native MCAP manifest envelope")
        payloads = {name[len("artifacts/"):]: base64.b64encode(item.data).decode("ascii")
                    for name, item in attachments.items() if name.startswith("artifacts/")}
        if len(attachments) != len(payloads) + 1:
            raise ImportError("Unbound attachment in native MCAP")
        bundle = {**header, "payloads": payloads}
        manifest = verify_bundle(bundle)
        if len(messages) != len(manifest["events"]):
            raise ImportError("MCAP event stream differs from bound manifest")
        for message, event in zip(messages, manifest["events"]):
            channel = channels.get(message.channel_id)
            if (not channel or channel.topic != "/brainsnn/" + event["kind"] or channel.message_encoding != "json"
                    or message.data != json_bytes(event) or message.sequence != event["seq"]
                    or message.log_time != event_ns(event) or message.publish_time != publish_ns(event)):
                raise ImportError("MCAP message or timestamp differs from bound evidence")
        return bundle
    path = Path(path)
    builder = BundleBuilder("mcap-" + file_digest(path)[:24], {"format": "MCAP", "adapterRevision": "brainsnn-mcap-v1",
        "limitations": ["Imported messages do not attest model execution. Clock synchronization is unknown."]},
        {}, [{"id": "mcap-log", "unit": "ns", "basis": "source log_time; clock domain unknown"},
             {"id": "mcap-publish", "unit": "ns", "basis": "source publish_time; clock domain unknown"}])
    original_id = builder.artifact("sources/recording.mcap", source=path, media="application/mcap")
    for message in messages:
        channel = channels.get(message.channel_id)
        if channel is None:
            raise ImportError("MCAP message references an unknown channel")
        schema = schemas.get(channel.schema_id)
        data = {"topic": channel.topic, "messageEncoding": channel.message_encoding,
            "logTimeNs": str(message.log_time), "publishTimeNs": str(message.publish_time),
            "sourceSequence": message.sequence, "channelMetadata": channel.metadata,
            "schemaName": schema.name if schema else None, "semantics": "source message; execution and synchronization unverified"}
        if channel.message_encoding == "json":
            data["payload"] = parse_json(message.data)
        else:
            data["payloadAvailable"] = False
            data["reason"] = "Opaque message retained as original bytes; no decoder installed"
        artifact_id = builder.artifact(f"messages/{len(builder.manifest['events']):06d}.bin", message.data,
            media="application/json" if channel.message_encoding == "json" else "application/octet-stream")
        builder.event("imported-message", data, artifacts=[original_id, artifact_id])
    if not messages:
        raise ImportError("MCAP contains no messages")
    return builder.finish()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    le = commands.add_parser("lerobot", help="Convert one local LeRobot v3 episode, at most 512 frames")
    le.add_argument("directory", type=Path)
    le.add_argument("--episode", type=int, required=True)
    le.add_argument("--out", type=Path, required=True)
    imp = commands.add_parser("import-mcap", help="Convert uncompressed MCAP; opaque types stay opaque")
    imp.add_argument("source", type=Path)
    imp.add_argument("--out", type=Path, required=True)
    exp = commands.add_parser("export-mcap", help="Export a verified Arena bundle with original artifacts")
    exp.add_argument("source", type=Path)
    exp.add_argument("--out", type=Path, required=True)
    check = commands.add_parser("verify", help="Verify exact bytes and reference integrity, not scientific truth")
    check.add_argument("source", type=Path)
    args = parser.parse_args(argv)
    from workers.arena.recording import RecordingError
    try:
        if args.command == "lerobot":
            bundle = import_lerobot(args.directory, args.episode)
        elif args.command == "import-mcap":
            bundle = import_mcap(args.source)
        else:
            if args.source.stat().st_size > 72 * 1024 * 1024:
                raise ImportError("Bundle file exceeds 72 MiB")
            bundle = parse_json(args.source.read_bytes())
            from workers.arena.recording import verify_bundle
            manifest = verify_bundle(bundle)
            if args.command == "verify":
                print(json.dumps({"integrity": "passes", "recordingId": manifest["recordingId"],
                    "complete": manifest["completion"]["status"] == "complete", "identity": "declared, not authenticated"}))
                return 0
            export_mcap(bundle, args.out)
            print("Wrote MCAP with bound manifest, events and original retained artifacts.")
            return 0
        with args.out.open("xb") as output:
            output.write(json_bytes(bundle))
        print("Wrote local inspection bundle. Dataset/imported data does not attest model execution.")
        return 0
    except (ValueError, OSError, KeyError, TypeError, RecordingError) as error:
        parser.exit(2, "Import refused: " + str(error) + "\n")


if __name__ == "__main__":
    sys.exit(main())
