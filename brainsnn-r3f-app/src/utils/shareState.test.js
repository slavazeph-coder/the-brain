import { describe, it, expect, beforeEach } from "vitest";
import { encodeState, decodeStateFromHash } from "./shareState";

describe("shareState codec", () => {
  const sample = {
    regions: { THL: 0.5, PFC: 0.3, HPC: 0.42 },
    weights: { "THL->PFC": 0.7, "PFC->CTX": 0.55 },
    scenario: "Executive Override",
    tick: 42,
    selected: "PFC",
  };

  beforeEach(() => {
    window.location.hash = "";
  });

  it("round-trips brain state through the URL hash", () => {
    window.location.hash = "state=" + encodeState(sample);
    expect(decodeStateFromHash()).toEqual({
      regions: sample.regions,
      weights: sample.weights,
      scenario: sample.scenario,
      tick: sample.tick,
      selected: sample.selected,
    });
  });

  it("encodes to a parseable base64 payload", () => {
    const parsed = JSON.parse(atob(encodeState(sample)));
    expect(parsed).toMatchObject({
      r: sample.regions,
      s: sample.scenario,
      t: sample.tick,
      sel: sample.selected,
    });
  });

  it("returns null when the hash has no state= prefix", () => {
    window.location.hash = "#somethingElse";
    expect(decodeStateFromHash()).toBeNull();
  });

  it("returns null (does not throw) for a malformed payload", () => {
    window.location.hash = "state=%%%not-valid-base64%%%";
    expect(decodeStateFromHash()).toBeNull();
  });

  it("encodeState returns '' instead of throwing on un-encodable input", () => {
    // btoa() throws on characters outside Latin1 (e.g. an emoji in the
    // scenario name) — encodeState must swallow that and return "".
    expect(
      encodeState({
        regions: {},
        weights: {},
        scenario: "🔥 burst",
        tick: 0,
        selected: "THL",
      }),
    ).toBe("");
  });
});
