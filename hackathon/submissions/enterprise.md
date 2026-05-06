# Cognitive Integrity for the Enterprise — Real-Time Manipulation Detection for CSR, Procurement, Internal Comms, and Brand Safety

**Track**: Enterprise Problem-Solving with AI Agents
**Live**: https://brainsnn.com (Cognitive Firewall + Counter-Draft + Persona Simulator + Immunity Dashboard)
**Repo**: https://github.com/slavazeph-coder/the-brain (branch `hackathon-techex`)
**Demo video**: [MP4 link to be inserted post-recording] · 04:15 – 04:45 + 00:18 – 01:30

## The problem

Every enterprise runs on text. Customer chat transcripts, vendor pitches,
internal memos, marketing copy, board updates. **Today there is no
objective measurement of how that text lands cognitively in the human
reading it.**

Four high-leverage failure modes:

- **Customer service reps** capitulate to social-engineered refund
  attempts under "I have your CEO's email" pressure
- **Procurement** signs vendor contracts after pitches that lean on
  fabricated authority and fear-of-falling-behind framing
- **Internal communications** (RTO mandates, layoffs, change
  announcements) ship without an audit for authority-flattery,
  decision-laundering, and dissent-suppression patterns
- **Brand safety / publishers** run outrage-bait creative because
  vibe-checking ad copy doesn't scale

We measured this against a corpus of 17 enterprise-realistic samples.
The deterministic regex baseline scored **business-001 (CSR
defense), business-002 (vendor pitch), and business-003 (RTO+layoff
memo) all at under 0.03 manipulation pressure** — completely
invisible. The hybrid baseline + LLM intent classifier surfaces
the manipulation in every case.

## The solution

**One engine, four enterprise faces**, all live at brainsnn.com:

- **Layer 4 + intent classifier** — real-time CSR defense. The CSR
  pastes the customer message; the firewall returns a brain-region
  fingerprint and named intent labels (e.g.,
  `authority-namedrop`, `outcome-fence`, `peer-priming`,
  `bystander-pressure`, `reputational-threat`). Maya the CSR can
  escalate with brain-region evidence _before_ she capitulates.

- **Layer 42 Counter-Draft** — drafts the de-escalating response
  back. Refuses peer-shaming, refuses authority-bypass, refuses
  reputational-threat, preserves the policy. ~4 seconds, brand
  voice preserved.

- **Layer 88 Persona Simulator** — same vendor pitch, scored through
  multiple reader personas. Procurement Director (Skeptical) reads
  it at 41% manipulation pressure; VP of Engineering
  (Eager-to-modernize) reads it at 83%. **Tells the team which
  persona is the actual target** so they can put a second pair of
  eyes on the meeting.

- **Layer 23 Cognitive Immunity Score** — organization-wide trust
  health metric. "127 attacks defended this week, immunity 76 of
  100." Trust becomes a measurable surface, not a vibe.

## Architecture talking points

- **Hybrid scoring** (deterministic baseline + LLM intent
  escalation) — same architecture as our Security submission. Cost-
  predictable, sub-200ms p50 for the regex layer.
- **Persona-aware**: Layer 88 reweights the firewall per reader role.
  Same content has different cognitive-vulnerability profiles per
  reader.
- **Counter-Draft over flag-only**: tools that just flag manipulation
  produce alert fatigue. Layer 42 ships a starting-point response
  the rep can edit and send.
- **Organization-wide rollup**: Layer 23 turns per-conversation
  scores into an immunity score that exec teams can track over time.
- **Local-first**: all sensitive content (chat transcripts, internal
  memos, vendor proposals) is processed in the browser. Optional LLM
  escalation is an explicit opt-in per scan.

## Why this matters at TechEx scale

- **Customer service**: real-time CSR defense against social
  engineering, with brain-region evidence the rep attaches to an
  escalation ticket.
- **Procurement**: every vendor inbound scored before review;
  Persona Simulator surfaces _which_ of your team members is the
  intended target.
- **Internal comms**: a measurement for "is this RTO memo
  manipulating staff?" — independent of authorial intent, before
  the all-hands.
- **Brand safety / publisher integrity**: every ad creative scored
  before placement; refuse outrage-bait at the policy layer.
- **Architectural reuse**: same Cognitive Firewall + Intent
  Classifier + Counter-Draft + Persona Simulator pipeline across
  four functions. One engine, one knowledge graph, one MCP
  integration surface for SIEM and BI tools.

## Reproduce locally

```bash
git clone https://github.com/slavazeph-coder/the-brain.git
cd the-brain && git checkout hackathon-techex
npm install --prefix brainsnn-r3f-app
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173
```

Try: paste any of the corpus samples at
[hackathon/demo-corpus/business-scenarios/](https://github.com/slavazeph-coder/the-brain/tree/hackathon-techex/hackathon/demo-corpus/business-scenarios)
into the Cognitive Firewall section. Scroll to Persona Simulator and
re-score with different personas.

Verified scoring methodology:
[hackathon/SCORING_REPORT.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/SCORING_REPORT.md).
Demo flow:
[hackathon/scenarios/enterprise-customer-service-defense.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/scenarios/enterprise-customer-service-defense.md).
