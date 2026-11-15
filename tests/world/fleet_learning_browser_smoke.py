"""Browser smoke for the independent Fleet Learning Lab prototype."""
from __future__ import annotations

import functools
import json
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "brainsnn-r3f-app" / "public"


def main():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(PUBLIC))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(accept_downloads=True, viewport={"width": 1220, "height": 900})
                errors = []
                page.on("pageerror", lambda err: errors.append(str(err)))
                page.goto(f"http://127.0.0.1:{server.server_address[1]}/world/fleet-learning.html", wait_until="load")
                assert page.title() == "Fleet Learning Lab | BrainSNN"
                assert page.locator("#transfer").is_disabled()
                page.locator("#record").click()
                page.wait_for_function("!document.querySelector('#transfer').disabled", timeout=15000)
                assert page.locator("#teacher-distance").inner_text() == "7.6 m"
                page.locator("#blocked").click()
                assert "Unsafe direct replay rejected" in page.locator("#status").inner_text()
                page.locator("#transfer").click()
                page.wait_for_function("document.querySelector('#status').textContent.includes('physical robot has not been tested')", timeout=16000)
                assert page.locator("#follower-distance").inner_text() == "13.2 m"
                with page.expect_download() as d:
                    page.locator("#export").click()
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "evidence.json"
                    d.value.save_as(str(path))
                    evidence = json.loads(path.read_text())
                    assert evidence["scene"]["evidence"] == "authored-synthetic"
                    assert evidence["source"]["outcome"] == "success"
                    assert evidence["follower"]["radius_m"] == 0.54
                    assert len(evidence["follower"]["path_cells"]) > len(evidence["source"]["path_cells"])
                    assert "No physical robot" in evidence["limitations"]
                assert not errors, errors
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
