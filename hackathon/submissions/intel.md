# Knowledge Brain — Vector + Graph + Trust + Echo for Enterprise RAG

**Track**: Enterprise Data Intelligence
**Live**: https://brainsnn.com (Knowledge Brain + Multimodal RAG + Echo Detector)
**Repo**: https://github.com/slavazeph-coder/the-brain (branch `hackathon-techex`)
**Demo video**: [MP4 link to be inserted post-recording] · 03:15 – 04:15

## The problem

Most enterprise RAG demos ship a vector store and a chat box. They
answer "find me documents that match this query." That's the easy
half.

The hard half:

- **Which of these documents are trustworthy?** A retrieval set that
  includes a manipulative source recommends manipulation, downstream.
- **How do these documents connect to each other?** Pure vector
  similarity misses attack-class community structure that humans
  notice immediately.
- **Are these results genuinely diversified, or am I looking at one
  talking point repackaged four times?** Coordinated content
  campaigns and Wikipedia-style coordinated edits look like
  diverse evidence to a vector search.
- **What's locked inside the figures, tables, equations, and code
  blocks?** Half the value of enterprise documents — Gartner
  reports, 10-Ks, research papers — is non-text.

## The solution

**BrainSNN ships vector + graph + trust + echo as four layers of one
engine**, all in the browser, with embeddings running locally via
transformers.js.

- **Layer 18 Knowledge Brain** — LLM-Wiki framework over an
  in-browser embedding store (transformers.js). Obsidian vault
  import. Gap analysis flags missing knowledge domains.
- **Layer 33 Multimodal RAG** — extracts images, tables, equations,
  and code blocks from PDFs/Markdown into the same retrieval graph.
  Vision-language captions for figures (via Gemma 4) become
  embeddable text.
- **Layer 34 Vector-Graph Fusion** — community detection over the
  document graph reranks vector hits by structural coherence.
  Surfaces documents that share _attack-class community membership_
  even when keywords don't overlap.
- **Layer 28 Neuro-RAG** — brain-region-tagged retrieval. Find
  documents that route through the same cognitive systems
  (e.g., all the "authority bypass" content even if it's worded
  differently).
- **Layer 53 Echo Detector** — 5-gram Jaccard clustering surfaces
  coordinated campaigns inside the retrieval set. Returns an
  `echoRisk` tier (low/medium/high) with cluster membership.
- **Trust filter** — Cognitive Firewall doubles as a retrieval
  filter. Manipulative sources downranked or shown with provenance
  caveats automatically.

## Architecture talking points

- **In-browser embeddings**: transformers.js runs the embedding
  model client-side. Document content **never leaves the device**
  unless you explicitly opt into Gemma vision for figure captions.
- **Multimodal extraction**: figures + tables + equations + code
  blocks all become first-class retrieval targets, not lost
  context.
- **Trust as a retrieval signal**: same Cognitive Firewall scoring
  the Security and Enterprise submissions use, applied to retrieval
  candidates.
- **Echo detection at retrieval time**: tells the user "these 4 hits
  are essentially the same talking point repackaged" before they
  build a decision on it.
- **MCP integration** (Layer 19): your in-house Claude / Codex /
  Gemini agents can query the trust-filtered, echo-aware corpus
  through a single MCP tool call.

## Why this matters at TechEx scale

- **Enterprise search teams** get vector + graph + trust + echo in
  one pipeline, with embeddings running locally — no document
  content leaves the browser.
- **Knowledge management** gets multimodal extraction (image,
  table, equation, code) into the same retrieval surface that
  text uses.
- **Compliance / risk teams** get echo detection flagging
  coordinated content campaigns inside the retrieved set — a
  defense against astroturf, prompt-injection content farms,
  and coordinated edits.
- **Anomaly detection**: cognitive firewall scoring over the
  retrieved set surfaces documents that don't fit the rest of the
  corpus on trust dimensions — a different anomaly signal from
  semantic outliers.
- **Code Brain (Layer 20)** + **Conversation Brain (Layer 22)**
  apply the same architecture to code repositories and
  Slack/email/Discord threads. **One engine, three corpus types**,
  unified retrieval + trust layer for the enterprise text + code +
  chat surface.

## Reproduce locally

```bash
git clone https://github.com/slavazeph-coder/the-brain.git
cd the-brain && git checkout hackathon-techex
npm install --prefix brainsnn-r3f-app
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173, scroll to Knowledge Brain
```

Sample documents:
[hackathon/demo-corpus/intel-corpus/](https://github.com/slavazeph-coder/the-brain/tree/hackathon-techex/hackathon/demo-corpus/intel-corpus).
The 17 hackathon demo-corpus samples themselves form a trust-tagged
mini-corpus you can query.

Demo flow:
[hackathon/scenarios/data-intelligence-knowledge-brain.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/scenarios/data-intelligence-knowledge-brain.md).
