# Browser-local speech-to-text V0.3

BrainSNN V0.3 adds optional browser-local speech-to-text to the multimodal video workflow so a client can upload a video and get a semantic timeline without manually preparing captions first.

## Product goal

The client flow is now:

1. Upload a video or screen recording.
2. BrainSNN samples visual change locally in the browser.
3. BrainSNN decodes a lightweight local audio energy/dynamics envelope when the browser codec permits it.
4. If local captions are enabled, BrainSNN runs Whisper locally in the browser and produces model-generated word timestamps.
5. The generated transcript is converted to BrainSNN timestamped lines.
6. BrainSNN classifies transcript beats such as claim, proof, price, CTA, and workflow.
7. Visual, audio, and semantic timing are fused into the existing client decision brief.
8. The result surfaces the primary issue, why it matters, the exact next edit, evidence anchors, and a moment-by-moment audit.

The important boundary is that local speech-to-text is a convenience and evidence-alignment layer, not a claim of measured human response.

## Runtime

The browser speech path lives in `src/lib/localTranscription.js`.

Current V0.3 defaults:

- Runtime: Transformers.js 3.8.1 loaded on demand from jsDelivr.
- ASR model: `Xenova/whisper-tiny.en`, selected because the export supports word-level timestamps in the current Transformers.js browser path.
- Input sample rate to Whisper: 16 kHz mono Float32 PCM.
- Preferred execution: WebGPU when `navigator.gpu` is available.
- Fallback execution: browser WASM/CPU.
- Inference output: word-level timestamps using `return_timestamps: "word"`.
- Chunking: 30-second chunks with a 5-second stride.
- Model instance: cached for the browser session so repeated scans do not reconstruct the pipeline unnecessarily.

The first local speech run can take noticeably longer because browser model/runtime files may need to be downloaded and cached.

## Data and privacy boundary

Raw media handling is deliberately split from the BrainSNN analysis request.

### Stays browser-local in V0.3

- source video file
- sampled video frames / pixel buffers
- decoded PCM audio
- Whisper waveform input

### Can enter the normal BrainSNN analysis request

- generated transcript text
- model-generated transcript timestamps represented as compact timestamped lines
- compact visual features
- compact audio energy/dynamics features
- local-ASR provenance metadata

This means “local speech-to-text” does not mean the generated transcript is never used by the BrainSNN API. It means raw audio/video are not sent to a speech service by this layer. The generated text becomes part of the content BrainSNN analyzes.

## Timing provenance

BrainSNN distinguishes three transcript timing origins.

### `supplied`

The operator supplied SRT, VTT, or explicit timecodes. The product can say the semantic timing follows the supplied transcript/captions.

### `local-asr`

Whisper generated word timing locally in the browser. These timestamps are useful review cues, but are model-generated rather than measured or user-supplied ground truth. Client-facing copy therefore says “near” or “local ASR timing” and asks the operator to verify important edit points against playback.

### `estimated`

The operator supplied plain transcript text without timecodes. BrainSNN distributes transcript sentences across the known video duration and explicitly labels this as estimated timing.

The client layer must not collapse these three cases into a generic “timed transcript” claim.

## User experience

The video input now includes:

- an `Auto-generate local captions` toggle, on by default unless the operator disables it
- a WebGPU / CPU-WASM capability label
- the current Whisper model label
- a manual `Generate local captions` action
- `Replace with local captions` when hand-entered text exists
- `Regenerate local captions` after a local transcript succeeds
- progress messaging for resampling, model loading/download, WebGPU fallback, transcription, and completion

If automatic speech-to-text fails, the successfully sampled visual/audio scan remains available. The operator can retry speech-to-text or paste supplied captions instead. A caption failure must not discard the video analysis.

## Resource limits

The browser path protects memory with the current V0.3 limits:

- video upload sampling limit: 180 MB
- local audio decode limit: 80 MB
- local audio/STT duration limit: 180 seconds

These are product safety/performance limits, not model limits. They can be revisited once real-device profiling is available.

## Client presentation rules

When the transcript comes from local ASR, the results UI must show:

- `LOCAL ASR TIMING`
- browser-local speech-to-text provenance
- current model and device when known
- word count
- a warning that timestamps are model-generated and require verification for critical edits

The recommendation engine can still say that proof appears after a claim, price appears before proof, or a CTA arrives before sufficient evidence. But it must not describe a local-ASR timestamp as an exact supplied caption timestamp.

## Failure modes

Expected fallbacks:

- Browser cannot decode audio: keep visual scan; show audio/STT unavailable.
- File is above browser audio limit: keep visual scan; do not attempt local audio/STT.
- Clip is longer than current local audio limit: keep visual scan; do not attempt local audio/STT.
- WebGPU pipeline fails: retry pipeline through the browser WASM/CPU path.
- WebGPU inference fails after the model loaded: rebuild the speech pipeline in browser WASM/CPU and retry inference once.
- Model/runtime download fails: keep visual/audio scan and let the operator retry or paste captions.
- Whisper returns no usable speech: keep visual/audio scan and surface the empty-speech result as an actionable error.
- Restored historical scan has no original File object: ask the operator to re-select the source video before regenerating local captions.

## Test strategy

### Automated application CI coverage

`src/lib/localTranscription.test.js` tests the deterministic pieces without downloading a real model:

- PCM resampling
- timestamp normalization
- word-to-segment grouping
- timed transcript formatting
- local-ASR provenance
- the complete transcription orchestration through an injected fake ASR pipeline
- use of word timestamps
- WebGPU inference failure falling back to browser WASM/CPU

`src/lib/multimodalClientFusion.test.js` tests the integration boundary:

- supplied timestamps stay `supplied`
- plain text stays `estimated`
- local Whisper timing becomes `local-asr`
- local-ASR timestamps are never marked measured
- client recommendations tell the operator to verify the generated timing
- packet/provenance records browser-local speech-to-text and the no-raw-audio-upload boundary

The normal BrainSNN CI runs TypeScript checking, the full test suite, a production build, and the MCP smoke test.

### Real-browser Whisper smoke

A separate `Whisper Browser Smoke` GitHub Actions workflow exercises the real browser runtime rather than a mock. It:

1. launches the Vite app in a GitHub Actions runner,
2. starts a real headless Chrome session,
3. downloads a known spoken WAV fixture,
4. downloads the actual Transformers.js Whisper model files,
5. runs real browser WASM inference with `return_timestamps: "word"`,
6. verifies a usable transcript, word timestamps, segment output, raw-audio privacy provenance, and completion state.

The smoke workflow exists specifically to catch failures that deterministic tests cannot, such as stale fixture URLs, incompatible model exports, CDN/runtime breakage, or missing timestamp support.

### Real-device smoke test

After deploy, still perform one real-device smoke with a short, clearly spoken English clip:

1. Open the BrainSNN video scan.
2. Leave `Auto-generate local captions` enabled.
3. Upload a 10–30 second clip with known spoken words.
4. Confirm visual and audio sampling completes.
5. Confirm first-run model progress appears.
6. Confirm a local transcript populates the transcript field.
7. Compare several words and timestamps against playback.
8. Run the multimodal scan.
9. Confirm the results badge says `LOCAL ASR TIMING`.
10. Confirm the client brief says timing is model-generated and requires verification.
11. Confirm a deliberately failed/no-audio file still leaves the visual scan usable.

Passing application CI proves the application logic/build contract. Passing the automated browser smoke proves the real model/CDN/headless-browser inference path. Passing a real-device smoke validates the deployed browser/device experience.

## Client demo script

For the cleanest demo:

1. Ask for one short ad or product video the client is uncertain about.
2. Upload it with local captions enabled.
3. While the model runs, explain that the raw video/audio stays in the browser and the speech model is running locally.
4. Once captions appear, quickly verify one or two phrases against playback.
5. Run the BrainSNN multimodal scan.
6. Open the decision brief first, not the 3D layers.
7. Show the claim/proof/price/CTA evidence chain and the exact next edit.
8. Ask BrainSNN a concrete question about the weakest window or claim-to-proof gap.
9. If available, repeat with Version B and compare which edit/version deserves spend.

## Next upgrades

V0.3 intentionally keeps the first implementation small. Logical next steps are:

- multilingual model selection for non-English creative
- optional `whisper-base` / larger model tiers on capable hardware
- moving local ASR into a Web Worker so long transcripts never compete with the React UI thread
- clearer cached-model / first-download state
- per-word confidence when the selected ASR runtime exposes a reliable value
- click-to-seek from evidence anchors into the local video preview
- background batch transcription for agency creative sets
- a provider adapter so the same transcript job can later route to a private GPU worker while preserving the same `local-asr`/provider provenance contract

The provider should remain replaceable. The durable product asset is the BrainSNN timeline, provenance, evidence, decision layer, and brand feedback loop—not a hard dependency on one speech model.
