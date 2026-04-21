# The Brain — AI Memory

> Shared by Claude Code and Codex. Keep under 200 lines.
> Last updated: 2026-04-12

## Purpose

Central AI workspace — OpenClaw hub, agent library, and UI. Claude + Codex collaborate here.

## Architecture

→ see [architecture.md](architecture.md)

## Conventions

→ see [conventions.md](conventions.md)

## OpenClaw Status

- Gateway: running at ws://127.0.0.1:18789
- Version: 2026.3.11
- Agents: main, imessage
- Cron jobs: workspace-git-sync (3h), memory-cleanup-weekly, daily-self-review

## Active Work

<!-- Both AIs append notes here as they work -->

### PenguinWalk Arena — Shipped 2026-03-21

Club Penguin-style AI debate arena live at https://penguinwalk.co

**What shipped:**

- ArenaHome with 3D animated penguins (React Three Fiber + @react-spring/three)
- 10 animation states with spring physics (waddle, belly flop, dizzy, snowball, etc.)
- Battle card chat UI with per-model colors and personality system
- Pre-scripted demo debates (zero LLM cost, SSE replay)
- 4-tier monetization: Demo → Free (3 credits) → Basic $19/mo → Pro $49/mo
- Tier-gated debate route with dynamic model selection per tier
- TierGate auth modal, CreditMeter, pricing page
- Stripe checkout/webhook stubbed (ready to wire)
- Railway Postgres added, schema deployed

**Next up:**

1. Rigged GLTF penguin models (biggest visual jump — replace coded geometry with bone-rigged .glb)
2. Interactive environment (ice rink, snowfall, audience NPCs)
3. Content-reactive animations (sentiment → expressions, @mention reactions)
4. Stripe keys + real payments
5. Sound design (typing, victory jingle, crowd reactions)

### BrainSNN + TRIBE v2 — Started 2026-04-05

3D brain viewer with Meta's TRIBE v2 foundation model for real neural predictions.

**What shipped:**

- React Three Fiber 3D brain with 7 regions (CTX, HPC, THL, AMY, BG, PFC, CBL)
- 3D neural flow grid: GPU-animated TubeGeometry pathways with custom GLSL shaders
- Signal pulse waves radiate through the connectome web when regions fire
- Secondary cross-links between adjacent pathways create mesh/web visual
- Three data modes: Simulation (STDP), TRIBE v2 (real fMRI predictions), Live EEG
- TRIBE v2 FastAPI server: maps fsaverage5 cortical mesh to 7 regions via Desikan-Killiany
- Pre-computed scenario packs (sensory burst, memory replay, emotional salience, executive)
- EEG input via Web Bluetooth (Muse) and Web Serial
- WebM recording + GIF export via FFmpeg.wasm
- Quality tiers: low/high/ultra with PerformanceMonitor auto-switching
- Inspector panel with sparklines, pathway analysis, region details

- Cognitive Firewall: regex-based content manipulation scoring (4 dimensions + evidence)
- Gemma 4 deep analysis engine: AI-powered manipulation detection via Google AI Studio or Ollama
  - Multimodal support: text, images, video, audio
  - Auto-routes through Gemma 4 when VITE_GEMMA_API_ENDPOINT is configured
  - Falls back to regex scoring when API unavailable
  - Supports Google AI Studio API and OpenAI-compatible endpoints (Ollama/vLLM)

- Session Intelligence: brain state snapshots with save/load/compare/export/import/report
- Neural Analytics Dashboard: sparkline trends, Pearson correlation matrix, z-score anomaly detection, threshold alerts
- Neural Narrative Engine: real-time human-readable brain activity narration
- Toast notification system for alerts, exports, mode switches
- Keyboard shortcuts (Space, b, r, 1-3, s, e, q, ?) with help modal
- Share & Embed: shareable URLs with encoded brain state, iframe embed codes, JSON export
- Onboarding walkthrough: 7-step guided tour for first-time users
- Vercel deployment config + .env.example

**Stack:** React 18, Vite, React Three Fiber, Three.js, postprocessing, FastAPI, TRIBE v2, Gemma 4

**35 Layers:**
1. 3D Brain Viewer (R3F)  2. Neural Flow Grid (GLSL)  3. TRIBE v2 (Meta fMRI)
4. Cognitive Firewall (regex)  5. Gemma 4 (AI deep analysis)  6. Snapshots
7. Analytics Dashboard  8. Narrative Engine  9. Toast Notifications
10. Keyboard Shortcuts  11. Share & Embed  12. Onboarding Walkthrough
13. Split Brain View (side-by-side 3D comparison)
14. AI Voice Narrator (Web Speech API)
15. Analysis Plugin System (sentiment, readability, credibility)
16. WebSocket Live Sync (multi-user rooms + chat)
17. Activity Heatmap Timeline (canvas color matrix)
18. Knowledge Brain — Second Brain system (LLM-Wiki framework, gap detection, self-learning)
    - Real file system scanner (find/tree output, Obsidian vault import)
    - LLM-Wiki markdown generator (auto-creates structured wiki from knowledge map)
    - Gemma 4 knowledge intelligence (AI gap analysis, learning path generation)
    - Knowledge mode in 3D viewer (regions relabeled as knowledge domains)
    - Error boundaries around heavy panels
    - Accessibility: focus-visible styles, prefers-reduced-motion, ARIA hints
19. MCP Brain Bridge — 14 tools exposed via JSON-RPC (cannibalized from GitNexus)
    - In-browser tool catalog + tester + audit log + config snippet UI
    - Standalone Node stdio MCP server (`mcp-server/`) with WebSocket relay
    - Tools: get_brain_state, list/save/compare snapshots, scan_content,
      apply_scenario, get_correlations, detect_anomaly, classify_knowledge,
      narrate_state, impact_analysis (blast radius through connectome)
20. Code-Aware Knowledge Brain — code → graph → communities → hybrid search
    - Regex parser for JS/TS/Python/Go/Rust (functions, classes, imports, exports)
    - Pure-JS Louvain-lite community detection with modularity score
    - BM25 + trigram Jaccard hybrid search via Reciprocal Rank Fusion
    - Maps detected code communities onto brain regions as activation pattern
21. Brain Steward — Agent Autopilot using the Layer 19 MCP tool catalog
    - Configurable control loop (2/4/8/15s tick) with rules + activity feed
    - Auto-snapshot on z-score anomalies (1.5–3σ threshold)
    - Narrate on state change, optional TTS speech, scenario-shift detection
    - Closes the feedback loop: brain observes itself through its own tools
22. Conversation Brain — multi-turn transcript → per-turn cognitive drift
    - Parses speaker-prefixed or JSON transcripts
    - Each turn scored via Cognitive Firewall + applied to simulated brain
    - Pressure-over-turns bar timeline, peak turn highlighted
    - Final drift grid (per-region delta vs baseline) + "apply final state"
23. Cognitive Immunity Score — persistent 0–100 resilience metric
    - 4 dimensions: awareness, resilience, depth, consistency
    - Daily streak-based consistency multiplier
    - Events feed from firewall/convo/steward/snapshots/gemma/code/knowledge
    - Dial + breakdown bars + sparkline + event log UI
    - Storage key: `brainsnn_immunity_v1`, localStorage-backed
24. Real Embeddings — transformers.js via esm.run CDN (no build dep)
    - Model: Xenova/all-MiniLM-L6-v2 (384-dim, quantized, ~25MB)
    - Lazy-loaded on demand, client-side inference only
    - Cache: in-memory Map + localStorage (cap 500 vectors)
    - Upgrades bm25.hybridSearchSemantic with cosine similarity
    - CodeBrainPanel auto-uses embeddings when ready; falls back to trigram
    - EmbeddingsPanel: status indicator, enable button, test embed console
25. Red Team Simulator — synthetic attack corpus vs the Cognitive Firewall
    - 65 samples across 5 manipulation categories + benign controls
    - Urgency / outrage / fear / certainty / combo + 15 benign
    - Detection rate + false-positive rate at 3 thresholds (0.2/0.3/0.4)
    - F1 score + A–F verdict grade with color
    - Per-category matrix, missed attacks, false positives
    - Proves whether the firewall actually works
26. Dream Mode — idle-triggered replay consolidation (hippocampal analogue)
    - Idle monitor: after N seconds (15s–2m) drifts into dream phase
    - Replays recent snapshots in slow cycles (1.2s/2.4s/4s)
    - STDP weight reinforcement on co-active region pairs
    - Region-blend drift toward replayed states (consolidation)
    - Brain self-consolidates like a sleeping cortex
    - Any activity (button click, scan) wakes the brain
27. Adversarial Training — self-improving firewall via n-gram lift mining
    - Closes the loop on Layer 25 — learns from missed attacks
    - Mines discriminative bigrams/trigrams (lift ≥ 3, min 2 attack hits)
    - Laplace-smoothed P(n-gram|attack) / P(n-gram|benign) ranking
    - Persists learned patterns in localStorage (cap 40, highest-lift kept)
    - scoreWithLearned() augments base scoring by pattern match count × avg lift
    - Shows before/after detection rate + FPR + F1 delta after each train run
28. Neuro-RAG — semantic retrieval over pasted documents
    - Parse `=== Title ===` delimited docs → 180-word chunks w/ 40-word overlap
    - Embeds each chunk via Layer 24 transformers.js (when ready)
    - Cosine similarity retrieval with top-k citations + highlight
    - Falls back to BM25 + trigram hybrid when embeddings unavailable
    - Maps retrieval onto brain: HPC = recall strength, CTX = breadth, PFC = focus
    - All processing in-browser, docs never leave the machine
29. Affective Trigger Decoder — 12-affect taxonomy across 4 clusters
    - threat (fear/anger/disgust), reward (joy/awe/pride),
      social (belonging/nostalgia/shame), cognitive (curiosity/certainty/confusion)
    - Russell's circumplex (valence × arousal) plot with quadrant detection
    - Per-region glow color override on 3D brain — AMY glows red for fear,
      pink for belonging, lavender for awe — same neural button, different finger
    - Cross-category insight: when fear + shame + nostalgia all hit AMY,
      labels the convergence ("same neural target, different route")
    - Additive layer on top of Layer 4: tells you WHICH feeling is installed
30. Neurochemistry Sandbox — 6 NT sliders with real region-effect profiles
    - dopamine (BG+PFC), serotonin (PFC−AMY), cortisol (AMY↑ HPC↓),
      oxytocin (AMY↓ PFC↑), norepinephrine (THL+AMY), acetylcholine (CTX+HPC)
    - 9 presets: baseline, caffeine, meditation, acute stress, SSRI (4wk),
      flow state, sleep deprivation, panic attack, MDMA phase II
    - Gain slider controls how strongly NT deviation translates to region change
    - "Match from last decode" derives NT signature from Layer 29 affect
      fingerprint — lets you see the chemistry beneath the feeling
    - Region impact preview shows real-time bars per region (green=+/red=−)
31. Brain Evolve — evolutionary search over firewall rulesets
    - Cannibalized from GAIR-NLP/ASI-Evolve: UCB1 bandit + Island + MAP-Elites
      samplers ported from Python to ~250 LOC JS
    - Learn → Design → Experiment → Analyze loop: mines n-gram lift from
      red team corpus (Layer 25), mutates rulesets (add/drop/widen/narrow
      /swap-category/crossover), scores each candidate's F1 against the
      corpus, distills a short lesson per round
    - Feature bins for MAP-Elites: FPR tier × pattern-count tier — keeps
      diversity (stops the search from just piling on patterns)
    - localStorage persistence — pause + resume an evolution run
    - "Promote winner to active firewall" swaps the live Layer 4 regex set
      with the evolved ruleset; all callers (scoreContent, mcpBridge,
      conversation, adversarial training) pick it up automatically
    - Refactor: added DEFAULT_RULES + scoreContentWithRules +
      getActiveRules/setActiveRules/resetActiveRules + serialize/deserialize
      so rules are mutable JSON-safe objects that can be evolved
32. Attack Evolve — co-evolution counterpart to Layer 31
    - Evolves attack strings to DODGE the current active firewall
    - String-level mutations: inject-benign (wrap in "just FYI..." framing),
      soften-synonyms (urgent→time-sensitive, scandal→incident, etc),
      letter-split (u-r-g-e-n-t breaks \b boundaries), reorder sentences,
      drop-trigger, crossover-attacks
    - Fitness = evasion × continuity: child must still resemble an attack
      (≥25% shared content words with parent) — prevents trivial "replace
      with benign text" solutions
    - "Promote to red team corpus" injects evolved attack into Layer 25
      corpus — next Layer 31 evolution round must catch it
    - Seeds from selected categories (combo/urgency/outrage/fear/certainty)
    - Closes the arms race: Layer 31 defense ↔ Layer 32 offense
    - Refactor: ATTACK_CORPUS now mutable + addCustomAttack +
      resetAttackCorpus; _ATTACK_CORPUS_DEFAULTS preserved as source of truth
33. Multimodal RAG Router — cannibalized from HKUDS/RAG-Anything
    - Content-type classification: text / image / table / equation / code
    - Per-modality handlers render each item into embeddable text
    - Image → Gemma 4 vision caption (Layer 5), Table → row-level sentences,
      Equation → symbol set + LaTeX, Code → identifiers + comments
    - belongs_to hierarchy edges (doc → section → block) for Layer 34
    - Modality-weighted cosine retrieval, BM25 fallback
    - Direct content insertion API (insertContentList) accepts pre-parsed JSON
    - Brain mapping: CTX rises with images, PFC with tables/equations/code
    - All in-browser, no LightRAG / MinerU / LibreOffice
34. Vector-Graph Fusion — reranks Layer 33 with graph coherence
    - Builds lightweight graph from belongs_to hierarchy + sequence adjacency
    - Runs Layer 20 Louvain community detection over item graph
    - For each cosine hit, pulls in siblings (same doc/section),
      sequence neighbors, and Louvain community members
    - RRF-style weighted fusion: (1−w)×vectorScore + w×graphScore
    - Graph weight slider (0–80%) in panel; default 35%
    - Brain mapping: BG lights up on structured recall (graph pulls)
35. Direct Content Insertion — JSON paste for external parsers
    - Accepts [{ type, docTitle, section?, ...payload }] arrays
    - Validates schema client-side before insert
    - Appends to existing Layer 33 index or creates a new one
    - Schema reference for MinerU / Docling / Obsidian / MCP tool output
    - No markdown parsing needed — structured JSON straight in
36. Autopsy Mode — per-speaker cognitive profile from any transcript
    - Reuses Layer 22 parser (Speaker: text / JSON / blank-block formats)
    - Each message scored via Cognitive Firewall, rolled up per speaker
    - Output: avg pressure, peak quote, dominant affect (fear/outrage/
      urgency/certainty/belonging/shame/awe/neutral), turn count
    - URL fetcher pre-fills from article/thread links
    - Shareable /a/<hash> card with title + 5 top speakers as bars +
      overall pressure tier (Steady / Tilted / Heavy / Hostile)
    - Answers "which speaker installed which feelings in whom"
    - localStorage handle shared with immunity + quiz + bypass loops
37. Cognitive Fragments — Obsidian-style dense 3D micro-neuron cloud
    - ~240 fragments across 7 regions (CTX densest), gaussian-clustered
    - Intra-region nearest-neighbor edges (each fragment → 2 siblings)
    - Sparse cross-region threads between nearby region centers
    - Single InstancedMesh draw call + single LineSegments geometry,
      positions breathe each frame, scale + color modulate with region
      activity
    - Quality tiers: ultra/high full density, low skipped entirely
38. Daily Firewall Challenge — 3 items per UTC day, global leaderboard
    - 40-item corpus rotates via day-of-year; everyone sees the same
      three items on any given UTC day
    - Slider 0-100 per item; correct = within ±20 of truth score
    - Streak stored in localStorage (brainsnn_daily_streak_v1)
    - Shareable /d/<hash> card with date + handle + correct/3 +
      accuracy + streak; tier = Off day / Warm-up / Solid / Sharp
      eye / Clean sweep
    - Duolingo-style daily return loop
39. Propaganda Templates — named manipulation technique detection
    - 15 templates: gaslighting, DARVO, love bombing, scarcity, social
      proof, authority name-drop, loaded question, straw man, whatabout-
      ism, false dichotomy, fear appeal, hidden-truth conspiracy, moral
      outrage bait, purity test, guilt trip
    - detectTemplates(text) returns [{id,label,desc,hits}]
    - Extends scoreContent() output with .templates — surfaces as
      chips in the Cognitive Firewall panel beneath Evidence traces
40. Sentence Heatmap — per-sentence pressure annotation
    - Splits text into sentences (terminator-aware), scores each
    - pressureBand() tiers into Calm/Low/Tilted/Heavy/High with color
    - Inline heatmap view in the Firewall panel — toggle to reveal
    - Shows mean, peak, and count of high-pressure sentences
    - Answers "which exact sentence is doing the damage"
41. Refutation Library — counter-response per propaganda template
    - 15 refutations (core stance + copy-ready script + meta-stance)
      keyed to Layer 39 template IDs
    - Template chips in the Firewall panel become clickable; opening
      one reveals the refutation with a Copy-response button
    - Shifts the tool from "diagnosis" to "diagnosis + prescription"
42. Counter-Draft — neutralize manipulative text with before/after
    - Local substitution path: ~40 regex rules rewrite urgency,
      outrage, certainty, fear, CAPS-LOCK vocabulary to neutral
      equivalents
    - Gemma path (when VITE_GEMMA_API_ENDPOINT configured): asks the
      model for a neutral rewrite; falls back to local on any error
    - Before/after scored through the Firewall, reduction reported
      as -N pts
    - Shareable /x/<hash> card with before / after quote blocks and
      5-tier verdict (Stubborn / Nudged / Softened / Dampened /
      Fully neutralized)
43. Time-Series Autopsy — manipulation pressure over time
    - Date-aware line parser accepts ISO, slash-date, and "Mon DD YYYY"
      formats; undated lines fall into implicit order
    - Linear-regression slope → Escalating / Rising / Stable / Cooling
      / De-escalating trend label
    - Escalation detector flags any 3-window rolling spike > +25 pts
    - Shareable /t/<hash> card with bar-sparkline, trend tier, peak
      date, and escalation count
44. Inbox Mode — bulk message triage
    - Splits on ---/=== lines or From:/Subject: headers (or blank-
      line blocks as last resort)
    - Scores each message, sorts by pressure desc, extracts sender +
      subject + templates
    - inboxSummary(items) → {count, meanPressure, high, worst}
    - Shareable /n/<hash> anonymized card (localparts redacted,
      domains kept), top 5 messages + pressure tier
45. Semantic Templates — embedding-based manipulation detection
    - Re-uses Layer 24's MiniLM pipeline (transformers.js)
    - 2-3 canonical seed phrases per Layer 39 template, averaged and
      normalized into a single reference vector per technique
    - matchSemanticTemplates(text, 0.42) returns top-5 template hits
      by cosine similarity above the threshold
    - mergeTemplateResults(regex, semantic) unions the two, regex
      preferred when both fire for the same template
    - Catches paraphrases regex misses ("you're making it up" →
      gaslighting); semantic chips are outlined in cyan to
      distinguish from regex-purple
46. Firewall Receipts — deterministic, verifiable scan stamp
    - receiptCanonical({text, score, ts}) normalizes text + rounds
      scores + buckets timestamp to UTC day → stable canonical string
    - SHA-256 via SubtleCrypto (falls back to FNV-1a when Subtle is
      unavailable); rendered as R-XXXX-XXXX for copy-paste
    - verifyReceipt() re-hashes and returns {ok, expected, got}
    - Last 20 receipts stored in localStorage for a rolling log
    - Surfaces inline under every scan in the Firewall panel
47. Diff Mode — side-by-side comparison of two texts
    - runDiff({labelA,textA,labelB,textB}) scores both, reports delta,
      picks a "cleaner" winner (lower pressure)
    - diffVerdict(absDelta) tiers Tied / Edge / Clear / Landslide
    - Shareable /v/<hash> card with 2-column quote blocks, verdict
      chip, and Δ-pts badge
    - Perfect for candidate statements, pre/post-edit diffs, quoted-
      vs-summary framings
48. Ad Transparency — archetype combo detection
    - 7 archetypes: growth-hacker ad / phishing / political-attack /
      conspiracy-hook / cult recruitment / abusive-gaslighting /
      FOMO launch pitch
    - Each archetype = required templates + bonus templates + min
      match count. detectArchetypes(mergedTemplates) returns hits
      sorted by score
    - Surfaces as red-tinted chips in the Firewall panel beneath
      the template + semantic chips
    - Shifts "you have these templates" → "this reads like X genre"
49. Scan Anywhere — bookmarklet + deep-link contract
    - One-line JS bookmarklet grabs selection (or title+URL fallback)
      and opens /?scan=<text> in a new tab
    - Firewall panel accepts ?scan=<text> and ?scan-url=<url> on
      mount to pre-fill the textarea / URL input
    - ScanAnywherePanel in-app documents the full deep-link contract
      (every /?<letter>=<hash> rehydration is listed)
    - Turns any page on the web into a Firewall input
50. Weekly Recap — local-only stats rolled into a share card
    - computeWeeklyRecap() reads Immunity + DailyChallenge + Receipts
      localStorage, computes delta vs 7-day-ago baseline, event
      counts, mean pressure, daily-play stats
    - Shareable /w/<hash> card with 6 stat tiles + handle + delta
      badge. Private data stays private unless user taps Share
51. Style Fingerprint — stylometric signature + author-match
    - 12-dim vector per text: sentence-length distribution, function-
      word frequency, commas/sentence, semicolons/1k, caps runs,
      exclamations, ellipsis, em-dash, avg word length, hedging rate
    - compareFingerprints() → cosine similarity; verdict tiers
      Distinct / Weak / Plausible / Likely / Very likely same author
    - FingerprintPanel shows per-feature bar comparison so the user
      can see WHY two texts match or differ
52. Multi-lingual Firewall — Spanish + French pattern packs
    - LANGUAGE_PACKS { es, fr } mirror the 4 DEFAULT_RULES dimensions
    - detectLanguage(text) uses character-frequency + stopword
      heuristics to route between en / es / fr for short inputs
    - scoreContent() auto-selects the right pack when user hasn't
      manually set activeRules; falls back to English otherwise
    - Result object now carries .language + .languageLabel; shown as
      a badge next to the Gemma / Regex-fallback source tag
53. Echo Detector — coordinated-campaign signature finder
    - 5-word shingle Jaccard similarity → pairwise edges ≥ 0.35
    - Union-find clusters items into "script groups"
    - echoRisk() tier: Organic / Scattered / Partial / Coordinated
    - EchoPanel takes --- delimited messages, shows per-cluster
      exemplar quote + members
54. Public Scoring API — POST /api/score
    - Node-side Firewall (en/es/fr) + template detection + receipt
      generation, independent of the SPA bundle
    - 20 req/min/IP rate-limit (in-memory with bucketed counter)
    - Optional auth: BRAINSNN_PUBLIC_API_KEYS env accepts comma-list;
      default demo key 'demo-public-launch-key' for the landing
    - OpenAPI spec at /api/openapi.json
    - ApiDocsPanel in-app surface: key input + live "Try it" button
      that POSTs from the browser + cURL snippet for dev docs
55. Custom Rules Editor — user-defined Firewall regex
    - Add/remove/import/export rules per category
      (urgency/outrage/certainty/fear), persisted in localStorage
      (brainsnn_custom_rules_v1)
    - applyMergedRules() unions DEFAULT_RULES with user rules and
      promotes the combined set via setActiveRules() — every scan,
      quiz, autopsy, conversation, and adversarial round picks it up
    - Export as 'custom-rules-v1' JSON, portable between devices
56. Badge System — retroactive, deterministic progression
    - 13 badges across bronze/silver/gold tiers; computed from
      existing signals (immunity, streak, scan count, peak pressure,
      custom rules, polyglot, bypass submit) — no extra bookkeeping
    - Shareable /b/<hash> card with handle + earned/total ratio +
      badge-chip rack (earned tinted, locked grayed)
    - Duolingo-style progression without the annoying nags
57. Data Portability — export/import/wipe all BrainSNN localStorage
    - Scans every brainsnn_* key into a 'brainsnn-bundle-v1' JSON
      envelope. Download button + clipboard export + file-import
      + overwrite-existing toggle + wipe-all with confirm
    - Lets power users move state between devices and feel safe
      experimenting
58. Image OCR Firewall — screenshot → text → Firewall
    - tesseract.js loaded lazily from esm.sh CDN on first use so
      the main bundle stays slim
    - Paste (⌘V), drop, or pick a file; preview renders; progress
      bar tracks OCR; extracted text editable before handoff
    - "Scan in Firewall →" deep-links via /?scan=<text>
    - All in-browser — images never leave the device
59. Audio Firewall — Web Speech API live transcribe → scan
    - isSpeechSupported() + createSpeechSession() wrapper around
      SpeechRecognition (Chrome/Edge/Safari)
    - 7 language options (en-US/GB, es, fr, de, it, pt-BR)
    - Rolling Firewall score on the live transcript as it grows;
      "Scan in Firewall →" hands the final transcript to /?scan=
    - Graceful no-op in unsupported browsers (Firefox)
60. Firewall Macros — named preset scan suites
    - Each macro: name + array of sample texts + expected tier
      (auto/low/mid/high) + optional notes
    - runMacro() batch-scores against the active ruleset, reports
      per-sample pressure + mean + peak + "matches expectation"
      check
    - 3 seed macros on first run (Phishing suite / Wellness benign
      / Political attack) so users see the shape immediately
    - Pairs with Layer 55 for tweak-and-verify rule development
61. Firewall Diagnostic — self-audit the active ruleset
    - Runs every pattern against the red-team corpus + benigns
    - Reports F1 / detection rate / FPR / A-F grade at a chosen
      threshold, plus dead patterns (zero hits) and FP contributors
      (patterns that fire on benigns)
    - One-click audit for any ruleset — defaults, evolved, or the
      user's custom set — so you can see whether your tweaks
      helped or broke things
62. Hypothesis Mode — structured inquiry over evidence
    - State a suspicion (8 canned hypotheses: gaslighting, DARVO,
      love-bombing, guilt-trip, phishing, cult recruitment,
      political attack, high-pressure overall)
    - Paste evidence items separated by --- or blank lines
    - Each item scored for/against the hypothesis; aggregate
      confidence tiers to Supported / Mixed / Weak / Refuted
    - Turns the tool from diagnosis into structured belief testing
63. Context Memory — persistent per-entity scan tracking
    - Tag a scan with an entity name ("boss", "@handle", "Slack:john")
    - recordScan() appends to a flat rolling log (cap 500), with
      entity, ts, pressure, templates, and excerpt
    - ContextMemoryPanel shows per-entity rollup: mean pressure,
      peak, top templates, sparkline of pressure over time
    - Same Firewall scan that handles a single message now builds a
      long-term profile of the source
64. Debate Mode — two-speaker momentum + winner
    - analyzeDebate() picks the top-2 speakers by turn count, scores
      each turn, tracks cumulative per-speaker averages
    - Declares the "manipulation race winner" = speaker with the
      LOWER mean pressure
    - DebatePanel shows per-speaker header cards + cumulative-average
      line graph + peak-pressure turn callout
65. Firewall Replay — record / export / import scan sessions
    - pushStep(kind, ...) adds events from Firewall / Counter-Draft /
      Autopsy / sharing. startRecording/stopRecording/reset control
      the session. Cap 200 steps, localStorage-persisted.
    - exportReplay → 'brainsnn-replay-v1' JSON with title + steps.
      parseReplay validates version and surfaces steps in the panel.
    - Useful for demos ("here's me breaking the firewall"), bug
      reports, and rule-dev walkthroughs.
66. Coverage Heatmap — which pattern caught which word
    - coverageFor(text) walks every active regex, records all match
      spans + per-pattern hit count
    - tokenizeWithSpans() collapses overlaps into display tokens
    - CoveragePanel shows inline color-coded highlights (urgency/
      outrage/certainty/fear tints) + sorted list of fired patterns
    - Completes the rule-dev loop with Layer 55 + 61 + 60
