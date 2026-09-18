// The contract cannibalized from upstream: submit is POST /{model}, status is
// GET /requests/{id}/status. Same shape, but the base URL is our own plane
// instead of a third party's API, so this studio drives OUR 4090.
import { getModel, resolveWorkflows } from "../generation/catalog/index.js";
import { parseSettings } from "../generation/catalog/types.js";

// Our queue's states -> upstream's request lifecycle. Explicit on purpose: a
// status a client cannot render is indistinguishable from a stalled run.
export const STATUS_MAP = {
  queued: "queued",
  generating: "running",
  decoding: "running",
  "ready-for-review": "succeeded",
  failed: "failed",
  paused: "queued",
};

export function buildPlane(modelId, body = {}) {
  const entry = getModel(modelId);
  const prompt = String(body.prompt ?? "");
  if (!prompt.trim()) throw new Error("prompt is required");
  const settings = parseSettings(entry, body.settings || {});
  return { entry, plane: { model: entry.id, prompt: { text: prompt }, settings } };
}

export function submitGeneration(modelId, body, deps = {}) {
  const env = deps.env || {};
  let built;
  try {
    built = buildPlane(modelId, body);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
  const { entry, plane } = built;
  const wf = resolveWorkflows(entry, env);
  if (!wf.available) {
    // Refuse rather than accept work we cannot render. This is the whole point.
    return { status: 503, body: { error: "workflow_unconfigured", model: entry.id, missing: wf.missing } };
  }
  if (typeof deps.submit !== "function") return { status: 500, body: { error: "control_plane_unavailable" } };
  const result = deps.submit({
    kind: "video",
    payload: { prompt: plane.prompt.text, settings: plane.settings, bindings: wf.bindings },
    idempotencyKey: body.idempotencyKey,
  });
  return { status: result && result.duplicate ? 200 : 201, body: result };
}

export function readRequest(id, deps = {}) {
  const job = typeof deps.find === "function" ? deps.find(id) : null;
  if (!job) return { status: 404, body: { error: "unknown_request", id } };
  return {
    status: 200,
    body: {
      id: job.id,
      model: job.model || null,
      status: STATUS_MAP[job.status] || "queued",
      rawStatus: job.status,
      outputs: job.artifacts || [],
    },
  };
}
