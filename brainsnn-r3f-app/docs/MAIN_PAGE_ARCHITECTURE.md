# BrainSNN Main Page — Architecture

> Audience: maintainers of `brainsnn-r3f-app`.
> Last updated: 2026-05-28 (post main-page redesign).

## Context & goals

The main page (`src/App.jsx`) had grown to **~50 feature panels stacked in one
infinite-scroll column** — every "layer" rendered top to bottom with no
navigation. Two problems: (1) the core value prop (paste content → see the brain
react) was buried ~8 panels down, and (2) the page was an undifferentiated wall.

The redesign keeps **all panels and their behavior unchanged** while adding:

1. A **persistent hero** (`ScanHero`) that leads with an LLM-powered scan.
2. A **sticky `SectionNav`** that chunks the panels into 8 navigable sections.
3. A **swappable backend LLM** (`analyzeForBrain`) behind the hero — Crumb LLM
   → Gemini → Gemma → local regex, chosen at one seam.

Hard constraint: this is **live on brainsnn.com (Railway)**. The redesign had to
be zero-risk to the existing 50 panels, the R3F WebGL canvas, and live
subscriptions (LiveSync, MCP bridge).

## High-level layout

```
<main class="app-layout">
  <section class="main-column">          ← left column (everything below)
    ┌─ PERSISTENT (always visible) ───────────────────────┐
    │  ControlsBar      (brand, run/scenario controls)     │
    │  ScanHero         (paste → backend LLM → brain)  ★    │
    │  DemoTiles        (preset sample scans)              │
    │  viewer-panel     (3D BrainScene + overlay chips)    │
    │  lower-grid       (metrics + selected-region note)   │
    └──────────────────────────────────────────────────────┘
    SectionNav          (sticky tabs + Labs links)     ★
    ┌─ ONE VISIBLE AT A TIME (hidden-toggled) ────────────┐
    │ <div class="app-section" hidden={active!=='insights'}> … </div>
    │ <div class="app-section" hidden={active!=='firewall'}> … </div>
    │ … knowledge · defense · tools · studio · neuro · io  │
    └──────────────────────────────────────────────────────┘
  </section>
  <InspectorPanel />                     ← right rail (unchanged)
</main>
```

★ = added in the redesign. New files: `components/ScanHero.jsx`,
`components/SectionNav.jsx`, `utils/brainLLM.js`.

## The section pattern (and why)

Sections are plain `<div className="app-section" hidden={activeSection !== "x">`
wrappers around contiguous runs of the existing panels. `SectionNav` flips a
single `activeSection` state value.

**Key decision: toggle visibility, not mounting.** Inactive sections are
`hidden` (CSS `display:none`) but **stay mounted**.

|                             | Visibility toggle (chosen) | Conditional unmount  |
| --------------------------- | -------------------------- | -------------------- |
| Panel state on tab switch   | preserved                  | lost                 |
| R3F WebGL canvas            | never re-inits             | re-inits (expensive) |
| Live sockets (LiveSync/MCP) | stay connected             | tear down/reconnect  |
| DOM weight                  | all panels in DOM          | lighter DOM          |

Since all 50 panels were already always-mounted before the redesign, this
introduces **no behavior or performance regression** — it only adds a visibility
gate. That's why it was safe to ship to a live site.

CSS: `.app-section { display:flex; flex-direction:column; gap:18px }` and
`.app-section[hidden]{ display:none }` (see `styles/global.css`). The explicit
`[hidden]` rule matters — a `display:flex` declaration would otherwise override
the native `hidden` attribute.

The 8 section ids: `insights · firewall · knowledge · defense · tools · studio ·
neuro · io`. They are defined inline where `<SectionNav>` is rendered in
`App.jsx` and must match the `hidden={activeSection !== "<id>"}` guards.

## The swappable LLM backend

All scan analysis goes through **one entry point**: `analyzeForBrain(text)` in
`utils/brainLLM.js`. Call sites (`ScanHero`) never know which backend ran.

```
analyzeForBrain(text)
  │
  ├─ VITE_CRUMB_LLM_URL set?
  │     ├─ Lobster Trap pre-screen (block injection/secrets, redact PII)
  │     ├─ POST {text} → ${URL}/analyze   (12s AbortController timeout)
  │     └─ on throw / !ok / timeout ↓ fall through
  │
  └─ scoreContentSmart(text)              (utils/cognitiveFirewall.js)
        ├─ Lobster Trap pre-screen
        ├─ VITE_GEMINI_API_KEY  → analyzeContentWithGemini
        ├─ VITE_GEMMA_API_KEY   → analyzeContentWithGemma
        └─ regex Cognitive Firewall       (always available, zero config)
```

Every backend returns the **same canonical score shape**, normalized by
`normalize()`:

```js
{ emotionalActivation, cognitiveSuppression, manipulationPressure,
  trustErosion, evidence[], reasoning, confidence, recommendedAction, source }
```

`analyzeForBrain` **never throws** — it always resolves to a score (worst case,
local regex), so the UI degrades gracefully and the brain always updates.

### Data flow: scan → brain

```
ScanHero.run()
  → analyzeForBrain(content)            // backend dispatch above
  → onResult(score, content)            // prop from App.jsx
      → setFirewallResult(score)
      → setState(s => mapTRIBEToRegions(s, score))   // utils/cognitiveFirewall.js
      → recordImmunity(FIREWALL_SCAN, …)
  → BrainScene re-renders from new region activations
```

`mapTRIBEToRegions` is the shared mapping the Firewall/Gemma/Gemini panels also
use, so the hero is consistent with the rest of the app.

### Security notes

- **`VITE_*` are public.** They are inlined into the client bundle. Do **not**
  put a privileged/billable token in `VITE_CRUMB_LLM_KEY` — it ships in page
  source. For a real GPU endpoint, proxy through the BrainSNN server so the key
  never reaches the browser.
- The Crumb LLM path runs the **same Lobster Trap pre-screen** as the remote
  Gemini/Gemma paths (injection/secret block + PII redaction) before any content
  leaves the browser. Keep it that way if you add another remote backend.
- All LLM-returned text is rendered as **JSX children** (escaped), never
  `innerHTML`. Preserve this — backends are untrusted output.

## How-to

### Add a new section

1. Add `{ id: "myseg", label: "My Section" }` to the `sections={[…]}` array
   passed to `<SectionNav>` in `App.jsx`.
2. Wrap the panel(s) in `App.jsx`:
   ```jsx
   <div className="app-section" hidden={activeSection !== "myseg"}>
     {/* existing <ErrorBoundary><XPanel/></ErrorBoundary> blocks */}
   </div>
   ```
3. The id in step 1 must exactly match the `hidden` guard in step 2.

### Swap / add the LLM backend

- **Activate Crumb LLM:** set `VITE_CRUMB_LLM_URL` (and optionally a
  non-privileged `VITE_CRUMB_LLM_KEY`) on the Railway service. The endpoint must
  accept `POST /analyze {text}` and return the canonical score shape (any
  missing field is defaulted by `normalize()`). No code change.
- **Activate Gemini/Gemma:** set `VITE_GEMINI_API_KEY` / `VITE_GEMMA_API_KEY`
  (see `.env.example`). Falls back to regex when unset.
- **Add a new backend:** add a branch in `analyzeForBrain` (mirror the Crumb LLM
  branch: pre-screen → call → `normalize(payload, "<source>")` → fall through on
  error). Do not change call sites.

## Key files

| File                             | Role                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/App.jsx`                    | Renders persistent top, `SectionNav`, and the 8 `app-section` wrappers; wires `ScanHero.onResult` → brain. |
| `src/components/ScanHero.jsx`    | The hero: textarea → `analyzeForBrain` → score bars + brain update.                                        |
| `src/components/SectionNav.jsx`  | Presentational sticky tab bar + Labs links (`/research`, `/crumb-llm`).                                    |
| `src/utils/brainLLM.js`          | `analyzeForBrain` dispatcher + `normalize` + Crumb LLM client.                                             |
| `src/utils/cognitiveFirewall.js` | `scoreContentSmart` (Gemini→Gemma→regex), `mapTRIBEToRegions`.                                             |
| `src/styles/global.css`          | `.scan-hero*`, `.section-nav*`, `.app-section[hidden]` rules.                                              |

## Related

- Static showcase pages served alongside the SPA: `public/research/` (GaugeGap)
  and `public/crumb-llm/` (Crumb LLM). Served by Express static middleware before
  the SPA fallback — see `server.js`.
- `.env.example` — all optional `VITE_*` backend toggles.
