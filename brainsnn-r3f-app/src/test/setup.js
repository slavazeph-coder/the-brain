// Vitest global setup: register jest-dom matchers and auto-clean the DOM
// between tests so renders don't leak into one another.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
