# World Builder demo recorders

These scripts record the product demos on the real site against a real worker: nothing on screen is mocked.
They are reference tools, not part of CI.

| Script | What it records |
|---|---|
| `record_scan2model.py` | Scan to model, about 2 minutes at 1920 × 1080: phone walkthrough → dense CPU reconstruction → measured distance → scene compile with separated (and, if offered, Claude-named) objects → robot route in the compiled scene → `scene.ifc` opened in a web-ifc viewer |
| `record_demo.py` | The earlier photo → depth → map demo. It also holds the caption, cursor and title-card overlay (`OVERLAY`) that `record_scan2model.py` reuses |
| `feed_cut.sh` | A 4:5 feed version (1080 × 1350) of a 16:9 recording, with a title band and footer |
| `short_cut.sh` | A short 4:5 feed clip from chosen moments of a recording (hard cuts), with your own subtitle and footer |
| `ifc-viewer/` | The small web-ifc page used for the BIM step. It is not part of brainsnn.com |

## Running the scan-to-model recording

1. **A worker.** Start a worker with `colmap-dense-cpu` and `scene-usd` (see `robotics/world_worker/README.md` and
   `adapters.example.json`). For object names, set `ANTHROPIC_API_KEY` in the worker's environment and install
   `requirements-naming.txt`. The live site only talks to an HTTPS worker; a worker on `127.0.0.1` works from a local
   headless browser.
2. **The IFC viewer.** Put `three.module.js`, `three.core.js` and `OrbitControls.js` from `three@0.180.0`, plus
   `web-ifc-api.js` and `web-ifc.wasm` from `web-ifc@0.0.77`, in `ifc-viewer/vendor/`. Then serve the folder, for
   example `python3 -m http.server 4190`.
3. **Record.**
   ```sh
   WORKER_URL=http://127.0.0.1:8040 WORKER_TOKEN=... ENGINE=colmap-dense-cpu \
     python scripts/world-demo/record_scan2model.py https://www.brainsnn.com/world/index.html walkthrough.mp4 \
     http://127.0.0.1:4190/ out/scan-to-model.mp4            # add --dry-run to check every step without recording
   sh scripts/world-demo/feed_cut.sh out/scan-to-model.mp4 out/scan-to-model-4x5.mp4
   ```
4. **A short clip.** The recorder ends by printing where each caption lands in the output video. Pick the moments
   from that list and pass them as `start+seconds`:
   ```sh
   sh scripts/world-demo/short_cut.sh out/scan-to-model.mp4 out/short.mp4 'subtitle' 'footer' 4.2+2 30+3.5 ...
   ```

`ENGINE` sets the captions as well as the engine: `colmap-sparse` and `colmap-dense-cpu` each describe their own points.
Naming captions appear only when the worker offers naming. `feed_cut.sh` says "A real run on brainsnn.com", so use it
only for a recording made on the live site.

The worker URL and token are typed under a title card, and an init script blurs the worker host wherever the page
shows it, so neither appears in the video. Never commit a recording's proof JSON: it contains the worker URL.

## Honesty rules the recordings follow

- **Only real numbers.** Every number on screen comes from the run itself.
- **Typed distances are labelled.** A distance typed for the demo (the test captures were not measured) is said to be
  typed on the closing card.
- **Speed-ups are captioned.** Sped-up segments say so ("sped up 60×"). Frames during a layout jump under full CPU
  load are cut, not sped.
- **Test captures are named.** The Mip-NeRF 360 "room" walkthrough is credited (Barron et al.) as a test capture.
- **Suggestions are not results.** Model names are shown as suggestions, not reviewed.

## Recording lessons

- **Captions inside dialogs.** The scene `<dialog>` is in the top layer, so the captions and cursor move inside it
  while it is open.
- **Wait in place under CPU load.** When a co-located COLMAP worker saturates the CPU, CDP screencast frames show
  stale tiles. Wait with the view already on the workspace, and cut the frames around the layout jump.
- **Captions ignore the pointer.** Captions need `pointer-events:none`, or orbit drags select their text.
- **Use an implied phone height near 1.3–1.6 m.** On the Mip-NeRF room, a typed scale of 0.66 m per unit keeps
  walls inside the 1.3–2.3 m band the wall finder uses; 0.41 drops them below it.
