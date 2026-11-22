"""Exercise capture alignment and moving-scene playback through the public playground."""
import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "brainsnn-r3f-app/public"
EXTRACTOR = ROOT / "scripts/world-open4dgs/extract_capture.py"


def make_videos(root):
    # Both clips contain the same generated event; camera two starts ten frames later.
    files = []
    for index, start in enumerate([0, 10]):
        folder = root / f"{index + 1:04d}"
        folder.mkdir(parents=True)
        path = folder / "clip.webm"
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=144x96:rate=25:duration=3", "-vf",
                        f"trim=start_frame={start},setpts=PTS-STARTPTS", "-c:v", "libvpx",
                        "-b:v", "600k", "-g", "5", str(path)], check=True)
        files.append(path)
    return files


def verify_extraction(setup, video_dir, output):
    args = [sys.executable, str(EXTRACTOR), "--setup", str(setup), "--videos", str(video_dir), "--output-dir", str(output)]
    subprocess.run(args, check=True)
    cameras = [sorted((output / "images" / name).glob("*.jpg")) for name in ["0001", "0002"]]
    assert [len(group) for group in cameras] == [25, 25]
    for frame in [0, 12, 24]:
        with Image.open(cameras[0][frame]) as a, Image.open(cameras[1][frame]) as b:
            assert max(ImageStat.Stat(ImageChops.difference(a, b)).mean) < 6, "Shared event is out of sync"
    invalid = json.loads(setup.read_text())
    invalid["cameras"][1]["edge_sha256"] = "0" * 64
    bad = output.parent / "wrong-input.json"
    bad.write_text(json.dumps(invalid))
    args[args.index("--setup") + 1] = str(bad)
    args[-1] = str(output.parent / "failed")
    failed = subprocess.run(args, capture_output=True, text=True)
    assert failed.returncode != 0 and "fingerprint" in failed.stderr and not Path(args[-1]).exists()


def verify_browser(pw, name, origin, files, output, native, ply):
    browser = getattr(pw, name).launch(headless=True)
    page = browser.new_page(viewport={"width": 1360, "height": 900}, reduced_motion="reduce", accept_downloads=True)
    errors, writes = [], []
    page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
    page.on("request", lambda request: writes.append(request.method) if request.method not in ("GET", "HEAD", "OPTIONS") else None)
    page.goto(origin + "/world/index.html?nosw=1", wait_until="domcontentloaded")
    expect(page.locator("[data-layer-tab=open4dgs]")).to_be_attached()
    page.locator("#tab-world").click()
    page.get_by_role("tab", name="Watch a moving scene").click()
    panel = page.locator("#layer-panel-open4dgs")
    frame = panel.locator("[data-open4dgs-frame]")
    seek = panel.locator("[data-open4dgs-seek]")
    panel.locator("[data-open4dgs-example]").click()
    expect(frame).to_contain_text("Frame 1 of 16")
    panel.locator("[data-open4dgs-play]").click()
    page.wait_for_function("Number(document.querySelector('[data-open4dgs-seek]').value) > 0")
    panel.locator("[data-open4dgs-pause]").click()
    seek.press("End")
    expect(frame).to_contain_text("Frame 16 of 16")
    panel.locator('[data-open4dgs-turn="right"]').click()
    source_files = []
    if native:
        source_files.append([native])
    if ply:
        source_files.append([ply / "export_meta.json", *sorted(ply.glob("frame_*.ply"))])
    for group in source_files:
        panel.locator("[data-open4dgs-files]").set_input_files([str(p) for p in group])
        panel.locator("[data-open4dgs-import]").click()
        expect(panel.locator("[data-open4dgs-status]")).to_contain_text("Local scene opened", timeout=12000)
        seek.press("End")
        assert int(seek.input_value()) > 0
    panel.locator("[data-open4dgs-clear]").click()
    expect(panel.locator("[data-open4dgs-result]")).to_be_hidden()

    capture = panel.locator("[data-open4d-capture]")
    capture.get_by_text("Line up my camera clips", exact=True).click()
    for index, (file, mark) in enumerate(zip(files, [.8, .4])):
        capture.locator("[data-open4dc-clips]").set_input_files(str(file))
        video = capture.locator("video").nth(index)
        mark_button = capture.get_by_role("button", name=f"Mark this moment for camera {index + 1}")
        expect(mark_button).to_be_enabled(timeout=15000)
        video.evaluate("(v,t) => new Promise(r => {v.addEventListener('seeked',r,{once:true});v.currentTime=t})", mark)
        mark_button.click()
    capture.locator("[data-open4dc-rate]").select_option("25")
    capture.locator("[data-open4dc-seconds]").fill("1")
    capture.locator("[data-open4dc-time]").press("End")
    expect(capture.locator("[data-open4dc-elapsed]")).to_contain_text("Frame 25 of 25")
    times = capture.locator("video").evaluate_all("vs=>vs.map(v=>v.currentTime)")
    assert abs(times[0] - 1.76) < .02 and abs(times[1] - 1.36) < .02, times
    with page.expect_download() as result:
        capture.locator("[data-open4dc-save]").click()
    setup = output / f"{name}-camera-setup.json"
    result.value.save_as(setup)
    saved = json.loads(setup.read_text())
    assert saved["fps"] == "25" and saved["frame_count"] == 25
    assert [cam["file"] for cam in saved["cameras"]] == ["clip.webm", "clip.webm"]
    for cam, file in zip(saved["cameras"], files):
        data = file.read_bytes()
        assert cam["edge_sha256"] == hashlib.sha256(data[:65536] + data[max(min(65536,len(data)),len(data)-65536):]).hexdigest()
    page.locator('#playground-text-size').click()
    expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
    for width in [390, 320]:
        page.set_viewport_size({"width":width,"height":850})
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        assert panel.evaluate("e=>e.scrollWidth<=Math.ceil(e.getBoundingClientRect().width)+1")
    capture.get_by_role("button", name="Remove camera 2").click()
    expect(capture.locator("[data-open4dc-review]")).to_be_hidden()
    capture.locator("[data-open4dc-clear]").click()
    expect(capture.locator("video")).to_have_count(0)
    # A larger rig opens at most four video decoders at a time. Marked times persist across groups.
    sample = files[0].read_bytes()
    capture.locator("[data-open4dc-clips]").set_input_files([
        {"name":f"camera-{i}.webm", "mimeType":"video/webm", "buffer":sample} for i in range(1, 6)])
    expect(capture.locator("video[src]")).to_have_count(4)
    for i in range(1, 5):
        capture.get_by_role("button", name=f"Mark this moment for camera {i}", exact=True).click()
    capture.get_by_role("button", name="Next cameras").click()
    expect(capture.locator("video[src]")).to_have_count(1)
    capture.get_by_role("button", name="Mark this moment for camera 5").click()
    expect(capture.locator("[data-open4dc-review]")).to_be_visible()
    capture.get_by_role("button", name="Previous cameras").click()
    expect(capture.locator("video[src]")).to_have_count(4)
    expect(capture.locator("[data-open4dc-review]")).to_be_visible()
    capture.locator("[data-open4dc-clear]").click()
    assert not writes and not errors, (writes, errors)
    browser.close()
    return setup


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--origin", help="Use an already running website")
    cli.add_argument("--native", type=Path, help="Also verify a local ASU single-clip .trigsbin")
    cli.add_argument("--ply", type=Path, help="Also verify a local ASU export directory")
    args = cli.parse_args()
    server = None
    if args.origin:
        origin = args.origin.rstrip("/")
    else:
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        class StaticServer(ThreadingHTTPServer):
            request_queue_size = 128
        server = StaticServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(PUBLIC)))
        Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with TemporaryDirectory() as tmp, sync_playwright() as pw:
            root = Path(tmp)
            files = make_videos(root / "videos")
            for name in ["chromium", "webkit"]:
                setup = verify_browser(pw, name, origin, files, root, args.native, args.ply)
                verify_extraction(setup, root / "videos", root / name)
                print(f"{name} passed playback, local import, camera alignment, matched extracted images and mobile layout", flush=True)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
