"""Debug the report UI smoke test connection timeout."""
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/playwright/world/report-receipt"
OUTPUT.mkdir(parents=True, exist_ok=True)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    python = sys.executable

    with tempfile.TemporaryDirectory(prefix="world-report-ui-") as directory:
        tmp = Path(directory)
        keyfile = tmp / "fixture-signing.key"
        public = tmp / "fixture-public.json"
        subprocess.run(
            [
                python,
                "-c",
                "from pathlib import Path;import sys;from robotics.world_worker.report_receipts import init_key;init_key(Path(sys.argv[1]),Path(sys.argv[2]))",
                str(keyfile),
                str(public),
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
        key = json.loads(public.read_text())
        photo = tmp / "explicit-authored-fixture.png"
        from PIL import Image

        Image.new("RGB", (32, 24), (30, 150, 220)).save(photo)
        adapters = tmp / "adapters.json"
        adapters.write_text("[]")
        token = secrets.token_urlsafe(48)
        worker_url = f"http://127.0.0.1:{free_port()}"
        environment = {
            **os.environ,
            "WORLD_WORKER_TOKEN": token,
            "WORLD_WORKER_DIR": str(tmp / "data"),
            "WORLD_ADAPTERS_FILE": str(adapters),
            "WORLD_ALLOWED_ORIGINS": origin,
            "WORLD_REPORT_SIGNING_KEY": str(keyfile),
        }
        environment.pop("WORLD_TENANTS_FILE", None)
        worker = subprocess.Popen(
            [
                python,
                "-m",
                "uvicorn",
                "robotics.world_worker.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                worker_url.rsplit(":", 1)[1],
                "--no-access-log",
            ],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        try:
            # Wait for worker
            for i in range(100):
                try:
                    with urllib.request.urlopen(worker_url + "/healthz", timeout=1) as resp:
                        if resp.status == 200:
                            print(f"Worker ready after {i * 0.1:.1f}s on {worker_url}")
                            break
                except OSError:
                    time.sleep(0.1)
            else:
                print("Worker did not start in time")

            with __import__("playwright").sync_api.sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    viewport={"width": 390, "height": 844}, has_touch=True
                )
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))

                # Navigate to UI
                page.goto(origin + "/world/index.html", wait_until="networkidle")
                print(f"Page loaded, title: {page.title()}")

                # Check if systems-grid has cards
                cards = page.wait_for_function(
                    'document.querySelectorAll(".system-card").length', timeout=10000
                )
                print(f"System cards: {cards}")

                # Click to open connection dialog
                page.locator(".processing-options summary").click()
                page.locator("[data-action=connection]").click()
                print("Connection dialog opened")

                # Fill in worker URL and token
                page.locator("#worker-url").fill(worker_url)
                page.locator("#worker-token").fill(token)
                page.locator("#connect").click()
                print(f"Clicked connect, worker_url={worker_url}")

                # Wait for connection status with verbose output
                try:
                    page.wait_for_function(
                        "document.querySelector('#connection-status').textContent.startsWith('Connected.')",
                        timeout=30000,
                    )
                    status_text = page.locator("#connection-status").inner_text()
                    print(f"Connection established: {status_text}")
                except Exception as e:
                    status_text = page.locator("#connection-status").inner_text()
                    print(f"Connection timeout: {status_text}")
                    print(f"Error: {e}")

                browser.close()
        finally:
            worker.terminate()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=5)

    server.shutdown()
    server.server_close()


if __name__ == "__main__":
    main()
