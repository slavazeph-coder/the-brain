#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path.cwd()
WORK = ROOT / "render_renata"
OUT = ROOT / "render_output"
WORK.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)

VIDEO_URLS = {
    "v1": "https://cdn-editing-temp.picsart.com/editing-temp/1d282f03-20db-410c-b756-c79aa04a0e30.mp4",
    "v2": "https://cdn-editing-temp.picsart.com/editing-temp/b0af9432-21c7-4dfa-9a49-5e23fb74ee0e.mp4",
    "v3": "https://cdn-editing-temp.picsart.com/editing-temp/502002e5-1a92-4f6f-8332-fe5fc4c41758.mp4",
    "v4": "https://cdn-editing-temp.picsart.com/editing-temp/af06e110-3b80-4bc2-8462-b4c38f8a1f29.mp4",
    "v5": "https://cdn-editing-temp.picsart.com/editing-temp/43af2e9a-c618-4c3c-a954-0e03052e96a6.mp4",
    "v6": "https://cdn-editing-temp.picsart.com/editing-temp/dbd52e74-c494-4597-8e20-e5b7ea62bc5e.mp4",
    "v7": "https://cdn-editing-temp.picsart.com/editing-temp/9c0dc274-1489-4566-a105-4142c3dec2ca.mp4",
}

IMAGE_URLS = {
    "title": "https://cdn-pipeline-output.picsart.com/pipeline-output/8e4624a5-bfa5-4b5e-be30-9bda1efb3c2b.jpeg",
}

VOICE_URLS = {
    "s1": "https://cdnmf.picsart.com/cloud-storage/acaeb14e-1e90-4aba-88aa-28fe5422946f.wav",
    "s2": "https://cdnmf.picsart.com/cloud-storage/04dd77d7-99aa-489c-931f-2016dea140a5.wav",
    "s3": "https://cdnmf.picsart.com/cloud-storage/63d4672d-39d1-4b3b-8af2-47a94f8f5e5f.wav",
    "s4": "https://cdnmf.picsart.com/cloud-storage/91967c82-eb09-441d-9a4c-74d33777517f.wav",
    "s5": "https://cdnmf.picsart.com/cloud-storage/f52a571b-d5f9-49c1-981e-705cecc89ad8.wav",
    "s6": "https://cdnmf.picsart.com/cloud-storage/656e8fb2-e38f-45a2-940d-9d6bbce7fda7.wav",
    "s7": "https://cdnmf.picsart.com/cloud-storage/6355abf9-50e7-479e-b9d7-97a975f135a1.wav",
    "s8": "https://cdnmf.picsart.com/cloud-storage/8025a45f-22d4-4c9e-a56b-01b2ad5e7080.wav",
}

SFX_URLS = {
    "sting": "https://cdn-editing-temp.picsart.com/editing-temp/77e0fbbc-b70e-4bea-b81f-7dd9ba691ef2.mp3",
    "ambience": "https://cdn-editing-temp.picsart.com/editing-temp/d7ec6a17-245b-4d7a-9dbb-457a18e7836f.mp3",
    "rewind": "https://cdn-editing-temp.picsart.com/editing-temp/ad5a1420-e4f8-4a70-a4d2-1ee97824a15c.mp3",
    "copy": "https://cdn-editing-temp.picsart.com/editing-temp/6931f6f1-5c3f-45dd-b4ec-eeca0cb11feb.mp3",
}

SCENES = [
    {
        "id": "s1",
        "video": "v6",
        "min": 13.0,
        "max": 16.0,
        "crop": 1.00,
        "sfx": [("sting", -3.0, 0.70)],
        "subs": [
            "How did a one-page lunch menu end with a new employee becoming his trainer's boss before noon?",
            "Starting Monday, Leo will be Tessa's new manager.",
            "He started this morning.",
            "Leadership is about instinct.",
            "Which instinct?",
            "He's a man.",
            "THAT'S... NOT GREAT.",
            "FRONT PAGE.",
        ],
    },
    {
        "id": "title",
        "image": "title",
        "fixed": 3.0,
        "sfx": [("rewind", 0.0, 0.85)],
        "subs": ["THREE HOURS EARLIER", "POR QUÉ RENATA?\nTHE NEWSLETTER QUEEN"],
    },
    {
        "id": "s2",
        "video": "v1",
        "min": 9.0,
        "max": 11.0,
        "crop": 1.05,
        "sfx": [("copy", 0.0, 0.45), ("sting", -2.8, 0.38)],
        "subs": [
            "Three hours earlier, Renata discovered lunch.",
            "THIS CHANGES EVERYTHING.",
            "It's the lunch menu.",
            "Exactly. People need answers.",
        ],
    },
    {
        "id": "s3",
        "video": "v3",
        "min": 10.0,
        "max": 12.0,
        "crop": 1.00,
        "sfx": [],
        "subs": [
            "From a cramped Barrie office, Renata managed one page of the company newsletter.",
            "Cheryl, hold all my calls.",
            "You don't have a phone.",
            "Then we're already ahead.",
            "In her mind, she ran Toronto.",
        ],
    },
    {
        "id": "s4",
        "video": "v4",
        "min": 8.0,
        "max": 10.0,
        "crop": 1.04,
        "sfx": [("sting", -2.4, 0.28)],
        "subs": [
            "I've reorganized corporate communications.",
            "THAT'S GREAT!",
            "Is the printer supposed to be smoking?",
            "That's atmosphere.",
        ],
    },
    {
        "id": "s5",
        "video": "v5",
        "min": 9.0,
        "max": 11.0,
        "crop": 1.00,
        "sfx": [],
        "subs": [
            "Tessa, train Leo on every part of sales.",
            "Experience?",
            "I sold a used treadmill.",
            "Assembled?",
            "Eventually.",
            "IT'LL GET BUILT.",
            "Leadership issue.",
        ],
    },
    {
        "id": "s6",
        "video": "v6",
        "min": 9.0,
        "max": 11.0,
        "crop": 1.10,
        "sfx": [("copy", 0.2, 0.25)],
        "subs": [
            "BREAKING NEWS: We now have an employee spotlight.",
            "THAT'S GREAT!",
            "Who is it?",
            "Me.",
            "You wrote it.",
            "I had exclusive access.",
        ],
    },
    {
        "id": "s7",
        "video": "v2",
        "min": 14.0,
        "max": 17.0,
        "crop": 1.03,
        "sfx": [("sting", -5.0, 0.68)],
        "subs": [
            "By noon, the newsletter had a star, a scandal, and still no lunch menu.",
            "Tessa has done an excellent job training Leo.",
            "So Leo will now manage sales.",
            "He started this morning.",
            "Leadership is about instinct.",
            "Which instinct?",
            "He's a man.",
            "THAT'S... NOT GREAT.",
            "PUT THAT IN THE NEWSLETTER.",
        ],
    },
    {
        "id": "s8",
        "video": "v7",
        "min": 4.0,
        "max": 5.0,
        "crop": 1.08,
        "sfx": [("copy", 0.0, 0.60)],
        "subs": ["NEXT EPISODE: THE NEW BOSS", "This changes everything."],
    },
]


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=check, text=True)


def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 1000:
        return
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
                    "Accept": "*/*",
                },
            )
            with urllib.request.urlopen(req, timeout=120) as response, open(path, "wb") as handle:
                handle.write(response.read())
            if path.stat().st_size < 1000:
                raise RuntimeError(f"Downloaded file is unexpectedly small: {path}")
            return
        except Exception as exc:
            last_error = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed downloading {url}: {last_error}")


def probe_duration(path: Path) -> float:
    result = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return max(0.01, float(result))


def atempo_chain(speed: float) -> str:
    speed = max(0.05, speed)
    filters: list[str] = []
    while speed > 2.0:
        filters.append("atempo=2.0")
        speed /= 2.0
    while speed < 0.5:
        filters.append("atempo=0.5")
        speed /= 0.5
    filters.append(f"atempo={speed:.6f}")
    return ",".join(filters)


def srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def allocate_subtitles(start: float, duration: float, lines: list[str], entries: list[tuple[float, float, str]]) -> None:
    weights = [max(1.0, len(line.replace("\n", " ")) / 23.0) for line in lines]
    total = sum(weights)
    cursor = start
    for index, (line, weight) in enumerate(zip(lines, weights)):
        span = duration * weight / total
        end = start + duration if index == len(lines) - 1 else cursor + span
        entries.append((cursor, max(cursor + 0.45, end - 0.05), line))
        cursor = end


def create_video_segment(scene: dict, duration: float, index: int) -> Path:
    output = WORK / f"video_{index:02d}_{scene['id']}.mp4"
    if "image" in scene:
        source = WORK / f"image_{scene['image']}.jpg"
        vf = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,zoompan=z='min(zoom+0.0008,1.06)':d=1:s=1080x1920:fps=30,"
            "format=yuv420p"
        )
        run([
            "ffmpeg", "-y", "-loop", "1", "-i", str(source), "-t", f"{duration:.3f}",
            "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", str(output),
        ])
    else:
        source = WORK / f"video_{scene['video']}.mp4"
        crop = float(scene.get("crop", 1.0))
        vf_parts = ["scale=1080:1920:force_original_aspect_ratio=increase", "crop=1080:1920"]
        if crop > 1.001:
            width = int(round(1080 / crop))
            height = int(round(1920 / crop))
            width -= width % 2
            height -= height % 2
            vf_parts.extend([f"crop={width}:{height}:(iw-ow)/2:(ih-oh)/2", "scale=1080:1920"])
        vf_parts.extend(["fps=30", "format=yuv420p"])
        run([
            "ffmpeg", "-y", "-stream_loop", "-1", "-i", str(source), "-t", f"{duration:.3f}",
            "-vf", ",".join(vf_parts), "-an", "-c:v", "libx264", "-preset", "medium",
            "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart",
            str(output),
        ])
    return output


def create_audio_segment(scene: dict, duration: float, index: int) -> Path:
    output = WORK / f"audio_{index:02d}_{scene['id']}.m4a"
    ambience = WORK / "sfx_ambience.mp3"
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []

    inputs.extend(["-stream_loop", "-1", "-i", str(ambience)])
    filters.append(f"[0:a]atrim=0:{duration:.3f},asetpts=N/SR/TB,volume=0.10[amb]")
    labels.append("[amb]")
    input_index = 1

    if scene["id"] == "title":
        filters.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{duration:.3f}[voice]")
        labels.append("[voice]")
    else:
        voice = WORK / f"voice_{scene['id']}.wav"
        voice_duration = probe_duration(voice)
        usable = max(0.8, duration - 0.30)
        speed = max(1.0, voice_duration / usable)
        voice_filter = atempo_chain(speed)
        inputs.extend(["-i", str(voice)])
        filters.append(
            f"[{input_index}:a]aformat=sample_rates=48000:channel_layouts=stereo,{voice_filter},"
            f"apad,atrim=0:{duration:.3f},asetpts=N/SR/TB,volume=1.00[voice]"
        )
        labels.append("[voice]")
        input_index += 1

    for sfx_name, relative_start, volume in scene.get("sfx", []):
        sfx_path = WORK / f"sfx_{sfx_name}.mp3"
        inputs.extend(["-i", str(sfx_path)])
        start = relative_start if relative_start >= 0 else max(0.0, duration + relative_start)
        delay = int(round(start * 1000))
        label = f"sfx{input_index}"
        filters.append(
            f"[{input_index}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
            f"volume={volume:.3f},adelay={delay}|{delay},apad,atrim=0:{duration:.3f}[{label}]"
        )
        labels.append(f"[{label}]")
        input_index += 1

    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=longest:normalize=0,"
        + f"atrim=0:{duration:.3f},alimiter=limit=0.92,asetpts=N/SR/TB[mix]"
    )

    run([
        "ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[mix]",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{duration:.3f}",
        str(output),
    ])
    return output


def main() -> None:
    for key, url in VIDEO_URLS.items():
        download(url, WORK / f"video_{key}.mp4")
    for key, url in IMAGE_URLS.items():
        download(url, WORK / f"image_{key}.jpg")
    for key, url in VOICE_URLS.items():
        download(url, WORK / f"voice_{key}.wav")
    for key, url in SFX_URLS.items():
        download(url, WORK / f"sfx_{key}.mp3")

    timeline: list[dict] = []
    cursor = 0.0
    subtitle_entries: list[tuple[float, float, str]] = []
    video_segments: list[Path] = []
    audio_segments: list[Path] = []

    for index, scene in enumerate(SCENES, start=1):
        if "fixed" in scene:
            duration = float(scene["fixed"])
        else:
            voice_duration = probe_duration(WORK / f"voice_{scene['id']}.wav")
            duration = min(float(scene["max"]), max(float(scene["min"]), voice_duration + 0.35))
        video_segments.append(create_video_segment(scene, duration, index))
        audio_segments.append(create_audio_segment(scene, duration, index))
        allocate_subtitles(cursor, duration, scene["subs"], subtitle_entries)
        timeline.append({"id": scene["id"], "start": cursor, "duration": duration})
        cursor += duration

    video_list = WORK / "video_concat.txt"
    video_list.write_text("\n".join(f"file '{path.resolve()}'" for path in video_segments) + "\n")
    master_video = WORK / "master_video.mp4"
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(video_list),
        "-c", "copy", str(master_video),
    ])

    audio_inputs: list[str] = []
    audio_labels: list[str] = []
    for i, path in enumerate(audio_segments):
        audio_inputs.extend(["-i", str(path)])
        audio_labels.append(f"[{i}:a]")
    master_audio = WORK / "master_audio.m4a"
    run([
        "ffmpeg", "-y", *audio_inputs,
        "-filter_complex", "".join(audio_labels) + f"concat=n={len(audio_segments)}:v=0:a=1,"
        "loudnorm=I=-16:TP=-1.5:LRA=9[a]",
        "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        str(master_audio),
    ])

    srt_path = OUT / "Por-Que-Renata-Episode-1-Full.srt"
    srt_lines: list[str] = []
    for i, (start, end, text) in enumerate(subtitle_entries, start=1):
        srt_lines.extend([str(i), f"{srt_time(start)} --> {srt_time(end)}", text, ""])
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

    timeline_path = OUT / "Por-Que-Renata-Episode-1-Timeline.json"
    timeline_path.write_text(json.dumps({"duration": cursor, "scenes": timeline}, indent=2), encoding="utf-8")

    final_path = OUT / "Por-Que-Renata-Episode-1-Full-Post-Ready.mp4"
    subtitle_filter = (
        f"subtitles={srt_path}:force_style='FontName=DejaVu Sans,FontSize=23,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,"
        "BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=165,Bold=1'"
    )
    run([
        "ffmpeg", "-y", "-i", str(master_video), "-i", str(master_audio),
        "-vf", subtitle_filter, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high",
        "-level", "4.2", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", "-shortest", str(final_path),
    ])

    # Create a clean version without burned-in subtitles as an editing master.
    clean_path = OUT / "Por-Que-Renata-Episode-1-Full-Clean.mp4"
    run([
        "ffmpeg", "-y", "-i", str(master_video), "-i", str(master_audio),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-shortest", str(clean_path),
    ])

    print(json.dumps({"final": str(final_path), "duration": cursor}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Render failed: {exc}", file=sys.stderr)
        raise
