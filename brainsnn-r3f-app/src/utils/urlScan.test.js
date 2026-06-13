import { describe, it, expect } from "vitest";
import { looksLikeUrl, normalizeUrl, domainOf } from "./urlScan.js";

describe("looksLikeUrl — bare-link-only policy", () => {
  it("accepts a bare http(s) link", () => {
    expect(looksLikeUrl("https://nytimes.com/2024/article")).toBe(true);
    expect(looksLikeUrl("http://example.com")).toBe(true);
    expect(looksLikeUrl("  https://example.com/x?a=1  ")).toBe(true); // trims
  });

  it("accepts a bare www link", () => {
    expect(looksLikeUrl("www.bbc.com/news/story")).toBe(true);
  });

  it("rejects prose that merely CONTAINS a link", () => {
    expect(looksLikeUrl("check this out https://example.com it's wild")).toBe(
      false,
    );
    expect(looksLikeUrl("https://example.com is a scam")).toBe(false);
  });

  it("rejects plain text and partial domains", () => {
    expect(looksLikeUrl("You won't believe what happened next")).toBe(false);
    expect(looksLikeUrl("www.justawordnotadomain")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("ftp://example.com")).toBe(false);
  });

  it("rejects multi-line pastes", () => {
    expect(looksLikeUrl("https://a.com\nhttps://b.com")).toBe(false);
  });
});

describe("normalizeUrl / domainOf", () => {
  it("prepends https to bare www links", () => {
    expect(normalizeUrl("www.bbc.com")).toBe("https://www.bbc.com");
    expect(normalizeUrl("https://x.com")).toBe("https://x.com");
  });

  it("extracts a clean display domain", () => {
    expect(domainOf("https://www.nytimes.com/2024/x")).toBe("nytimes.com");
    expect(domainOf("www.bbc.com/news")).toBe("bbc.com");
  });
});
