"""Browser handoff: actual same-origin IndexedDB transfer, no worker upload.

Runs against the built BrainSNN HTTP server. This does not upload user media.
"""
import io
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright

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
    # On phones the provenance badge sits in the collapsed "Map options" panel, so read its value;
    # the always-visible heading badge must say the map is the visitor's own source.
    assert page.locator("#provenance").text_content() == "LOCAL SOURCE"
    assert page.locator("#workspace-project-basis").inner_text() == "YOUR SOURCE"
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


def check_studio(browser):
    '''The actual embedded photo studio returns media into the same edited world.'''
    context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    page = context.new_page()
    errors, posts = [], []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("request", lambda req: posts.append(req.url) if req.method == "POST" else None)
    page.goto(SITE + "/world/", wait_until="domcontentloaded")
    frame = page.frame_locator('iframe[title^="BrainSNN World Builder"]')
    frame.locator('#tab-world').click()
    obj = frame.locator('#object-name')
    obj.fill('Edited kitchen table')
    obj.press('Tab')
    # An expando on the original native DOM distinguishes true reuse from a fresh app.
    frame.locator('#workspace').evaluate("el => el.originalWorld = true")
    media = Path(__file__).resolve().parents[2] / 'brainsnn-r3f-app/public/world/media'
    for launch, fixture in [('search', 'robot-task-poster.jpg'), ('example', 'robot-task-comparison.mp4')]:
        if launch == 'search':
            frame.locator('#studio-search-open').click()
            frame.locator('#studio-search').fill('Photo and video studio')
            frame.locator('#studio-panel [data-studio-target="/scan"]').click()
        else:
            examples = frame.locator('#world-examples')
            if examples.get_attribute('open') is None:
                examples.locator('summary').first.click()
            frame.locator('[data-demo=generated]').click()
            frame.locator('#hero-demo-link').click()
        workbench = frame.locator('#studio-workbench')
        expect(workbench).to_be_visible()
        scanner = frame.frame_locator('#studio-workbench-frame')
        expect(scanner.locator('.world-goal-card')).to_have_count(4)
        target = '/scan?goal=play' if launch == 'example' else '/scan'
        expect(workbench.locator('#studio-workbench-tab')).to_have_attribute('href', target)
        if launch == 'example':
            expect(scanner.locator('.world-goal-card[aria-pressed=true]')).to_contain_text('photo', ignore_case=True)
        # An unrelated sender cannot consume a token or dismiss the workbench.
        assert workbench.locator('iframe').evaluate('''frame => frame.dispatchEvent(new CustomEvent(
          'brainsnn-scan-capture', {cancelable:true, detail:{sender:document, hash:'#handoff=11111111-1111-1111-1111-111111111111'}}))''')
        expect(workbench).to_be_visible()
        scanner.locator('input[aria-label="Select phone video or photographs"]').set_input_files(str(media / fixture))
        scanner.get_by_role('button', name='Continue with this capture').click()
        expect(workbench).to_be_hidden(timeout=30000)
        expect(frame.locator('#status')).to_contain_text('Loaded 1 local capture', timeout=30000)
        expect(frame.locator('.source-row [data-source]').filter(has_text=fixture)).to_have_count(1)
        assert frame.locator('#workspace').evaluate("el => el.originalWorld === true")
        expect(frame.locator('#tab-capture')).to_have_attribute('aria-selected', 'true')
        assert len(context.pages) == 1
        assert not any('/world/index.html#handoff=' in f.url for f in page.frames)
        frame.locator('#tab-world').click()
        expect(frame.locator('#object-name')).to_have_value('Edited kitchen table')
    frame.locator('#site-resources > summary').click()
    frame.locator('#site-resources [href="/scan"]').click()
    scanner = frame.frame_locator('#studio-workbench-frame')
    scanner.locator('input[aria-label="Select phone video or photographs"]').set_input_files(str(media / 'showcase-poster.jpg'))
    scanner.get_by_role('link', name='Open without transfer').click()
    expect(frame.locator('#studio-workbench')).to_be_hidden()
    expect(frame.locator('#tab-capture')).to_have_attribute('aria-selected', 'true')
    expect(frame.locator('.source-row [data-source]')).to_have_count(2)
    assert frame.locator('#workspace').evaluate("el => el.originalWorld === true")
    assert len(context.pages) == 1
    # A batch that exceeds the remaining source slots leaves the original set untouched.
    image = (media / 'showcase-poster.jpg').read_bytes()
    def photos(count):
        return [{'name': f'photo-{i}.jpg', 'mimeType': 'image/jpeg', 'buffer': image} for i in range(count)]
    frame.locator('#files').set_input_files(photos(9))
    expect(frame.locator('.source-row [data-source]')).to_have_count(11)
    frame.locator('#site-resources [href="/scan"]').click()
    scanner.locator('input[aria-label="Select phone video or photographs"]').set_input_files(photos(2))
    scanner.get_by_role('button', name='Continue with this capture').click()
    expect(frame.locator('#status')).to_contain_text('limited to 12 sources')
    expect(frame.locator('.source-row [data-source]')).to_have_count(11)
    assert not any('/v1/uploads' in url or '/v1/jobs' in url or '/process' in url for url in posts), posts
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        for browser_name in os.environ.get("WORLD_BROWSERS", "chromium").split(","):
            browser = getattr(playwright, browser_name).launch(headless=True)
            check(browser)
            check_studio(browser)
            browser.close()
            print(browser_name + ": consented capture handoff passed")
