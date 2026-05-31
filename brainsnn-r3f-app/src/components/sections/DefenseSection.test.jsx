import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Light stubs for all twelve defense panels. Factories must be self-contained
// (vi.mock is hoisted above the module, so they can't reference outer vars).
vi.mock("../ImmunityPanel", () => ({
  default: (p) => (
    <div data-testid="immunity" data-prop={p.incomingCard ?? ""} />
  ),
}));
vi.mock("../EmbeddingsPanel", () => ({
  default: () => <div data-testid="embeddings" />,
}));
vi.mock("../RedTeamPanel", () => ({
  default: () => <div data-testid="redteam" />,
}));
vi.mock("../BypassSubmitPanel", () => ({
  default: () => <div data-testid="bypass" />,
}));
vi.mock("../AutopsyPanel", () => ({
  default: (p) => <div data-testid="autopsy" data-prop={p.initialHash ?? ""} />,
}));
vi.mock("../TimeSeriesPanel", () => ({
  default: () => <div data-testid="timeseries" />,
}));
vi.mock("../InboxPanel", () => ({
  default: () => <div data-testid="inbox" />,
}));
vi.mock("../DiffPanel", () => ({ default: () => <div data-testid="diff" /> }));
vi.mock("../ScanAnywherePanel", () => ({
  default: () => <div data-testid="scananywhere" />,
}));
vi.mock("../WeeklyRecapPanel", () => ({
  default: () => <div data-testid="weeklyrecap" />,
}));
vi.mock("../FingerprintPanel", () => ({
  default: () => <div data-testid="fingerprint" />,
}));
vi.mock("../EchoPanel", () => ({ default: () => <div data-testid="echo" /> }));

import DefenseSection from "./DefenseSection";

describe("DefenseSection", () => {
  it("renders all twelve defense panels", () => {
    render(
      <DefenseSection incomingImmunityCard={null} incomingAutopsyHash={null} />,
    );
    for (const id of [
      "immunity",
      "embeddings",
      "redteam",
      "bypass",
      "autopsy",
      "timeseries",
      "inbox",
      "diff",
      "scananywhere",
      "weeklyrecap",
      "fingerprint",
      "echo",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("threads the incoming card/hash props to the right panels", () => {
    render(
      <DefenseSection
        incomingImmunityCard="card-xyz"
        incomingAutopsyHash="hash-789"
      />,
    );
    expect(screen.getByTestId("immunity")).toHaveAttribute(
      "data-prop",
      "card-xyz",
    );
    expect(screen.getByTestId("autopsy")).toHaveAttribute(
      "data-prop",
      "hash-789",
    );
  });
});
