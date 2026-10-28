"""Browser handoff: actual same-origin IndexedDB transfer, no worker upload.

Runs against the built BrainSNN HTTP server. This does not upload user media.
"""
import io
import os
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import sync_playwright

URL = os.environ.get("WORLD_URL", "http://127.0.0.1:4180/")
SITE = URL.split("/world/")[0].rstrip("/")


def check(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append((request.method, request.url)))
    page.goto(SITE + "/scan?goal=room", wait_until="domcontentloaded")
    page.locator(".world-goal-card").first.wait_for()
    assert page.locator(".world-goal-card").count() == 4

    raw = io.BytesIO()
    Image.new("RGB", (24, 24), color=(26, 110, 145)).save(raw, format="PNG")
    page.locator('input[aria-label="Select phone video or photographs"]').set_input_files({
        "name": "living-room.png", "mimeType": "image/png", "buffer": raw.getvalue(),
    })
    page.get_by_role("button", name="Continue with this capture").click()
    page.wait_for_url(lambda url: str(url).endswith("/world/index.html#workspace"), timeout=30000)
    page.wait_for_function(
        "document.querySelector('#status')?.textContent?.includes('Loaded 1 local capture')",
        timeout=30000,
    )
    assert page.locator("#provenance").inner_text() == "LOCAL SOURCE"
    assert page.locator(".source-row button[data-source]").filter(has_text="living-room.png").count() == 1
    assert page.locator('[data-tab="capture"]').get_attribute("aria-selected") == "true"
    assert not any("/v1/uploads" in url or "/v1/jobs" in url for _, url in requests), requests

    remaining = page.evaluate("""async () => new Promise((resolve, reject) => {
      const open = indexedDB.open('brainsnn-capture-handoff-v1', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('captures', 'readonly').objectStore('captures').count();
        req.onsuccess = () => { resolve(req.result); db.close(); };
        req.onerror = () => reject(req.error);
      };
    })""")
    assert remaining == 0, remaining
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        for browser_name in os.environ.get("WORLD_BROWSERS", "chromium").split(","):
            browser = getattr(playwright, browser_name).launch(headless=True)
            check(browser)
            browser.close()
            print(browser_name + ": consented capture handoff passed")
