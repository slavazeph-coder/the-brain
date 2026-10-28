"""Browser handoff: actual same-origin IndexedDB transfer, no worker upload.

Runs against the built BrainSNN HTTP server. This does not upload user media.
"""
import io
import os
from urllib.parse import parse_qs, urlsplit

from PIL import Image
from playwright.sync_api import sync_playwright

URL = os.environ.get("WORLD_URL", "http://127.0.0.1:4180/")
SITE = URL.split("/world/")[0].rstrip("/")


def capture_workspace_url(url):
    parsed = urlsplit(str(url))
    query = parse_qs(parsed.query)
    return (
        parsed.path == "/world/index.html"
        and parsed.fragment == "workspace"
        and query.get("sandbox") == ["capture"]
        and "scene" not in query
        and query.get("tool", ["edit"]) == ["edit"]
        and "handoff" not in query
    )


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
    try:
        page.wait_for_url(
            capture_workspace_url,
            wait_until="domcontentloaded",
            timeout=30000,
        )
    except Exception:
        print("handoff navigation did not complete", {
            "browser": browser.browser_type.name,
            "url": page.url,
            "alerts": page.locator(".world-capture-alert").all_text_contents(),
            "status": page.locator("#status").all_text_contents(),
            "errors": errors,
        }, flush=True)
        raise
    page.wait_for_function(
        "document.querySelector('#status')?.textContent?.includes('Loaded 1 local capture')",
        timeout=30000,
    )
    assert page.locator("#provenance").inner_text() == "LOCAL SOURCE"
    assert page.locator(".source-row button[data-source]").filter(has_text="living-room.png").count() == 1
    assert page.locator('[data-tab="capture"]').get_attribute("aria-selected") == "true"
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

    # A private handoff must take precedence over a shared Street route. Use
    # actual IndexedDB bytes again; no fake app controller or worker is involved.
    handoff_id = page.evaluate("""async bytes => {
      const {stageLocalCapture} = await import('./capture-handoff.mjs');
      const file = new File([new Uint8Array(bytes)], 'street-route.png', {type:'image/png'});
      return stageLocalCapture([file], {goal:'room'});
    }""", list(raw.getvalue()))
    request_boundary = len(requests)
    page.goto(
        SITE + "/world/index.html?sandbox=street&scene=green-gardens&tool=simulate#handoff=" + handoff_id,
        wait_until="domcontentloaded",
    )
    page.wait_for_url(capture_workspace_url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_function(
        "document.querySelector('#status')?.textContent?.includes('Loaded 1 local capture')",
        timeout=30000,
    )
    assert page.locator("#workspace").get_attribute("data-sandbox") == "capture"
    assert page.locator('[data-tab="capture"]').get_attribute("aria-selected") == "true"
    assert page.locator(".source-row button[data-source]").filter(has_text="street-route.png").count() == 1
    assert page.locator("#street-mount").evaluate("host => host.shadowRoot === null")
    assert not any("/street/workspace.mjs" in url for _, url in requests[request_boundary:])
    assert page.evaluate("""async id => {
      const {readLocalCapture} = await import('./capture-handoff.mjs');
      return await readLocalCapture(id) === null;
    }""", handoff_id)
    assert not any("/v1/uploads" in url or "/v1/jobs" in url for _, url in requests), requests
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        for browser_name in os.environ.get("WORLD_BROWSERS", "chromium").split(","):
            browser = getattr(playwright, browser_name).launch(headless=True)
            check(browser)
            browser.close()
            print(browser_name + ": consented capture handoff passed")
