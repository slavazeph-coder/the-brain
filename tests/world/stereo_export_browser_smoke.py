"""Open an independently authored StereoSplat-format export in the real playground."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
from threading import Thread

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def make_export(dest):
    fields = "x y z nx ny nz f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3".split()
    rows = [(x/20, y/20, 2, 0,0,0, 1,.1,-1, 3,-3,-3,-3, 1,0,0,0)
            for x in range(-12,13) for y in range(-6,7)]
    with (dest/"gaussians.ply").open("wb") as out:
        header = ["ply","format binary_little_endian 1.0",f"element vertex {len(rows)}",
                  *["property float "+key for key in fields],"end_header",""]
        out.write("\n".join(header).encode())
        for row in rows:
            out.write(struct.pack("<17f",*row))
    matrices = [[[1,0,0,x],[0,1,0,0],[0,0,1,0],[0,0,0,1]] for x in [0,-.3]]
    (dest/"cameras.json").write_text(json.dumps({
        "convention":"OpenCV axes; world = first input left camera; meters","image_size":[180,320],
        "intrinsics":[[210,0,157],[0,219,87],[0,0,1]],"world_to_camera":matrices}))
    Image.new("RGB",(320,180),(37,92,181)).save(dest/"render_depth_001.png")


def check_browser(pw, name, origin, dest):
    browser = getattr(pw, name).launch()
    page = browser.new_page(viewport={"width": 1100, "height": 850}, reduced_motion="reduce")
    errors, writes = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda req: writes.append(req.method) if req.method not in {"GET","HEAD","OPTIONS"} else None)
    page.goto(origin+"/world/index.html?nosw=1#layer-tab-stereo", wait_until="domcontentloaded")
    expect(page.locator("[data-layer-tab=stereo]")).to_have_attribute("aria-selected","true")
    root = page.locator("[data-stereosplat-import]")
    root.get_by_text("Open a StereoSplat export",exact=True).click()
    picker, view = root.locator("[data-stx-files]"), root.locator("[data-stx-view]")
    inputs = [dest/i for i in ["gaussians.ply","cameras.json","render_depth_001.png"]]
    picker.set_input_files([str(p) for p in inputs])
    root.get_by_role("button",name="Open export",exact=True).click()
    expect(root.locator("[data-stx-status]")).to_contain_text("2 render camera views")
    root.get_by_role("button",name="Turn left").click()
    view.select_option("camera-0")
    canvas = root.locator("[data-stx-projection]")
    # Two different camera centers must shift the rendered point projection.
    def projection_center():
        return canvas.evaluate("""e => {
          const {data} = e.getContext('2d').getImageData(0,0,e.width,e.height);
          let sum = 0, n = 0;
          for(let i=0; i<data.length; i+=4) if(data[i]>100) {sum += (i/4)%e.width; n++;}
          return n ? sum/n : null;
        }""")
    x0 = projection_center()
    view.select_option("camera-1")
    expect(root.locator("[data-stx-description]")).to_contain_text("0.300, 0.000, 0.000")
    x1 = projection_center()
    assert x0 and x1 and abs((x0-x1)-31.5)<1, (x0,x1)
    view.select_option("image-0")
    expect(root.locator("[data-stx-description]")).to_contain_text("Depth colours")
    page.locator('#playground-text-size').click()
    expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
    for width in [390,320]:
        page.set_viewport_size({"width":width,"height":850})
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        assert root.evaluate("e=>e.scrollWidth<=Math.ceil(e.getBoundingClientRect().width)+1")
    root.get_by_role("button",name="Clear export").click()
    expect(root.locator("[data-stx-result]")).to_be_hidden()
    # PLY-only output is the upstream CPU --no-render contract.
    picker.set_input_files(str(inputs[0]))
    root.get_by_role("button",name="Open export",exact=True).click()
    expect(root.locator("[data-stx-status]")).to_contain_text("0 render camera views")
    assert not errors and not writes, (errors,writes)
    browser.close()
    print(f"{name} passed Gaussian review, calibrated projection, colour map, PLY-only import and phone layout",flush=True)


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--origin")
    origin = args.parse_args().origin
    server = None
    if not origin:
        class Handler(SimpleHTTPRequestHandler):
            def log_message(self,*args):
                pass
        class Server(ThreadingHTTPServer):
            request_queue_size = 128
        server = Server(("127.0.0.1",0),partial(Handler,directory=str(ROOT/"brainsnn-r3f-app/public")))
        Thread(target=server.serve_forever,daemon=True).start()
        origin=f"http://127.0.0.1:{server.server_port}"
    try:
        with TemporaryDirectory() as directory, sync_playwright() as pw:
            dest=Path(directory)
            make_export(dest)
            for name in ["chromium","webkit"]:
                check_browser(pw,name,origin,dest)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__=="__main__":
    main()
