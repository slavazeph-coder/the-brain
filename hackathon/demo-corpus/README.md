# Demo Corpus

Input samples used in stage demos. Each sample is a single Markdown file
with YAML frontmatter so we can batch-process the corpus through
Cognitive Firewall, Gemma 4 multimodal, or XIO-Evolve evaluators.

## Frontmatter schema

```yaml
---
id: phishing-001
track: security # security | enterprise | agentic | physical | intel
modality: text # text | image | audio | video | mixed
expected_dominant_region: AMG # one of CTX HPC THL AMG BG PFC CBL
expected_tribe:
  manipulationPressure: high
  trustErosion: high
  emotionalActivation: high
  cognitiveSuppression: medium
source: synthetic # synthetic | redacted-real | public-dataset
attribution: "" # if from a public dataset, cite here
notes: short description of why this sample is useful
---
(body of the sample below the frontmatter — text content, image alt-text,
audio transcript, etc.)
```

## Coverage target (by May 13)

- 6+ phishing samples (vary attack type: urgency, authority impersonation,
  fear, reward, scarcity)
- 4+ marketing samples (ranging from clean to high-pressure)
- 4+ robot voice prompts (calm, urgent, authority, manipulative)
- 3+ AR overlay scripts (instructional, alarming, biased)
- 3+ business scenarios (customer service, vendor pitch, internal memo)

## Where samples come from

- Synthetic samples Claude/Codex generate (most)
- Redacted real-world examples slavaz contributes (preferred for judging)
- Public datasets cited via `attribution`
