---
track: intel
title: "Knowledge Brain — Vector-Graph Fusion for Enterprise RAG"
duration_min: 5
existing_layers: [18, 20, 28, 33, 34, 53]
existing_components:
  - brainsnn-r3f-app/src/components/KnowledgeBrainPanel.jsx # Layer 18 LLM-Wiki + Obsidian import
  - brainsnn-r3f-app/src/components/CodeBrainPanel.jsx # Layer 20 code-aware brain
  - brainsnn-r3f-app/src/components/NeuroRagPanel.jsx # Layer 28 neuro-RAG
  - brainsnn-r3f-app/src/components/MultimodalRagPanel.jsx # Layer 33 image/table/equation/code
  - brainsnn-r3f-app/src/components/EchoDetectorPanel.jsx # Layer 53 coordinated-campaign detection
  - brainsnn-r3f-app/src/utils/multimodalRag.js # Layer 33 + Layer 34 vector-graph fusion
  - brainsnn-r3f-app/src/utils/cognitiveFirewall.js # baseline scorer used as anomaly signal
new_work:
  - hackathon/demo-corpus/intel-corpus/ # 5-10 documents (PDF + MD) for live RAG demo
  - Optional: pre-cached embedding index in hackathon/cache/intel-embeddings.json
demo_corpus_anchors:
  - The 17 hackathon demo-corpus samples themselves form a "trust-tagged" mini-corpus
  - SCORING_REPORT.md as a structured analytical document
verified_against_live:
  date: 2026-05-06
  scoring_anchor: hackathon/SCORING_REPORT.md
notes: |
  This scenario uses the existing 17-sample corpus + the SCORING_REPORT
  as its initial document set, so the demo doesn't depend on importing
  external docs. Codex can extend hackathon/demo-corpus/intel-corpus/
  with real PDFs (a Gartner report, a 10-K excerpt, an Obsidian vault
  snapshot) for a more enterprise-flavored demo.
---

# Enterprise Data Intelligence Track — Knowledge Brain

## The hook (15 sec)

> Most enterprise RAG demos ship a vector store + a chat box. They
> answer "find me docs that match this query." That's the _easy_ half.
>
> The hard half: **which of those docs are trustworthy, how do they
> connect to each other, and is what you're seeing the result of one
> source — or a coordinated campaign?**
>
> BrainSNN ships **Vector + Graph + Trust + Echo** as four layers of
> the same engine. Embeddings find candidates; graph reranks for
> coherence; trust scoring filters by manipulation risk; echo
> detection flags coordinated content campaigns. All in the browser.

## The setup (30 sec)

`brainsnn.com` Knowledge Brain (Layer 18), Multimodal RAG (Layer 33),
Neuro-RAG (Layer 28), and Echo Detector (Layer 53) sections in view.

A pre-loaded mini-corpus: the 17 demo-corpus samples + SCORING_REPORT

- 3 added Gartner-style enterprise PDFs (in `intel-corpus/`).

## The demo (3 min)

### Beat 1 — Vector + graph fusion outperforms either alone (60 sec)

Type query into Knowledge Brain: **"What attack patterns target
authority bypass and procedural override?"**

**Vector-only baseline** (Layer 18 standalone):

- Top 3 hits: phishing-002 (CEO BEC), business-001 (CSR defense),
  marketing-004 (outrage ad)
- Cosine score range: 0.71 - 0.83

**Graph reranking on** (Layer 34 fusion):

- Top 3 reranks to: phishing-002 (CEO BEC), phishing-005 (recruiter
  trojan), business-001 (CSR defense)
- Why: business-001 and phishing-002 both reference "authority"
  framing; phishing-005 connects via shared
  "executable-attachment-paired-with-flattery" community even though
  it doesn't share top-line keywords

**Punchline**: "Vector search finds _similar_ documents. Graph
reranking finds documents that share _attack-class community
membership_ in the cognitive-pattern graph. **Five business teams
will read 'CEO authority bypass' three different ways. The graph
knows they're the same attack class.**"

### Beat 2 — Multimodal RAG over a Gartner PDF (45 sec)

Drop a Gartner-style "AI in Enterprise" PDF into Multimodal RAG
(Layer 33). The pipeline:

1. **Image extraction** → vision-language captions for every figure
   (Gemma 4)
2. **Table extraction** → tabular schema preserved as Markdown
3. **Equation extraction** → LaTeX preserved
4. **Code-block extraction** → syntax-tagged

Query: **"What does the Gartner research say about RAG accuracy?"**

Top hits include a _figure caption_ ("Figure 4: enterprise RAG
accuracy by retrieval strategy") that vector search alone wouldn't
have surfaced because the original PDF text doesn't restate the
figure data.

**Punchline**: "Most enterprise documents have **half their value
locked inside images, tables, and equations**. Layer 33 unlocks
those modalities into the same retrieval graph."

### Beat 3 — Trust filter + echo detection (60 sec)

Same query, but now toggle on **Trust filter** (cognitive firewall
applied to retrieval candidates):

- Top result drops phishing-002 (manipulation pressure 0.71 with
  intent classifier on)
- Re-ranks to: SCORING_REPORT.md, business-001 (with provenance
  caveat shown), Gartner figure caption.

Then click **Echo Detector** (Layer 53) on the original retrieval
candidates. Layer 53 runs 5-gram Jaccard clustering across the
candidate set:

- Echo Risk: **MEDIUM**
- 3 of 17 samples cluster into a "phishing-attack-pattern"
  community (phishing-001, phishing-002, phishing-005)
- 4 marketing samples cluster as "marketing-pressure-spectrum"
- Result: "Retrieval set is multi-source; no single coordinated
  campaign signature."

**Punchline**: "**Trust-filtered retrieval** means your RAG doesn't
hand a user advice from a manipulative source. **Echo detection**
means your RAG can tell the user 'these 4 hits are essentially the
same talking point repackaged' instead of presenting it as
diversified evidence."

### Beat 4 — Code Brain + Conversation Brain (15 sec)

Quick scroll to **Code Brain** (Layer 20) + **Conversation Brain**
(Layer 22). Same architecture, different corpus types: Code Brain
indexes a repo (e.g., `the-brain` itself), Conversation Brain
indexes Slack/Discord/email threads.

**Punchline**: "Same engine. Three corpus types. One unified
retrieval and trust layer for the entire enterprise text + code +
chat surface."

## The close (60 sec)

> Why this matters at TechEx scale:
>
> - **Enterprise search teams** get vector + graph + trust filtering
>   in one pipeline, with embeddings running locally
>   (transformers.js) — no document content leaves the browser.
> - **Knowledge management** gets multimodal extraction (image,
>   table, equation, code) into the same retrieval surface.
> - **Compliance / risk teams** get **echo detection** flagging
>   coordinated campaigns inside the retrieved set — a defense
>   against Wikipedia-style coordinated edits, astroturf
>   campaigns, and prompt-injection content farms.
> - **The cognitive firewall** doubles as a **trust filter on
>   retrieval** — manipulative sources downranked or shown with
>   provenance caveats, automatically.
> - **MCP integration** exposes Knowledge Brain to Claude Code /
>   Codex / Gemini directly — your in-house agents can query the
>   trust-filtered corpus through a single tool call.

## Stage flow checklist

- [ ] `intel-corpus/` populated with 3-5 enterprise-flavored PDFs
- [ ] Embedding index pre-built (so the demo doesn't wait for
      transformers.js init)
- [ ] Knowledge Brain, Multimodal RAG, Neuro-RAG, Echo Detector
      panels reachable without long scrolls
- [ ] Code Brain seeded with `the-brain` repo
- [ ] Trust filter toggle visible in Knowledge Brain panel header

## Risks & fallbacks

- **transformers.js cold start ~10s** → pre-warm with a dummy query
  before recording starts
- **Multimodal RAG vision pipeline relies on Gemma 4 keys** —
  confirm Railway env var; fall back to text-only RAG if needed
- **PDF parser fails on a specific Gartner-style PDF** → keep 3
  alternates ready; don't depend on a single PDF working
- **Echo Detector requires multiple samples to demonstrate** — 17
  corpus samples + 3 PDFs is enough to show clusters
- **Demo runs over 5 min** → cut Beat 4 (Code Brain mention)

## Lablab.ai write-up framing

Title: **"Knowledge Brain — Vector + Graph + Trust + Echo for
Enterprise RAG"**

Hero claim: **"Most enterprise RAG ships embeddings and a chat box.
BrainSNN's Knowledge Brain ships vector retrieval, graph reranking,
cognitive trust filtering, and coordinated-campaign echo detection
— in the browser, with embeddings running locally via
transformers.js."**

Architecture talking points:

- Layer 18 Knowledge Brain: in-browser embeddings (transformers.js)
  - LLM-Wiki framework
- Layer 33 Multimodal RAG: image + table + equation + code-block
  extraction routed through Gemma 4 vision
- Layer 34 Vector-Graph Fusion: community detection over the
  document graph reranks vector hits by structural coherence
- Layer 28 Neuro-RAG: brain-region-tagged retrieval (find documents
  that route through the same cognitive systems)
- Layer 53 Echo Detector: 5-gram Jaccard clustering surfaces
  coordinated campaigns in the retrieval set
- Cognitive Firewall doubles as trust filter on retrieval candidates
- MCP server exposes the whole pipeline to Claude / Codex / Gemini

Live URL: https://brainsnn.com (Knowledge Brain + Multimodal RAG +
Echo Detector sections)
GitHub: https://github.com/slavazeph-coder/the-brain branch
`hackathon-techex`
Verification: `hackathon/SCORING_REPORT.md`
