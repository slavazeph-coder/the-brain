# Layer 103 — Social Post Autopsy

Social Post Autopsy turns Instagram / TikTok / X / LinkedIn posts into a BrainSNN-native scan:

- Paste a post URL, caption, transcript, or visible post copy.
- Paste carousel OCR text manually or upload screenshots for local OCR.
- Detect platform, handle, viral mechanics, propaganda templates, and dominant affect.
- Produce a “viewer install” sentence: the feeling the post is trying to install and the mechanic carrying it.
- Map pressure by slide so the user can see where the carousel spikes.
- Copy the report, archive the scan, send the combined text to the Cognitive Firewall, or generate a public share card.
- Open a shared card and rehydrate the compact proof summary back inside the Social Post Autopsy panel.

## Why this layer exists

BrainSNN already had the core machinery: Cognitive Firewall, Affective Decoder, OCR, Scan Archive, Genre Classifier, and Multimodal RAG. What was missing was a social-native intake flow. A carousel post is not just text; it is a sequence of hooks. Layer 103 treats the whole post as a persuasion object, not a flat paragraph.

## Inputs

| Field | Purpose |
| --- | --- |
| URL | Platform and handle hint. |
| Caption | Main visible copy or transcript. |
| Carousel OCR text | Slide/page text separated by `---` or labels like `Slide 1:`. |
| Screenshots | Optional image uploads; OCR runs locally through the existing Layer 58 tesseract path. |

## Output

The report includes:

- Platform and inferred handle.
- Pressure score and tier.
- Viewer-install sentence.
- Dominant affects from Layer 29.
- Viral mechanics such as curiosity gap, hidden-truth framing, identity sorting, comment bait, urgency-save, serial cliffhanger, and authority-without-citation.
- Propaganda templates from Layer 39.
- Per-slide pressure map.
- Recommended verification checks.
- Share card URLs for public previews and vertical social image export.

## Share cards

Layer 103 adds a dedicated viral card flow:

| Route | Purpose |
| --- | --- |
| `/s/<hash>` | Public HTML shell with OG/Twitter metadata for a Social Post Autopsy result. Redirects back into the app with `?s=<hash>`. |
| `/?s=<hash>` | App rehydration route. The Social Post Autopsy panel shows the shared proof summary and lets the viewer copy the card or vertical image. |
| `/api/social-og?h=<hash>` | 1200×630 PNG image card for link previews. |
| `/api/social-og?h=<hash>&size=vertical` | 1080×1920 vertical card for TikTok/Reels/Stories share surfaces. |

The share payload is intentionally compact and does not expose the full post text. It includes the platform label, handle, pressure, core score dimensions, dominant affect, viewer-install sentence, top viral mechanics, a short caption excerpt, and up to five slide pressure values.

## Integration

The panel is mounted under the existing OCR panel so social screenshots naturally flow into the scanner. The utility lives in:

- `brainsnn-r3f-app/src/utils/socialPostAutopsy.js`
- `brainsnn-r3f-app/src/components/SocialPostAutopsyPanel.jsx`
- `brainsnn-r3f-app/viral/social-card.js`

The Node server wires:

- `GET /s/:hash`
- `GET /api/social-og`

Layer Explorer includes Layer 103, so it can be found by searching `social`, `Instagram`, `carousel`, `TikTok`, or `103`.
