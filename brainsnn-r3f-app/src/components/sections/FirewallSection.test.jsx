import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub the panel children with light components that surface their callback
// props, so we can assert FirewallSection threads state/callbacks correctly
// without loading the real (heavy) panels.
vi.mock("../TribePanel", () => ({
  default: ({ mode }) => <div data-testid="tribe" data-mode={mode} />,
}));
vi.mock("../DailyChallengePanel", () => ({
  default: ({ initialHash }) => (
    <div data-testid="daily" data-hash={initialHash ?? ""} />
  ),
}));
vi.mock("../QuizPanel", () => ({ default: () => <div data-testid="quiz" /> }));
vi.mock("../CognitiveFirewallPanel", () => ({
  default: ({ onApplyToNetwork }) => (
    <button
      data-testid="cog"
      onClick={() =>
        onApplyToNetwork({
          manipulationPressure: 0.9,
          confidence: "high",
          recommendedAction:
            "Slow down — this message is engineered to rush your decision.",
        })
      }
    />
  ),
}));
vi.mock("../GemmaAnalysisPanel", () => ({
  default: ({ onApplyToNetwork }) => (
    <button
      data-testid="gemma"
      onClick={() => onApplyToNetwork({ manipulationPressure: 0.5 })}
    />
  ),
}));
vi.mock("../GeminiAnalysisPanel", () => ({
  default: ({ onApplyToNetwork }) => (
    <button
      data-testid="gemini"
      onClick={() => onApplyToNetwork({ manipulationPressure: 0.4 })}
    />
  ),
}));
vi.mock("../LobsterTrapPanel", () => ({
  default: () => <div data-testid="lobster" />,
}));

// Keep util side-effects pure.
vi.mock("../../utils/cognitiveFirewall", () => ({
  mapTRIBEToRegions: (s) => s,
}));
vi.mock("../../utils/immunityScore", () => ({
  recordEvent: vi.fn(),
  IMMUNITY_EVENTS: { FIREWALL_SCAN: "FIREWALL_SCAN", GEMMA_SCAN: "GEMMA_SCAN" },
}));
vi.mock("../../utils/toastStore", () => ({
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));

import FirewallSection from "./FirewallSection";

function setup(extra = {}) {
  const props = {
    mode: "simulation",
    setMode: vi.fn(),
    setState: vi.fn(),
    setFirewallResult: vi.fn(),
    initialFirewallScan: null,
    incomingDailyHash: null,
    ...extra,
  };
  render(<FirewallSection {...props} />);
  return props;
}

describe("FirewallSection", () => {
  it("renders all seven firewall panels", () => {
    setup();
    for (const id of [
      "tribe",
      "daily",
      "quiz",
      "cog",
      "gemma",
      "gemini",
      "lobster",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("threads mode and incomingDailyHash to the right panels", () => {
    setup({ mode: "tribe", incomingDailyHash: "abc123" });
    expect(screen.getByTestId("tribe")).toHaveAttribute("data-mode", "tribe");
    expect(screen.getByTestId("daily")).toHaveAttribute("data-hash", "abc123");
  });

  it("routes CognitiveFirewallPanel results into setFirewallResult + setState", () => {
    const { setState, setFirewallResult } = setup();
    fireEvent.click(screen.getByTestId("cog"));
    expect(setFirewallResult).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it("routes Gemma and Gemini results into setState", () => {
    const { setState } = setup();
    fireEvent.click(screen.getByTestId("gemma"));
    fireEvent.click(screen.getByTestId("gemini"));
    expect(setState).toHaveBeenCalledTimes(2);
  });
});
