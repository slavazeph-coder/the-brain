import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseGeminiAnalysis } from "./gemini-server.js";

describe("parseGeminiAnalysis", () => {
  it("clamps out-of-range values and shapes the result", () => {
    const r = parseGeminiAnalysis(
      '{"emotionalActivation":1.5,"cognitiveSuppression":-0.2,"manipulationPressure":0.7,"trustErosion":0.4,"evidence":["a","b"],"reasoning":"x","confidence":"high","recommendedAction":"y"}',
    );
    expect(r.emotionalActivation).toBe(1);
    expect(r.cognitiveSuppression).toBe(0);
    expect(r.manipulationPressure).toBeCloseTo(0.7);
    expect(r.confidence).toBe("high");
    expect(r.evidence).toEqual(["a", "b"]);
    expect(r.source).toMatch(/^gemini:/);
  });

  it("strips markdown fences before parsing", () => {
    const r = parseGeminiAnalysis('```json\n{"manipulationPressure":0.5}\n```');
    expect(r.manipulationPressure).toBe(0.5);
    expect(r.confidence).toBe("medium"); // default when absent
  });
});

describe("analyzeWithGeminiServer", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("throws (so callers fall back to regex) when no key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const m = await import("./gemini-server.js");
    expect(m.isGeminiServerConfigured()).toBe(false);
    await expect(m.analyzeWithGeminiServer("hello world")).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it("scores via Gemini when configured (mocked transport)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotionalActivation":0.2,"cognitiveSuppression":0.1,"manipulationPressure":0.3,"trustErosion":0.15,"evidence":["in fact"],"reasoning":"calm","confidence":"medium","recommendedAction":"fine"}',
                },
              ],
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const m = await import("./gemini-server.js");
    const r = await m.analyzeWithGeminiServer("some neutral text");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain(
      "generateContent?key=test-key",
    );
    expect(r.manipulationPressure).toBeCloseTo(0.3);
    expect(r.source).toMatch(/^gemini:/);
  });

  it("throws on a non-OK Gemini response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => "quota",
      })),
    );
    const m = await import("./gemini-server.js");
    await expect(m.analyzeWithGeminiServer("x y z")).rejects.toThrow(/429/);
  });
});
