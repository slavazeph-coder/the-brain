# BrainSNN — Product / UX / UI Review

**Scope:** customer-facing UX, UI, accessibility, onboarding, clarity, and conversion. No security testing was performed.
**Method:** ran the app locally (`npm run dev`, deterministic engine, no API keys), walked every surface as a first-time customer at 1440×900 desktop and 390×844 mobile: landing page, Analyze (empty → scan → results), Improve (empty + generated rewrite), Autopsy, History, Pricing, Research, Queue, command palette, and mobile navigation. Findings reference real files so a developer can act on them directly.

---

## 1. First impression as a new customer (the 5-second test)

**What loads:** a dark neon landing page — "BrainSNN.com / Affective Intelligence Core / V2.0", a "System optimal" pill, a headline *"See response signals in any content before behavior forms."*, an animated brain graphic with Hook/Trust/Risk/Context bubbles, and two CTAs ("Launch Active Demo", "Open Scanner").

What a first-time visitor can and cannot answer within 5 seconds:

| Question | Verdict |
|---|---|
| What is this? | **Half-answered.** "Response signals in content" is abstract. The core mechanic — *paste your text, get scores* — is never stated plainly above the fold. |
| Who is it for? | **Unanswered.** Creators? Marketers? Neuroscientists? The word "brand" appears once, buried in the paragraph. |
| What problem does it solve? | **Guessable but not stated.** "Will this post flop or damage trust?" is the real job; the page says "before behavior forms," which sounds academic. |
| What should I do next? | **Ambiguous.** Two CTAs with unclear difference ("Launch Active Demo" vs "Open Scanner" — both open `/app`; one pre-fills text). |
| Does it feel trustworthy? | **Shaky.** "System optimal" reads as decoration, the stats row shows `O(N log N)`, `+31`, `102` — engineering trivia, not customer value — and there is **no footer, no pricing link, no about/docs/privacy/terms** anywhere on the landing page. A product that scores *other people's* content for manipulation needs to look impeccable itself. |

**What feels heavy or intimidating** (`src/app/LandingPage.jsx`):
- Jargon avalanche in the first screen: *Affective Intelligence Core, SNN, neuromarketing, Crumb LLM, TRIBE, 103-layer traces, wave mechanics, Gemma-ready, soliton*. A non-technical customer bounces; an advanced customer still doesn't learn what the layers *do for them*.
- The "Neuromarketing trends 2026: real-time content pre-testing" pill looks like a third-party ad, not a value prop.
- The stats row (`O(N log N)` / `+31 Trust gain` / `102 Layer trace`) answers questions nobody asked yet — and the `102` contradicts the paragraph above it that says 103 layers.
- The demo panel is genuinely good (real sample, real verdict, real scores) — it's the strongest trust element on the page and deserves more prominence than the brain animation.

**Biggest first-impression win available:** say the mechanic in one sentence ("Paste a post, ad, or email — get attention, trust, and manipulation-risk scores in seconds, free, no signup") and add a normal footer. Both are afternoon-sized changes.

---

## 2. Customer journey review

### 2a. Beginner — "just tell me if my post is good"

**Goal:** paste a draft, get a verdict, fix it, leave. Time budget: 2 minutes.

**Where the UI helps:**
- No signup wall; the deterministic engine runs instantly and free. This is a superpower — but it is never advertised ("free, instant, nothing leaves your browser" appears nowhere on the landing page).
- Example chips ("Social hook", "Paid ad", …) and "Try a high-risk example" are excellent onboarding (`ExampleSelector.jsx`).
- The live pre-scan panel that animates while typing is delightful and honest ("Local preview only").
- The Executive Verdict is the best panel in the product: *"Clear draft. Needs sharper proof." + score 62 + What works / What hurts / Best next move*. This is exactly what a beginner needs.

**Where the UI slows them down:**
1. **Double headline on every page.** The app header prints the nav description as an `<h1>` ("Cortex scan for attention, trust and trigger signals.") and the workspace prints a second `<h1>` ("Know how it lands before you publish.") right below (`AppHeader.jsx:12`, `ScanComposer.jsx:81`). The beginner reads two headlines and three debug chips (`102_LAYER_STACK`, `TRIBE_READY_TRACE`, `LOCAL_MEMORY_READY`) before seeing the textarea.
2. **The results avalanche.** After one scan the page becomes a ~7,700px wall of eleven stacked panels: verdict → brain map → heatmap → timeline → evidence → scorecard → firewall → affect → 103-layer trace → soliton field → technical details (`ResultsWorkspace.jsx:28-38`). The landing page explicitly promises the research material "stays out of the buyer workflow" — but the buyer workflow ships Kuramoto lattice readouts, gamma-coherence waveforms, and DFT spectral modes to every first scan.
3. **The rewrite breaks the product's promise.** "Improve This" → "Generate rewrite" produced: *"Here is the clearest reason to believe this message before you publish it: a useful moment! Our AI-powered platform guarantees 10x growth…"*. The template in `features/improve/rewrite.js:19-23` does blind string substitution (`"Last chance!"` → `"a useful moment!"`), leaving broken grammar and lower-case sentence starts, and misses `guarantees` (only `guaranteed` is replaced). **A copy-improvement tool that outputs broken copy is the single biggest trust-killer in the product.** The rewrite must either read like a human wrote it or be framed as "suggested direction," not a finished draft.
4. **Premature error styling.** The character counter renders in warning-yellow at `0 / 12,000` before the user has typed anything (`ScanComposer.jsx:106` — empty input fails validation, so `bsn-validation` applies). Error styling before any user action violates error-prevention norms.
5. Beginner-relevant actions ("Improve This", "Save", "Export") live in a right-hand inspector column that mobile users and skimmers miss entirely.

### 2b. Intermediate — "compare options and understand value"

**Goal:** test 2–3 variants, understand what the scores mean, decide whether to pay.

**Where the UI helps:**
- Autopsy's side-by-side battle with a preloaded example is a genuinely great feature and demos well.
- The Improve diff view ("What changed", strikethrough/highlight) is the right pattern.
- Pricing tiers are sensible ($0 / $9 / $29 / Pilot) and the "Recommended beta" badge sets an anchor.

**Where the UI slows them down:**
1. **"Autopsy" is a morbid, unclear label** for what is A/B comparison. "Reverse-engineer which version should publish" makes the reader work. Everyone already knows this feature as **Compare** or **A/B Test**.
2. **The pricing page leads with internals, not value:** "Paid beta for the 103-layer stack." A customer buys scans, rewrites, and history — not layers. Plan features are undefined jargon ("Core verdict", "Basic layer trace", "Context memory") with no tooltips and no comparison table.
3. **The pricing page confesses its plumbing.** Cards at the bottom read `Stripe — NOT CONFIGURED`, `Supabase — NOT CONFIGURED`, `OpenAI/Gemini/Gemma — NOT CONFIGURED` (`PricingWorkspace.jsx:160+`), and the Analyze page footer shows "Payments: waitlist / free mode — NOT LIVE". Radical transparency is admirable, but *ops status belongs behind an admin flag*, not on the page where you ask for money. To a customer "not configured" reads as "not finished."
4. Waitlist vs. purchase is fuzzy: the same button flips between "Start Basic" and "Join Basic Waitlist" depending on backend config, and the confirmation message — *"Basic waitlist intent captured locally. Configure Stripe price IDs to turn this into live Checkout."* — is written to the developer, not the customer.
5. Nothing on the pricing page addresses the classic objections: What happens to my data? Can I cancel? Is there annual pricing? What's a "scan"? No FAQ exists anywhere in the product.

### 2c. Advanced — "show me the deep controls"

**Goal:** understand the engine, tune parameters, trace layers, integrate.

**Where the UI helps:**
- The Research page is the right idea, well executed in places: Production vs. Experimental is explicitly separated, the honesty labels ("Not a literal brain measurement", "Advanced explanation only") are excellent and rare in this industry, and the 39 Hz soliton sensitivity lab with preset sweeps is a credible research toy.
- The layer explorer with search + group filter is the right pattern for 103 items.

**Where the UI slows them down:**
1. **Most layer descriptions are boilerplate.** L1, L2, L6–L10… all read "*[X] layer preserved in the 103-layer engine stack*" (`layerCatalog.js`). An advanced user opens the explorer, reads five identical descriptions, and concludes the catalog is padding. Fewer, honestly-described layers would build more credibility than 103 rows of filler.
2. **Version drift everywhere:** header chip says `102_LAYER_STACK`, landing stat says `102`, landing paragraph says 103, Research says "103 layers indexed", `TechnicalDetails.jsx` falls back to 102. Hardcoded in five places (`AppHeader.jsx:15`, `LandingPage.jsx:164`, `PricingWorkspace.jsx:160`, `EngineReadinessPanel.jsx:60`, `TechnicalDetails.jsx:30`) while `LAYER_CATALOG.length` exists precisely to avoid this. Advanced users notice inconsistent numbers immediately.
3. Codenames (Crumb, TRIBE, Gemma, Lobster Trap, Veea) are never expanded on first use. One glossary line each would fix it.
4. No path from Research to docs, API reference, or GitHub — the audience most likely to advocate for the product has nowhere to go deeper.

---

## 3. Information architecture

### Current structure and its problems

```
Landing (/)                     App (/app, single-page state router)
├─ Hero + demo                  ├─ Sidebar: Analyze / Improve / Autopsy / History / Pricing
└─ 3 feature strips             ├─ Bottom:  Research / Queue / Account(→Pricing!)
   (no footer, no links)        └─ Header:  Command / Pro-Pilot / Export + debug chips
```

1. **Two naming systems for every surface.** Nav says Analyze/Improve/History/Queue; page headers say **Cortex/Synapse/Memory/Neural Queue**; the command palette and empty states mix both ("Go to Cortex" button inside the Improve empty state, "Save a result from Cortex" inside History). Recognition-over-recall says pick one set. Keep the neuro flavor in the brand and visuals; use plain verbs in navigation and buttons.
2. **Pricing sits in the middle of the workflow nav** (between History and Research), interrupting the tool sequence. It's a commercial page, not a workspace.
3. **Queue is a workflow step but is exiled to the bottom group** next to Research and Account. The actual flow is Analyze → Improve → Compare → Queue(Approve) → Export; the sidebar order doesn't tell that story.
4. **"Account" is mislabeled** — it calls `onUpgrade` and lands on Pricing (`DesktopSidebar.jsx:36-39`). A customer clicking Account expects profile/plan/sign-in, gets a sales page. That's a dark-pattern smell even if unintentional.
5. **Icon identity is unstable:** Queue is a Microscope in `navigation.js`, a BrainCircuit in the sidebar (same glyph as the app logo), and a ListChecks on mobile. Improve is Sparkles, but Sparkles also decorates the "Pro / Pilot" upsell button and verdict badges.
6. **Header duplication:** every page renders kicker + h1 + subline in `AppHeader` *and* kicker + h1 + subline in the workspace. ~280px of headline before content on every view.
7. **The results page has no internal structure** — eleven siblings of equal visual weight (see §2a).

### Recommended structure

```
Landing (/)
├─ Hero: one-line mechanic + primary CTA ("Scan a draft free") + live demo panel
├─ How it works (3 steps: Paste → Score → Fix)
├─ Deep-dive strip (verdict / compare / research honesty) with real screenshots
├─ Pricing teaser (3 cards) → /app pricing
├─ FAQ (5 questions incl. "Is this real brain measurement?" — own your disclaimer)
└─ Footer: product, pricing, research, GitHub, privacy, terms, contact

App (/app)
├─ WORKFLOW  : Analyze → Improve → Compare (was Autopsy) → Approvals (was Queue)
├─ LIBRARY   : History
├─ EXPLORE   : Research
└─ FOOTER    : Upgrade (was Pricing+Account), Account (real settings when auth exists)

Results (inside Analyze) — tabbed, not stacked:
├─ Overview   : Executive Verdict + score + signal map + next actions   (default)
├─ Line-by-line: heatmap + evidence + timeline
├─ Audience   : scorecard + affect + firewall
└─ Advanced   : layer trace + soliton + technical (collapsed; "research" badge)
```

This gives beginners a 1-screen result, intermediates a guided flow reading left-to-right in the sidebar, and advanced users a clearly-marked deep end — with zero features removed.

---

## 4. Visual design and theme improvement

**Keep:** the dark neuro-neon identity (cyan `#00f5ff` → purple `#a855f7` gradient, Space Grotesk display, JetBrains Mono accents, glow shadows). It's distinctive, consistent, and fits the product. Everything below strengthens it without changing its mood.

- **Typography scale.** Display headlines are used twice per page at near-hero sizes. Reserve the display size (~clamp 2.2–3rem) for one h1 per page; drop workspace section titles to 1.25–1.5rem. Body text on dark should stay ≥ 0.95rem; the all-caps mono micro-labels (status chips, eyebrows) sit at ~0.7rem with wide tracking — fine for one accent per card, currently used 3–5× per viewport. Rule of thumb: **one mono accent per card.**
- **Section rhythm.** All panels use the same surface/border/radius, so nothing ranks. Introduce three container tiers: *Hero card* (gradient border glow — verdict only), *Standard card* (current style), *Quiet card* (no border, `--bsn-surface-2` only — metadata, readiness, technical). The eye then finds the verdict first, always.
- **Button hierarchy.** The cyan→purple gradient primary appears simultaneously on "Run Brain Scan", "Improve This", "Export" (header), "Generate rewrite", and "Run comparison". One gradient primary per viewport; everything else secondary/ghost. Also: "Run comparison" (a read-only action) is currently louder than "Approve" (the decision).
- **Icons.** One icon per concept, everywhere (see §3.5). Add subtle icons to the pricing feature checklists to break text walls. Stop using Sparkles for both "Improve" and "upsell".
- **Cards/containers.** The three landing feature strips are boxes of text with an 18px icon; give them a consistent icon container (40px, tinted bg) and a one-line benefit + one-line detail. In the app, the "Launch readiness" panel should become a single quiet row of status dots, not a 5-card grid competing with the composer.
- **Empty states** (History/Queue/Improve) have the right skeleton (message + explanation + CTA) but say "Cortex" and "Synapse" and all funnel to the same "Run a Brain Scan" gradient button. Rename per §5, and vary the CTA label to match the destination ("Scan your first draft").
- **Contrast.** Generally strong (worst common pair `--bsn-text-muted #7c8294` on `#07070d` ≈ 5.5:1 — passes AA). Two watch-items: yellow `#eab308` at 0.9rem for validation text (borderline at small sizes — bump to 1rem or use `#facc15`), and 60%-opacity disabled button text, which is fine *if* paired with a tooltip explaining why (Export is disabled with no explanation today).
- **Mobile layout.** The fixed bottom nav is good; ensure `main` reserves ~90px bottom padding so "Run Brain Scan" and footers never sit under it. The "More" sheet needs a backdrop + outside-tap close (today it floats over content with Escape-only dismissal — touch users have no obvious exit). The input-type segmented control wraps awkwardly ("Web page beta" / "Video/script beta" on two ragged lines) — stack it as full-width rows on <480px.
- **Trust signals.** Replace decoration with substance: "System optimal" → real state ("Engine ready — runs locally"); debug chips → plain badges ("103-layer engine · Private by default: history stays in your browser"); keep and *promote* the honesty disclaimer ("AI-estimated signals, not brain measurement") — it is a differentiator, currently whispered in 0.8rem muted text at the bottom.
- **Visual storytelling.** The landing demo already tells the story (content → scores → verdict). Add the missing third beat: show a *before/after rewrite with the score delta* (+31 trust is already claimed in the stats row — prove it visually). That single graphic sells Analyze *and* Improve.

---

## 5. Copy and messaging

Principle: **plain verbs for actions, neuro-flavor for brand.** A non-technical customer should understand every button; an advanced customer should still find the depth labeled honestly.

### Landing page (`LandingPage.jsx`)

| Location | Current | Recommended |
|---|---|---|
| Badge pill | "Neuromarketing trends 2026: real-time content pre-testing" | "Pre-test your content in seconds — free, no signup" |
| H1 | "See response signals in any content before behavior forms." | "Know how your content will land — **before** you publish." |
| Sub | "BrainSNN estimates hook strength, trust pressure… Technical Crumb LLM, TRIBE and 103-layer traces stay available…" | "Paste a post, ad, or email. BrainSNN scores attention, trust, emotional charge and manipulation risk — then helps you rewrite it. Runs instantly in your browser; the research engine is there when you want to go deeper." |
| Primary CTA | "Launch Active Demo" | "Try a live example" |
| Secondary CTA | "Open Scanner" | "Scan your own draft" |
| Stats row | `O(N log N)` / `+31` / `102` | "Results in ~5 seconds" / "+31 avg. trust lift after rewrite" / "103 analysis layers" |
| Feature strip | "TRIBE + Gemma-ready — Provider layers activate only when configured; local fallback remains transparent." | "Works offline by default — add AI providers only if you want deeper analysis. We always show which engine produced your result." |

### App chrome & navigation

| Current | Recommended | Why |
|---|---|---|
| "Autopsy" | "Compare" (or "A/B Test") | Familiar term; Autopsy is morbid and vague |
| "Queue" / "Neural Queue" | "Approvals" | Says what it's for |
| "Account" (→ pricing) | "Upgrade" | Label must match destination |
| Header h1 "Cortex scan for attention, trust and trigger signals." | Remove header h1 entirely; keep one title per workspace | Duplicate headline |
| Chips `102_LAYER_STACK` etc. | "103-layer engine · Local & private" (or remove) | Debug-speak; also stale |
| Cortex/Synapse/Memory kickers | Use as *flavor subtitles* at most ("Analyze — the Cortex") | Recognition over recall |

### Analyze / results

- Empty pre-scan: "Paste a draft to wake the engine" → keep (it's charming) but retitle panel "Instant preview" and note "Full scan adds the verdict and 103-layer analysis."
- Verdict block: already excellent. Add one plain sentence under the score: "62/100 — publishable after one fix."
- Counter: neutral color until input is invalid; message "Add at least N characters to scan" only after blur/attempt.
- Privacy note: promote to a labeled line under the Run button: "🔒 Nothing is uploaded unless you connect a provider. Results are AI estimates, not brain measurements."

### Improve

- "Synapse rewrites and version comparison." → "Turn the diagnosis into a stronger draft."
- Rewrite framing (until generation quality is fixed): label output "Suggested direction — edit before publishing", and never present broken grammar as an "Improved version."
- "Run comparison" → "Score both versions".

### Pricing

- H1 "Paid beta for the 103-layer BrainSNN stack." → "Start free. Upgrade when you need more scans."
- Plan features need customer language: "Core verdict" → "Verdict + top fix on every scan"; "Basic layer trace" → "See which checks fired"; "Context memory" → "Engine remembers your past scans for better advice."
- Waitlist message → "You're on the Basic list — we'll email you the moment checkout opens. Everything stays free meanwhile."
- Move `Stripe/Supabase/OpenAI not configured` cards behind an admin/dev flag.

### Research

- Keep the honesty labels verbatim — they're the best copy in the product.
- Add a 4-line glossary card: Crumb (local physics model), TRIBE (7-region projection service), Gemma (optional Google model), Soliton lab (39 Hz research toy).
- Replace boilerplate layer descriptions or collapse boilerplate layers into grouped rows ("L6–L10 · App infrastructure — 5 layers").

---

## 6. Usability and accessibility

### Heuristic review

| Heuristic | Status | Evidence & fix |
|---|---|---|
| Visibility of system status | ⚠️ Mixed | Scan progress + cancel exists (good). Export button disables with no reason — add tooltip "Run a scan first". Save shows "Saved to local Memory." (good) but disappears without focus management. |
| Match with real world | ❌ | Cortex/Synapse/Autopsy/Soliton in the buyer path; §5 renames fix this. |
| User control & freedom | ⚠️ | "Clear" wipes the draft with no undo; add confirm-on-clear >500 chars or a snackbar undo. No way back from results to composer other than scrolling. |
| Consistency | ❌ | Dual naming, triple icon identities, 102 vs 103, "scanner/engine/cortex" all naming the same thing. |
| Error prevention | ⚠️ | Yellow counter before any input; paste-from-clipboard fails silently if permission denied (show "Press ⌘V instead"). |
| Recognition over recall | ❌ | Command palette and empty states require knowing codenames. |
| Flexibility & efficiency | ✅ | ⌘K palette, ⌘/Ctrl+Enter to scan (add a visible hint "⌘↵" inside the Run button), example chips. |
| Minimalist design | ❌ | Eleven-panel results; readiness grid on the composer; three status chips per header. |
| Help & documentation | ❌ | No FAQ, no docs link, no glossary; tooltips exist only on the fallback badge. |

### Accessibility (WCAG-flavored, code-level)

**Working well:** global `:focus-visible` outlines (`tokens.css:86`), `prefers-reduced-motion` support, `role="status"`/`role="alert"` on async messages, labeled textarea via wrapping `<label>` (`ScanComposer.jsx:89`), aria-labels on regions, semantic `<nav>`/`<main>`.

**Needs fixing:**
1. **Two `<h1>` per view** (`AppHeader.jsx:12` + each workspace) and skipped heading levels in results panels. One h1; panels start at h2.
2. **Focusable no-ops:** the landing brain nodes are `<button>`s with no action (`LandingPage.jsx:75-85`) — four tab stops that do nothing. Render as `<div role="img">` with a single aria-label, or make them actually select a signal.
3. **Mobile "More" sheet** (`MobileNavigation.jsx:38`) is a `role="dialog"` without focus trap, without `aria-modal`, without backdrop; tapping outside doesn't close. Convert to a proper bottom sheet.
4. **Micro-mono all-caps text** (chips, eyebrows) at ~0.68rem is below comfortable readability; raise to 0.75rem minimum and reduce usage.
5. **Autopsy textareas** rely on adjacent text ("Variant A") — bind with `htmlFor`/`id` so screen readers announce them.
6. **Scan completion isn't announced**; the page scrolls but SR users get silence. Add an `aria-live="polite"` region: "Scan complete — decision score 62."
7. **Command palette** should trap focus, set `aria-activedescendant`, and restore focus to the invoking button on close.
8. Landing "System optimal" indicator is a decorative span; if kept, give it `role="status"` and real meaning.

---

## 7. Recommended redesign plan

### Top 10 highest-impact problems

1. Rewrite engine outputs broken English — the conversion moment destroys trust (`rewrite.js`).
2. Results page is an 11-panel, ~7,700px monolith mixing buyer and research content.
3. Landing page never states the mechanic, has two ambiguous CTAs, and no footer/links — trust and comprehension gap.
4. Dual naming system (Analyze/Cortex, Improve/Synapse, Queue/Neural Queue, History/Memory) across nav, headers, empty states, palette.
5. Ops internals shown to customers: "NOT CONFIGURED" cards on Pricing, "waitlist/free mode NOT LIVE", debug chips in every header.
6. "Autopsy" label obscures the most demo-able feature (A/B compare).
7. "Account" button opens Pricing — mislabeled navigation.
8. Duplicate hero-size headlines on every app page push content below the fold.
9. Number drift (102 vs 103) across five hardcoded locations.
10. Mobile: More-sheet has no backdrop/dismiss affordance; segmented control wraps badly; risk of bottom-nav overlap.

### Top 10 recommended fixes (matched)

1. Rewrite templates as complete sentences (never splice substitutions mid-sentence); add casing repair; cover `guarantee/guarantees/guaranteed`; label output "Suggested direction" until an LLM path is configured.
2. Tab the results: Overview / Line-by-line / Audience / Advanced — Overview = verdict + map + actions only.
3. New hero copy (§5), single primary CTA + "Try a live example", add footer with pricing/research/GitHub/privacy.
4. One naming pass: plain verbs everywhere; codenames demoted to flavor subtitles.
5. Gate engine-status UI behind a `?admin` flag or env check; replace chips with one honest badge.
6. Rename Autopsy → Compare; keep the skull-free GitCompare icon.
7. Rename Account → Upgrade (or build a real account stub).
8. Delete the `AppHeader` h1 block; keep breadcrumb-kicker + actions only.
9. Replace all hardcoded 102/103 with `LAYER_CATALOG.length`.
10. Mobile polish: backdrop + tap-out close, stacked input-type rows, `padding-bottom: calc(90px + env(safe-area-inset-bottom))` on `main`.

### New page/flow structure

See §3 diagram. Sidebar order: **Analyze → Improve → Compare → Approvals** (workflow), divider, **History, Research** (library), divider, **Upgrade** (commerce). Results tabbed. Landing: Hero → How it works → Before/after rewrite proof → Feature trio → Pricing teaser → FAQ → Footer.

### Revised section-by-section copy

Delivered in §5 (landing table, nav table, analyze, improve, pricing, research).

### Component-level design recommendations

- **Button**: enforce one `primary` per viewport via lint/review convention; add `title`/tooltip support for disabled states.
- **Card**: add `tier` prop (`hero | standard | quiet`) mapping to border/glow/none.
- **Badge**: cap at 2 per header; new `tone="private"` (lock icon) for the privacy badge.
- **Tabs** (new): results navigation; underline style in cyan, mono uppercase labels — theme-consistent.
- **StatusDot row** (new): replaces the launch-readiness card grid; five dots + labels in one quiet row.
- **BottomSheet** (new, mobile): backdrop, drag/tap dismiss, focus trap; used by More menu and (later) mobile inspector actions.
- **EmptyState**: accept `icon`, `title`, `body`, `cta` — already close; fix copy + per-destination CTA labels.
- **Tooltip**: extend to plan features on Pricing and disabled buttons.

### Mobile-specific improvements

1. Bottom padding under fixed nav (safe-area aware).
2. More menu → BottomSheet with backdrop.
3. Input-type selector stacks full-width below 480px.
4. Results inspector (score + Improve CTA) becomes a sticky bottom summary bar above the nav ("62 · Improve this ↗") so the next action is always visible.
5. Reduce hero type from ~2.6rem to ~2rem on ≤390px; the landing h1 currently occupies 3 viewport lines.
6. Landing metrics grid → horizontal scroll-snap chips.

### Quick wins doable today (≈1 day total)

- `LAYER_CATALOG.length` everywhere (5 files) — 30 min.
- Rename Autopsy→Compare, Queue→Approvals, Account→Upgrade — 30 min.
- Delete duplicate `AppHeader` h1 + debug chips — 30 min.
- Neutral counter color when empty — 10 min.
- Hide "NOT CONFIGURED" cards unless dev flag — 30 min.
- Footer on landing (links + privacy line) — 1 h.
- Fix rewrite casing + `guarantees` + sentence-safe templates — 2 h.
- Tooltip on disabled Export — 15 min.
- Mobile main bottom padding — 15 min.
- De-button landing brain nodes — 15 min.

### Deeper improvements for the next version

- Tabbed results workspace with per-tab lazy rendering (also a performance win).
- Real onboarding: first-visit 3-step coachmark (Paste → Score → Improve) instead of the readiness panel.
- LLM-backed rewrite path with visible engine badge and score-delta proof.
- Real account area (plan, usage meter "23/30 scans", data controls) once Supabase lands.
- Landing before/after showcase with animated score delta.
- Saved-scan comparison in History (select two → Compare).
- Public shareable report page (trust + growth loop) — hinted by ShareDialog already.
- In-product glossary/help popover system.

---

## 8. Implementation-ready output

### Revised layout (desktop app)

```
┌──────────┬──────────────────────────────────────────────┐
│ SIDEBAR  │ TOPBAR: [kicker/breadcrumb]     [⌘K] [Upgrade] [Export] │
│ Analyze  ├──────────────────────────────────────────────┤
│ Improve  │ WORKSPACE                                     │
│ Compare  │  h1 (single) + one-line sub                   │
│ Approvals│  composer / content                           │
│ ─────    │  ┌ Results ────────────────────────────────┐ │
│ History  │  │ [Overview][Line-by-line][Audience][Adv.] │ │
│ Research │  │ hero verdict card    │ sticky inspector  │ │
│ ─────    │  │ signal map           │ score + actions   │ │
│ Upgrade  │  └──────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────┘
```

Landing: single column, max-width 1200, sections at 96px vertical rhythm (64px mobile), footer mandatory.

### Component list

| Component | Status | Notes |
|---|---|---|
| `AppHeader` | modify | drop h1/sub/chips; keep kicker + actions; height ≤72px |
| `DesktopSidebar` | modify | new order + dividers; fix Queue icon (ListChecks everywhere); Account→Upgrade |
| `ResultsTabs` | **new** | 4 tabs, controlled, deep-linkable (`/app?tab=advanced`), h2 sections inside |
| `StickyInspector` | modify | desktop right col ≥1100px; mobile sticky bottom bar |
| `StatusDotRow` | **new** | replaces EngineReadinessPanel card grid; hidden unless dev flag for "not configured" entries |
| `BottomSheet` | **new** | mobile More + future action sheets; backdrop, focus trap, `aria-modal` |
| `Footer` (landing) | **new** | 4 link groups + honesty disclaimer + © |
| `Tabs`, `Tooltip`, `Badge`, `Button`, `Card` | extend | per §7 component recs |
| `rewrite.js` | rewrite | sentence-template engine: pick full-sentence rewrites per detected tactic; never substring-splice |

### Content blocks (landing, in order)

1. **Hero** — h1 + sub + primary CTA + demo panel (existing demo, promoted).
2. **How it works** — 3 numbered cards: "Paste your draft" / "Get scores + a verdict in seconds" / "Fix it with guided rewrites". Each ≤14 words body.
3. **Proof** — before/after rewrite with score delta animation (static image acceptable v1).
4. **Feature trio** — Compare variants / Private by default / Research-grade depth (honesty labels).
5. **Pricing teaser** — Free/$9/$29 cards, "See full pricing →".
6. **FAQ** — 5 items: Is this real brain measurement? (no — say it proudly) · Is my content uploaded? · What's a scan? · What do the scores mean? · Can I cancel?
7. **Footer**.

### Interaction notes

- Run Brain Scan: show progress inline (exists); on complete, focus moves to verdict heading (`tabIndex=-1` + `.focus()`), `aria-live` announces score; scroll to Overview tab.
- Tabs: arrow-key navigation, `aria-selected`, remembered per session.
- Clear: if >500 chars, snackbar "Draft cleared — Undo" (5 s).
- Disabled Export/Improve: `Tooltip` "Run a scan first".
- Command palette: autofocus search, focus trap, Esc/outside-click close, restore focus.
- More sheet: opens ≤300 ms slide-up, backdrop tap + swipe-down close.
- Pricing CTA: after waitlist join, button becomes confirmed state ("On the list ✓") — no dev-speak.
- Score display: engine signals such as `firewallSignals.manipulationPressure` are emitted on a **0–1 scale** (`src/lib/firewallLayer.js:108`); any new UI that renders them as a score out of 100 must multiply by 100, as `FirewallPanel.jsx:31` and `LayerTracePanel.jsx:41` already do.

### Responsive behavior

| Breakpoint | Rules |
|---|---|
| ≥1100px | sidebar expanded, results 2-col (main + 300px inspector) |
| 768–1099px | sidebar collapsed to icons, inspector stacks above panels as summary card |
| <768px | bottom nav; inspector = sticky bottom bar; tabs horizontally scrollable with snap; type scale −1 step |
| <480px | input-type selector stacks; example chips wrap 2-col; hero h1 2rem |
| always | `main { padding-bottom: calc(90px + env(safe-area-inset-bottom)) }` on mobile; no horizontal scroll at 320px |

### Theme-preserving style guidance

- Keep tokens in `tokens.css`; **add**: `--bsn-space-1..6` (4/8/12/16/24/40), `--bsn-text-size-xs..3xl` scale, `--bsn-tier-hero-border: linear-gradient(...)`.
- Gradient (cyan→purple) reserved for: primary button, hero verdict border, score emphasis. Never on two elements in one viewport.
- Mono font reserved for: numbers, scores, one eyebrow per card, code. Not for body or nav.
- Glow shadows (`--bsn-glow-*`) only on interactive hover/focus and the hero card.
- Yellow = warnings only; never default/empty states.
- Keep `prefers-reduced-motion` coverage for all new animation (tab slide, sheet, score count-up).

### Acceptance checklist for the finished UI

**Comprehension**
- [ ] A first-time visitor can state "paste text → get scores → fix it" from the hero alone (hallway-test 3 people).
- [ ] Every nav label describes its destination; no codename appears on a button.
- [ ] Layer count renders from `LAYER_CATALOG.length` everywhere — grep for `102` returns no UI hits.

**Flow**
- [ ] Landing → first scan result ≤ 2 clicks (example path) and ≤ 45 s (own-draft path).
- [ ] Results Overview fits in ~1.5 viewports at 1440×900; advanced content only under Advanced tab.
- [ ] "Improve" output is grammatical for all five example inputs and the high-risk example (add unit test asserting sentence casing + no orphan fragments).
- [ ] Approve/Queue/Export reachable from results without scrolling (desktop) / via sticky bar (mobile).

**Trust**
- [ ] No "not configured / not live" text visible without dev flag.
- [ ] Privacy line ("stays in your browser") visible on composer and pricing.
- [ ] Disclaimer ("AI estimates, not brain measurement") present on landing FAQ, results, research.
- [ ] Footer exists with working privacy/terms/contact links.

**Accessibility**
- [ ] Exactly one h1 per page; heading levels sequential (axe: no violations — wire the existing `@axe-core/playwright` dep into `test:e2e`).
- [ ] All interactive elements ≥44px touch target on mobile; no focusable no-ops.
- [ ] More sheet + command palette: focus trapped, Esc + backdrop close, focus restored.
- [ ] Scan completion announced via `aria-live`; verdict receives focus.
- [ ] Text ≥0.75rem; all text pairs pass AA on their actual backgrounds.

**Mobile**
- [ ] 320/390/768px: no horizontal scroll, no content under bottom nav, Run button always reachable.
- [ ] Input-type control and example chips wrap cleanly at 320px.

---

*Screenshots reviewed during this audit (landing, analyze, results, improve, autopsy, history, pricing, research, queue, command palette, mobile ×3) were captured from the local deterministic build on 2026-07-04.*
