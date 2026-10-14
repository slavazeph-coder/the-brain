#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

OUT = Path.cwd() / "render_output"
TIMELINE = OUT / "Por-Que-Renata-Episode-1-Timeline.json"
CLEAN = OUT / "Por-Que-Renata-Episode-1-Full-Clean.mp4"
FINAL = OUT / "Por-Que-Renata-Episode-1-Full-Post-Ready.mp4"
SRT = OUT / "Por-Que-Renata-Episode-1-Full.srt"

CAPTIONS = {
    "s1": [
        "HOW DID THE NEW GUY\nBECOME HER BOSS?",
        "Starting Monday:\nLeo manages sales.",
        "He started this morning.",
        "Leadership is instinct.",
        "Which instinct?",
        "He's a man.",
        "THAT'S... NOT GREAT.",
        "FRONT PAGE.",
    ],
    "title": [
        "THREE HOURS EARLIER",
        "POR QUÉ RENATA?\nTHE NEWSLETTER QUEEN",
    ],
    "s2": [
        "Three hours earlier...",
        "THIS CHANGES EVERYTHING.",
        "It's the lunch menu.",
        "People need answers.",
    ],
    "s3": [
        "Renata managed one page\nof the company newsletter.",
        "Cheryl, hold my calls.",
        "You don't have a phone.",
        "Then we're already ahead.",
        "IN HER MIND,\nSHE RAN TORONTO.",
    ],
    "s4": [
        "Corporate communications:\nreorganized.",
        "THAT'S GREAT!",
        "Is the printer smoking?",
        "THAT'S ATMOSPHERE.",
    ],
    "s5": [
        "Train Leo on all of sales.",
        "Experience?",
        "I sold a used treadmill.",
        "Assembled?",
        "Eventually.",
        "IT'LL GET BUILT.",
        "Leadership issue.",
    ],
    "s6": [
        "BREAKING NEWS:\nEMPLOYEE SPOTLIGHT",
        "THAT'S GREAT!",
        "Who is it?",
        "Me.",
        "You wrote it.",
        "I HAD EXCLUSIVE ACCESS.",
    ],
    "s7": [
        "By noon: one star,\none scandal, no lunch menu.",
        "Tessa trained Leo.",
        "Now Leo manages sales.",
        "He started this morning.",
        "Leadership is instinct.",
        "Which instinct?",
        "He's a man.",
        "THAT'S... NOT GREAT.",
        "PUT THAT IN\nTHE NEWSLETTER.",
    ],
    "s8": [
        "NEXT EPISODE:\nTHE NEW BOSS",
        "This changes everything.",
    ],
}


def srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def allocate(start: float, duration: float, lines: list[str]) -> list[tuple[float, float, str]]:
    weights = [max(1.0, len(line.replace("\n", " ")) / 20.0) for line in lines]
    total = sum(weights)
    cursor = start
    entries: list[tuple[float, float, str]] = []
    for index, (line, weight) in enumerate(zip(lines, weights)):
        span = duration * weight / total
        end = start + duration if index == len(lines) - 1 else cursor + span
        entries.append((cursor, max(cursor + 0.45, end - 0.05), line))
        cursor = end
    return entries


def main() -> None:
    timeline = json.loads(TIMELINE.read_text(encoding="utf-8"))
    entries: list[tuple[float, float, str]] = []
    for scene in timeline["scenes"]:
        entries.extend(allocate(float(scene["start"]), float(scene["duration"]), CAPTIONS[scene["id"]]))

    rows: list[str] = []
    for index, (start, end, text) in enumerate(entries, start=1):
        rows.extend([str(index), f"{srt_time(start)} --> {srt_time(end)}", text, ""])
    SRT.write_text("\n".join(rows), encoding="utf-8")

    temp = OUT / "Por-Que-Renata-Episode-1-Full-Post-Ready.tmp.mp4"
    subtitle_filter = (
        f"subtitles={SRT}:force_style='FontName=DejaVu Sans,FontSize=23,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,"
        "BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=165,Bold=1'"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(CLEAN), "-vf", subtitle_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-profile:v", "high",
            "-level", "4.2", "-pix_fmt", "yuv420p", "-r", "30",
            "-c:a", "copy", "-movflags", "+faststart", str(temp),
        ],
        check=True,
    )
    temp.replace(FINAL)


if __name__ == "__main__":
    main()
