// Our 4090's real capability, declared. This replaces upstream's Kling/Sora/Veo
// catalog with the one generator we actually own and can prove.
//
// Verified stack (handoff house-fpv-recovery.md): Wan 2.2 I2V 14B high/low
// FP8-scaled, UMT5 FP8, Wan 2.1 VAE, matching Lightx2v 4-step LoRAs. All six
// files passed upstream LFS SHA256. Manifest: house-reel/wan/models.json and
// remote /workspace/slava/comfy-house/wan-models.json.
//
// A pinned workflow id is NEVER written here. It comes from the environment.
// Without it a model reports unavailable instead of accepting work it cannot run.
import { booleanField, enumField, rangeField } from "./types.js";

const segmentSettings = {
  aspectRatio: enumField(["16:9", "9:16"], "9:16"),
  steps: enumField(["4"], "4"), // Lightx2v is a 4-step LoRA; not a free knob
  cfgScale: rangeField(0, 2, 1, 0.05),
  shift: rangeField(0, 10, 5, 0.1),
  seed: rangeField(0, 2147483647, 0, 1),
  segments: rangeField(1, 12, 1, 1),
};

export const wan22I2V = {
  id: "wan-2.2-i2v-14b-fp8",
  surface: "video",
  label: "Wan 2.2 I2V 14B (FP8, 4-step)",
  roles: { start: 1 },
  settings: segmentSettings,
  workflowEnv: ["WAN22_WORKFLOW_ID"],
};

export const wan22I2VCpuVae = {
  id: "wan-2.2-i2v-14b-fp8-cpu-vae",
  surface: "video",
  label: "Wan 2.2 I2V 14B (CPU-VAE decode)",
  roles: { start: 1 },
  settings: segmentSettings,
  // The memory-safe split graph: SaveLatent, then LoadLatent -> CPU-VAE decode.
  // Needs both stages pinned; a half-configured pair is refused, not guessed.
  workflowEnv: ["WAN22_WORKFLOW_ID", "WAN22_DECODE_WORKFLOW_ID"],
};

// The local half. No GPU, no network, and it is the only stage that has ever
// delivered a finished artifact, so it is declared like any other model.
export const reelAssemble = {
  id: "reel-assemble",
  surface: "video",
  label: "Reel assembler (local, no GPU)",
  roles: { video: 12 },
  settings: {
    captions: booleanField(true),
    captionWords: rangeField(1, 4, 2, 1),
    aspectRatio: enumField(["16:9", "9:16"], "9:16"),
  },
  workflowEnv: [],
};
