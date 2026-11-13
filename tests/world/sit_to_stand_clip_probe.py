"""Opt-in probe of the production browser tracker on a local, single-person clip.

Start the built site and run:
  WORLD_SITE_URL=http://127.0.0.1:4180 python tests/world/sit_to_stand_clip_probe.py trial.mp4
The browser reads a local file object. No clip is sent to the website. JSON is
printed to stdout. Use --seconds to limit long clips, and --sha256 to bind a
published example to its exact bytes. Requires Python Playwright and the selected browser.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clip", type=Path)
    parser.add_argument("--browser", choices=("chromium", "webkit"), default="chromium")
    parser.add_argument("--sha256")
    parser.add_argument("--seconds", type=float, default=60.0)
    args = parser.parse_args()
    if not 0 < args.seconds <= 60:
        parser.error("Use a positive interval of at most 60 seconds.")
    with args.clip.open("rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    if args.sha256 and args.sha256.lower() != digest:
        parser.error("The supplied video does not match --sha256.")
    base = os.getenv("WORLD_SITE_URL", "http://127.0.0.1:4180").rstrip("/")
    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(
            executable_path=os.getenv(f"PLAYWRIGHT_{args.browser.upper()}_PATH"))
        try:
            page = browser.new_page()
            # Serve an empty local probe shell under the application's origin. Only
            # static runtime/model requests are permitted during the actual probe.
            page.route("**/world/local-clip-probe.html", lambda route: route.fulfill(
                status=200, content_type="text/html", body='<input type="file" id="clip">'))
            page.goto(base + "/world/local-clip-probe.html")
            page.route("**/*", lambda route: route.continue_() if (
                route.request.method == "GET"
                and route.request.url.startswith((base + "/world/", "blob:" + base + "/"))
            ) else route.abort())
            page.locator("#clip").set_input_files(args.clip)
            traces = page.evaluate("""async maxSeconds => {
              const {trackSitToStand} = await import('/world/sit-to-stand-pose.mjs');
              const {kneeFlexion} = await import('/world/movement-analysis.mjs');
              const {analyzeSitToStand} = await import('/world/movement-trial.mjs');
              const file = document.querySelector('#clip').files[0];
              const url = URL.createObjectURL(file);
              const video = document.createElement('video');
              try {
                await new Promise((resolve,reject) => {
                  video.onloadedmetadata=resolve; video.onerror=()=>reject(Error('Cannot decode the supplied clip.'));
                  video.preload='metadata'; video.src=url;
                });
                const {videoWidth:width,videoHeight:height,duration} = video;
                const sides=[];
                for (const side of ['left','right']) {
                  const trace=await trackSitToStand(url,{side,startSeconds:0,endSeconds:Math.min(duration,maxSeconds)});
                  const frames=trace.frames.map(f=>({timeSeconds:f.timeSeconds,
                    confidence:f.confidence ?? 0, kneeFlexionDegrees:f.landmarks ? kneeFlexion(f.landmarks,width,height) : null}));
                  sides.push({side, model:trace.model, threshold:trace.threshold, sampleHz:trace.sampleHz,
                    detected:frames.filter(f=>f.kneeFlexionDegrees!==null).length, frameCount:frames.length,
                    analysis:analyzeSitToStand(frames)});
                }
                return {duration,width,height,sides};
              } finally {
                video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
              }
            }""", args.seconds)
            print(json.dumps({"sourceSha256": digest, "browser": args.browser, **traces}, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
