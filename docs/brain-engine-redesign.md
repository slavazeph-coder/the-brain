# BrainSNN Engine Redesign Notes

## Baseline Capture

Baseline screenshots were captured before the redesign in:

- `docs/brain-engine-redesign/baseline/desktop-1440x1000.png`
- `docs/brain-engine-redesign/baseline/desktop-1280x800.png`
- `docs/brain-engine-redesign/baseline/tablet-1024x768.png`
- `docs/brain-engine-redesign/baseline/tablet-768x1024.png`
- `docs/brain-engine-redesign/baseline/mobile-390x844.png`
- `docs/brain-engine-redesign/baseline/mobile-360x800.png`

## Primary UX Failures Found

- The app opened as a stack of technical demonstrations instead of one clear publishing workflow.
- Primary results emphasized SNN and physics language before plain business outcomes.
- Scan, rewrite, history, approval, export, pricing, and research features competed for attention in the same surface.
- Mobile inherited desktop density, causing small labels, heavy scrolling, and weak result hierarchy.
- Share links implied durable public results even though the route did not retrieve persisted scans.
- Commercial CTAs included simulated checkout behavior before real billing existed.
- The brain visual remained distinctive but needed clearer metric mapping, responsive sizing, pausing, and accessible alternatives.

## Product Refactor Direction

The redesigned app now opens into Cortex and follows:

`SCAN -> DIAGNOSE -> IMPROVE -> COMPARE -> APPROVE -> EXPORT -> LEARN`

The default UI uses plain-language content outcomes:

- Hook Strength
- Trust
- Urgency
- Emotional Charge
- Empathy
- Manipulation Risk
- Shareability
- Confidence

Raw technical values such as firing rate, plasticity, wave damping, and model metadata remain available in Technical Details and Research.

## API Contract

`POST /api/analyze` continues to return the required `AnalysisResult` shape:

- `id`
- `timestamp`
- `title`
- `rawContent`
- `contentType`
- `metrics`
- `attentionCurve`
- `riskRating`
- `riskDescription`
- `viralScore`
- `gaugeGapScore`
- `summary`
- `insights`
- `recommendations`
- `payloadType`
- `confidence`
- `crumbModelStats`
- `isFallback`

The frontend adds derived view models only; required backend fields are not renamed or made optional.

## Production vs Research Split

Production workflow:

- Cortex scan/composer/results
- Synapse rewrite and version comparison
- Memory local history
- Neural Queue local approval statuses
- Export/share assets and reports

Research workflow:

- SNN technical metadata
- Crumb and physics language
- Benchmarks framed as experimental estimates
- Legacy advanced lab source preserved for future reintegration

## Theme Source

The attached BrainSNN workspace theme was used for the final color and font treatment:

- Deep black app backgrounds
- Cyan, purple, and indigo accents
- Inter for readable UI text
- JetBrains Mono for metrics/system labels
- Space Grotesk for display/product moments
- Subtle grid/scanline, glow, and animated status treatments

These theme additions preserve the existing BrainSNN identity while making the app and marketing site feel more interactive.
