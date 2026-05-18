# Layer 103 — Social Post Autopsy

Social Post Autopsy turns Instagram / TikTok / X / LinkedIn posts into a BrainSNN-native scan:

- Paste a post URL, caption, transcript, or visible post copy.
- Paste carousel OCR text manually or upload screenshots for local OCR.
- Detect platform, handle, viral mechanics, propaganda templates, and dominant affect.
- Produce a “viewer install” sentence: the feeling the post is trying to install and the mechanic carrying it.
- Map pressure by slide so the user can see where the carousel spikes.
- Copy the report, archive the scan, or send the combined text to the Cognitive Firewall.

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

## Integration

The panel is mounted under the existing OCR panel so social screenshots naturally flow into the scanner. The utility lives in:

- `brainsnn-r3f-app/src/utils/socialPostAutopsy.js`
- `brainsnn-r3f-app/src/components/SocialPostAutopsyPanel.jsx`

Layer Explorer includes Layer 103, so it can be found by searching `social`, `Instagram`, `carousel`, `TikTok`, or `103`.
