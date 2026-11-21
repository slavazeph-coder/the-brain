# One World Builder workspace

The primary playground follows the owner's v23 demonstration: bring a capture,
explore the results, inspect the model and drawings, try robot routes, and save
the work. The existing controls form that journey; the model review opens inside
the same workspace. Every tool is one step away in the studio bar; separate tool
pages open beside the world in the workbench. All tools remains as the catalogue.

## The studio bar and workbench

Under the hero, one sticky studio bar reaches every tool: **Your world**, six
chapters (Robots, Captures, 3D scenes, Buildings, Movement, Save & share) and
**Find a tool**. The list is `showcase-features.mjs`, the same registry the
showcase uses, so a tool added there appears in both. A chapter opens a panel of
its tools with plain access notes (example, preview, needs setup, ready) and
where each one opens.

- In-page tools (tabs, layer tools, sections, Project Review, processing
  settings) open through the showcase's own navigator. Fields are centred so
  their labels stay visible below the bar.
- Separate tool pages (`/world/*.html` and the Arena) open in the **workbench**,
  a same-origin frame above the workspace. The map, its edits, running jobs and
  retained results stay in place. World pages hide their duplicate site header
  (marked `data-studio-hidden="site-header"`); the Arena keeps its own section
  navigation. Links back to the playground close the workbench; links that leave
  World Builder open a new tab. "Open in its own tab" is always offered, and a
  modified click on a showcase card still opens a tab.
- Closing the workbench unloads the page (`about:blank`) so its media, workers
  and animation loops stop, then returns focus to the control that opened it.

`studio.mjs` and `studio.css` are part of the offline shell. Checks:
`tests/world/studio.test.mjs` (registry coverage, safe workbench targets,
search, markup order, 13 px floor) and `tests/world/studio_browser_smoke.py`
(every chapter, search, in-page tools, workbench pages, retained map edit,
390/320 px and larger text).

## Sources and results

`workspace-results.mjs` keeps the latest 12 completed job contexts in page memory.
Each contains an immutable manifest, the original WorkerClient, and its input
source IDs and names. Credentials and private URLs never enter the UI snapshot
or a project export. Removing a source or switching workers does not make an old
job belong to the new client. Download tickets still come from the original
worker, which can refuse expired or revoked access.

The shared source library opens original media, reconstructed points, models and
downloads. Selecting an older result preserves that revision while moving among
its views. A selected job's actual point artifact takes precedence over a local
photo-depth preview. Opening an artifact explicitly does not replace the planning
map; the existing proposal and scene-to-map controls remain the deliberate
handoff. Automatic completed-job proposal behavior is unchanged.

Starting a job records its source selection and view revision. Completion is
retained even if the person has moved elsewhere; it does not take over a newer
source or view. Point, observation and model previews cancel previous pending
previews. Clear session and final page teardown discard private job contexts.
This is tab-session continuity, not account storage or durable API ownership.

## Model and drawing review

`scene-workspace.mjs` docks the original scene dialog inside the playground and
opens it nonmodally. All existing scene controls, source checks, facility review,
IFC tools, exports and explicit route handoff remain. Closing disposes hidden
viewers and pending review requests. Opening drafts are retained separately for
up to 12 exact client/job/scene/cloud/revision combinations; a new revision never
inherits another model's draft. Session clear removes those drafts.

The drawing exporter emits a PDF, sheet metadata and bounded drawing primitives
from the same operations. The in-place drawing viewer checks the exact scene,
cloud, component revision and PDF binding before displaying its sheets. Pending
opening edits invalidate the drawing preview until recompilation. Old jobs
without drawing files remain usable and explain what is unavailable. See
[the drawing contract](world-drawing-set.md).

The video is a reference for the experience, not a new reconstruction input.
No private showroom media or rendered simulation assets are published by this
change. User-entered scale, inferred geometry, drawings for review and simulated
robot routes retain their existing distinctions.

## Release and verification

The website and private processing worker deploy separately. Publish the
compatible website first, then the focused drawing-export worker update without
changing its adapter profile, credentials, storage or model settings. A new
completed scene job is required to obtain drawing artifacts; old jobs are not
rewritten.

`tests/world/unified_workspace_browser_smoke.py` uses actual loopback HTTP uploads,
jobs and checked downloads with explicitly authored geometry. It verifies
source/result selection, delayed preview isolation, retained old PDFs, native
sheet preview, model/map continuity, opening drafts and 320/390 px layouts in
Chromium and WebKit. It does not claim learned reconstruction or physical robot
qualification. Existing room, street, capture, model and offline checks remain
in the release pipeline.
