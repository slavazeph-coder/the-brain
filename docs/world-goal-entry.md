# World Builder: goal-led entry on the existing BrainSNN site

Date: 2026-10-28. Scope: UX entry only, not a new reconstruction engine or public API.

## Current routes preserved

- `/` renders the standalone `public/world/index.html` World Builder in an iframe from React `WorldHome`.
- `/scan` is the React capture preparation page. Selected files are previewed locally; media must be selected again in World Builder before explicit worker upload.
- `/world/index.html` remains the advanced geometry, scale, evidence, and robot planning workspace.
- `/arena/` retains robot simulation/practice; `/world/api.html` documents the private operator-worker API.

## This PR

Adds a single goal chooser near the top of the existing landing and the same four states in Capture Studio:

| Goal | Supported first experience | Not claimed |
|---|---|---|
| Explore a photo | Local image preview; optional on-device depth preview in World Builder | Measured 3D, hidden surfaces, autonomous child account |
| Plan my room | Private video preview and recording guidance | Verified furniture fit or accurate room measurements |
| Make a building model | Prepared video for connected-worker IFC/Rhino workflow | One-click certified BIM, general public hosted processing |
| Test a robot route | Capture to reviewed map and planning preview | Physical robot clearance certification or policy execution |

Use `/scan?goal=play|room|bim|robot`. Legacy `/scan?use=robotics`, `?use=architecture`, etc., still select the corresponding goal. On the capture page the user can choose larger instructions or hear the guide using browser speech synthesis. No age or accessibility diagnosis is collected. Advanced industry metadata lives under an optional disclosure. The colour scheme, CSS tokens, existing uploader, worker permissions and engine contracts are unchanged.

For children, provide adult-assisted usage language; no child accounts, uploads or public sharing are introduced. For older adults, use concrete task names, large tap targets, captions/visible text and optional enlarged instructions. These are implementation accommodations, not an audited WCAG 2.2 AA certification.

## Implemented: consented capture handoff and honest recovery

- `/scan` now provides an explicit **Continue with this capture** action. It stages the original `File` objects in same-origin IndexedDB, with a random identifier in the URL fragment. Neither the URL nor the React app sends media to a worker. Opening `/world/index.html#handoff=<id>` reads the files locally, validates them through the existing World Builder file handler, deletes the temporary handoff on success, and removes the token from browser history.
- Handoffs expire after 20 minutes. Expired records are deleted on lookup or the next staging operation, not by a background timer. If browser quota, IndexedDB or iOS file serialization fails, Capture Studio offers a visible fallback to open World Builder and select the original file again. Files up to 2 GiB remain subject to browser storage limits.
- The worker's separate upload-consent checkbox is unchanged. The handoff stores neither worker tokens nor a new server-side user account. No automatic upload, payment or public signup is introduced.
- World Builder reads the existing reconstruction receipt (sampled frame count, registered frames, fold warning and disconnected model count). When alignment is incomplete it shows counts and a recapture checklist. Frame registration is **not** area coverage or metric accuracy; the screen does not upgrade unscaled geometry to verified BIM or free-space evidence. A useful fallback is to use original photos for an illustrative, unmeasured on-device preview.
- Node contracts cover the handoff's validation, expiry, goal routing, partial-registration and folded-scene language. A Playwright browser smoke test exercises the real same-origin IndexedDB transition, source import, deletion and absence of worker upload requests.

The optional stored copy is removed after successful import; abandoned copies are pruned when a visitor revisits the handoff after expiration. Browser extensions, site storage policies and device backups are outside this feature's control. A private browser may refuse large transfers.

## The narrow product MVP to build next

**First production-worthy path: take one room video, know what is missing, make one useful decision.** The same-origin handoff is now implemented; usability and large-iPhone-file testing remain release gates. Capture progress and incomplete coverage should have a plain-language recovery step. When the clip registers only part of its frames (as in the earlier 52/140 frame example), fall back to original photos and a clearly partial preview instead of pretending the reconstruction is complete.

On an explicitly connected worker, add a reviewed dimension flow: one scale anchor, three independently withheld checks, source-bound objects, visible unknown regions, and explicit accepted/provisional status. Only after validation should BIM/IFC/Rhino and robot clearances appear as supported outcomes. Preserve expert workspace details behind progressive disclosure.

The public v1 API should build on the existing resumable worker endpoints; do not advertise a new `/api/v1/scan` route until implemented, authenticated, cost-limited and documented. Public child uploads require a separate privacy and consent design.

## Verification

Node tests cover goal routing, local handoff validation, partial-capture recovery and copy boundaries. Production build/lint and desktop/mobile Playwright smoke run in GitHub Actions. Keyboard navigation, VoiceOver/TalkBack, spoken guidance and actual iPhone picker remain device QA gates. Do not claim WCAG certification or a public worker without those tests.
