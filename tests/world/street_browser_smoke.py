"""Actual production HTTP assets -> native street workspace -> edits and exports.

No scene, renderer, navigation or download bytes are substituted. The authored
capture fixture tests browser-local handoff only, not physical reconstruction.
Run against the already-built Express service; this script starts no server.
"""
from pathlib import Path
import hashlib
import io
import json
import os
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright
from browser_smoke import open_world

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/playwright/world"
OUTPUT.mkdir(parents=True, exist_ok=True)
WORLD_URL = os.environ.get("WORLD_URL", "http://127.0.0.1:4180/")
ORIGIN = os.environ.get("WORLD_SITE_URL") or "{0.scheme}://{0.netloc}".format(urlsplit(WORLD_URL))
SHARE_URL = ORIGIN.rstrip("/") + "/world/index.html?nosw=1&sandbox=street&scene=green-gardens&tool=evidence#workspace"


def wait_street(page, *, visible=True):
    street = page.locator("#street-mount")
    expect(street.locator("#object-count")).to_have_text("272", timeout=45000)
    expect(street.locator("#scene-canvas canvas")).to_have_count(1)
    if visible:
        expect(page.locator("#workspace")).to_have_attribute("data-sandbox", "street")
        expect(page.locator("#street-workspace")).to_be_visible()
        expect(street.locator("#loading")).to_be_hidden()
    # The outer application may have its existing shell frame. The new native
    # workspace must not add a second nested document or duplicate canvases.
    expect(street.locator("iframe")).to_have_count(0)
    expect(street.locator(".street-surface")).to_have_count(1)
    return street


def receipt(page, view, *, name, errors, detail=None):
    """Keep DOM diagnostics with both successful and failing CI runs."""
    result = {"browser": name, "errors": errors, "detail": detail or {}}
    try:
        result["dom"] = page.evaluate("""() => {
          const host=document.getElementById('street-mount'), root=host?.shadowRoot;
          const viewport=root?.querySelector('#scene-canvas')?.getBoundingClientRect();
          return {url:location.href,workspace:document.getElementById('workspace')?.dataset.sandbox,
            status:document.getElementById('status')?.textContent,
            objects:root?.querySelector('#object-count')?.textContent,
            renderer:root?.querySelector('.street-surface')?.dataset.renderMode,
            canvases:root?.querySelectorAll('#scene-canvas canvas').length,
            width:viewport?.width,height:viewport?.height,
            route:root?.querySelector('#sim-status')?.textContent,
            parentTabs:[...document.querySelectorAll('.sandbox-tools [data-tab]')].map(b=>({tab:b.dataset.tab,selected:b.getAttribute('aria-selected')})),
            sources:document.getElementById('sandbox-source-count')?.textContent};
        }""")
        view.screenshot(path=str(OUTPUT / (name + ".png")), full_page=True)
    except Exception as error:
        result["diagnosticError"] = type(error).__name__
    (OUTPUT / (name + ".json")).write_text(json.dumps(result, indent=2))


def check_integrated(browser, mobile=False):
    name = "street-" + browser.browser_type.name + ("-phone" if mobile else "-desktop")
    context = browser.new_context(
        viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 1000},
        has_touch=mobile, device_scale_factor=1, accept_downloads=True,
    )
    view = context.new_page()
    errors, uploads = [], []
    view.on("pageerror", lambda error: errors.append(str(error)))
    context.on("request", lambda request: uploads.append(request.url) if request.method == "POST" and ("/api/world/" in request.url or "/v1/" in request.url) else None)
    page, detail = view, {}
    try:
        page = open_world(view, ORIGIN.rstrip("/") + "/", require_response=True)
        assert page is not view, "The street entry must work inside the existing home shell"
        page.locator("#hero-street").click()
        street = wait_street(page)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1")
        page.evaluate("window.__streetCanvasUnderTest = document.getElementById('street-mount').shadowRoot.querySelector('#scene-canvas canvas')")

        street.locator("#barrier-select").click()
        width = street.locator("#barrier-width")
        width.fill("3")
        width.press("Tab")
        expect(width).to_have_value("3.00")
        street.locator("#barrier-offset").click()
        expect(street.locator("#toast")).to_contain_text("Barrier moved")
        # The displayed dimensions and serialized scene must describe the same
        # accepted obstacle. No hidden simulation mutation is used by this test.
        detail["barrierWidthM"] = float(width.input_value())
        assert detail["barrierWidthM"] == 3
        expect(page.locator("#sandbox-scene-state")).to_contain_text("272 objects")

        page.locator(".sandbox-tools #tab-capture").click()
        expect(page.locator("#workspace")).to_have_attribute("data-sandbox", "capture")
        expect(page.locator("#street-workspace")).to_be_hidden()
        image = io.BytesIO()
        Image.new("RGB", (24, 24), (45, 90, 120)).save(image, format="PNG")
        page.locator("#files").set_input_files({"name": "street-handoff-fixture.png", "mimeType": "image/png", "buffer": image.getvalue()})
        expect(page.locator("#sandbox-source-count")).to_have_text("1 local source")
        expect(page.locator("#media-preview img")).to_have_count(1)
        page.locator("#sandbox-return").click()
        street = wait_street(page)
        assert page.evaluate("window.__streetCanvasUnderTest === document.getElementById('street-mount').shadowRoot.querySelector('#scene-canvas canvas')"), "Capture return remounted the editor"
        assert float(street.locator("#barrier-width").input_value()) == 3
        expect(page.locator("#sandbox-source-count")).to_have_text("1 local source")
        # Internal navigation keeps the parent toolbar current.
        if mobile:
            street.locator("#mobile-objects").click()
        street.locator("#tab-evidence").click()
        expect(page.locator(".sandbox-tools #tab-understand")).to_have_attribute("aria-selected", "true")
        street.locator("#export-open").click()
        expect(page.locator(".sandbox-tools #tab-evidence")).to_have_attribute("aria-selected", "true")
        with view.expect_download(timeout=30000) as event:
            street.locator("#export-json").click()
        export = OUTPUT / (name + "-edited.json")
        event.value.save_as(export)
        data = json.loads(export.read_text())
        assert len(data["objects"]) == 272
        barrier = next(obj for obj in data["objects"] if obj["id"] == data["barrier"]["id"])
        assert barrier["geometry"]["dimensions"][0] == 3
        assert data["editor"]["edits"][barrier["id"]]["geometry"]["dimensions"][0] == 3
        assert data["runtime"]["mode"] == "kinematic-navigation"
        assert data["runtime"]["physicalSimulationValidated"] is False
        expect(street.locator("#prepared-download")).to_be_visible()
        assert street.locator("#prepared-download").get_attribute("href").startswith("blob:")
        detail["exportSHA256"] = hashlib.sha256(export.read_bytes()).hexdigest()
        detail["editedBarrier"] = barrier["transform"]
        street.locator("#export-close").click()
        expect(page.locator(".sandbox-tools #tab-understand")).to_have_attribute("aria-selected", "true")
        assert not uploads, "Local editing and capture handoff sent an unexpected upload"
        assert not errors, errors
        receipt(page, view, name=name, errors=errors, detail=detail)
    except BaseException:
        receipt(page, view, name=name + "-failed", errors=errors, detail=detail)
        raise
    finally:
        context.close()
    print(name + ": actual template, 272 objects, edits, capture return, tool sync and JSON export passed", flush=True)


def check_pending_switch_and_link(browser):
    name = "street-" + browser.browser_type.name + "-switches"
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    view = context.new_page()
    errors = []
    view.on("pageerror", lambda error: errors.append(str(error)))
    page = view
    try:
        page = open_world(view, ORIGIN.rstrip("/") + "/", require_response=True)
        # Synchronous DOM events deliberately finish on Capture before the lazy
        # renderer import can resolve. They use the real product event handlers.
        page.evaluate("""() => {
          const select=document.getElementById('sandbox-scene');
          select.value='street';select.dispatchEvent(new Event('change',{bubbles:true}));
          document.getElementById('tab-capture').click();
          select.value='map';select.dispatchEvent(new Event('change',{bubbles:true}));
          select.value='street';select.dispatchEvent(new Event('change',{bubbles:true}));
          document.getElementById('tab-capture').click();
        }""")
        expect(page.locator("#workspace")).to_have_attribute("data-sandbox", "capture")
        wait_street(page, visible=False)
        expect(page.locator("#workspace")).to_have_attribute("data-sandbox", "capture")
        expect(page.locator("#street-workspace")).to_be_hidden()
        page.locator("#sandbox-return").click()
        wait_street(page)
        page.locator("#sandbox-scene").select_option("map")
        expect(page.locator("#map-workspace")).to_be_visible()
        expect(page.locator("#street-workspace")).to_be_hidden()
        page.locator("#sandbox-scene").select_option("street")
        wait_street(page)
        assert not errors, errors
        receipt(page, view, name=name, errors=errors)
        # A clean document deep link opens its requested scene and Evidence
        # tool. It must not rely on prior local edits or a hidden global object.
        page = open_world(view, SHARE_URL, require_response=True)
        street = wait_street(page)
        expect(page.locator(".sandbox-tools #tab-understand")).to_have_attribute("aria-selected", "true")
        expect(street.locator("#evidence-content")).to_be_visible()
        assert street.locator("#evidence-content img").count() == 0, "Private reference thumbnails must not be published"
        assert not errors, errors
    except BaseException:
        receipt(page, view, name=name + "-failed", errors=errors)
        raise
    finally:
        context.close()
    print(name + ": lazy-load races, scene switching and native scene deep link passed", flush=True)


if __name__ == "__main__":
    with sync_playwright() as playwright:
        for browser_name in os.environ.get("WORLD_BROWSERS", "chromium").split(","):
            executable = os.environ.get("PLAYWRIGHT_" + browser_name.upper() + "_PATH")
            browser = getattr(playwright, browser_name).launch(headless=True, **({"executable_path": executable} if executable else {}))
            try:
                check_integrated(browser, False)
                check_integrated(browser, True)
                check_pending_switch_and_link(browser)
            finally:
                browser.close()
