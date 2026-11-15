# Local appearance camera studio

Open https://www.brainsnn.com/world/splat.html. Load an owned local PLY, SPLAT or self-contained GLB, choose its declared origin, save two or more views, preview the move, then record. The original asset is never rewritten or sent to a provider. This is an appearance presentation tool, separate from the compiler, BIM measurements, floor fitting, occupancy and robot planner.

## What ships

- At most 32 keyframes and 60 seconds, with 0.5 to 15 seconds between saved views.
- JSON path import/export bound to exact source SHA-256, name, byte count, placement and display orientation. Load the matching asset before reopening its path. A change of asset, axis or declared origin clears the current path.
- Linear eye/target/FOV interpolation, with a full-segment analytic rejection if the look vector approaches zero. This prevents a camera orientation singularity; it does not test path collisions. Add an intermediate view when opposing camera directions are rejected.
- Local MP4 or WebM recording, selected from the browser's actual encoder support. The 1280 by 720 output letterboxes the real preview and permanently labels declared origin, scale and source hash. A separate receipt includes the video hash, dimensions, requested path duration, elapsed recording time and rendered frame count.
- Cancellation on asset reset, hidden tab, graphics context loss, resize and Stop. No partial recording is downloaded. The recorder caps output at 64 MiB and releases stream tracks and listeners on failure.

Recording uses real time. Encoder frame rate and container duration are not certified by the product receipt. Browser regression tests separately probe the emitted container with FFprobe. A source hash establishes file identity, not the truth of its declared origin or scale. Origin defaults to unknown; choosing “camera reconstruction” is a user declaration.

## Coordinate contract

Path cameras are camera-to-world, right-handed Y-up with RUB local axes, forward local -Z and quaternion order XYZW. FOV is vertical degrees. Eye and target use arbitrary displayed-asset units, never verified metres.

PLY/SPLAT retain their source coordinates. GLB display translates the imported bounding-box minimum to the origin. The exported `sourceTranslation` records that exact translation before the optional 180-degree X rotation (`flip-y-z`). Displayed positions are `R * (sourcePosition + sourceTranslation)`. Display placement does not alter original source bytes. Path imports require matching placement and orientation. Canvas aspect and displayed material/point settings affect presentation; video receipts record them, and paths do not promise pixel-identical rendering on another device.

## Reference and implementation choice

The [linked post](https://www.linkedin.com/posts/matthieulorrain_what-if-a-single-image-could-become-a-ugcPost-7527357936172556288-JoTY/) demonstrates World Labs Atlas/Viewfinder. Its [official workflow](https://docs.atlas.worldlabs.ai/using-video-footage) uses extracted still images and can invent uncaptured areas. [Camera documentation](https://docs.atlas.worldlabs.ai/cameras-and-posed-images) describes explicit camera frames and scale calibration. We adopted a useful local presentation workflow, with independently implemented camera paths and the existing first-party renderer. No Atlas output, model, credentials or generation call was used.

Atlas generation remains unconnected. Its [November 10 terms](https://docs.atlas.worldlabs.ai/terms-of-service) restrict competitive replication/benchmarking using the service or outputs and distinguish output rights by access tier. Confirm applicable terms for a proposed provider integration before implementing it. Local studio execution has no provider fee.

The existing Gaussian preview samples up to 100,000 points and renders DC colour without higher-order view-dependent shading. It is not equivalent to Atlas generation or a full Spark renderer. SPZ/KSPLAT remain unsupported: export uncompressed PLY/SPLAT first. [Spark](https://github.com/sparkjsdev/spark) and [Niantic SPZ](https://github.com/nianticlabs/spz) are separate MIT-licensed future candidates, not dependencies added by this release.

## Validation and remaining work

Run the contracts with `cd brainsnn-r3f-app && npm run test:world`. Run the actual renderer/encoding checks against a running server with `WORLD_URL=http://127.0.0.1:4180/world/index.html node tests/world/visual-browser-smoke.mjs` from the repository root. Install the matching Playwright Chromium/WebKit and FFmpeg first. The normal World Builder CI executes both desktop and phone-sized flows. Browser fixtures are explicitly authored, not real reconstructed or physical-reference evidence.

Target-device performance, actual iPhone recording, independent metric/survey accuracy and physical robot validation remain separate unexecuted qualifications for this layer. A camera move can pass through a wall. A generated visual surface cannot become measured BIM or a collision map through this studio.

Highest-impact next experiment: load the corrected reference-capture asset and its existing independent-measurement report, save a 10-second path through observed viewpoints, record on an actual iPhone and desktop, and compare source/video receipts and the unchanged IFC/route exports. Success means both recordings play, all labels remain readable, source and existing export hashes are unchanged, and no path is presented as a physical robot trial. Estimated effort: half a developer day; provider cost: $0; main blocker: access to the intended phone and corrected capture bundle. Metric validation still requires held-out independently measured dimensions and its own acceptance criteria.
