import React, { useState, useEffect, useRef } from "react";
import { toastInfo } from "../utils/toastStore";

/**
 * Layer 49 — Scan Anywhere
 *
 * One-line JS bookmarklet that grabs the selected text (or page
 * title+URL if nothing is selected) and opens brainsnn.com with a
 * pre-filled scan target via the ?scan= query param.
 *
 * Also exposes the ?scan=<text> and ?scan-url=<url> contract so any
 * external link / share-sheet / launcher can deep-link straight
 * into the Firewall.
 */
const BOOKMARKLET_SRC = `javascript:(function(){var s=window.getSelection?window.getSelection().toString():'';var t=s||(document.title+'. '+(window.location.href||''));var u='https://brainsnn.com/?scan='+encodeURIComponent(t.slice(0,3000));window.open(u,'_blank','noopener');})();`;

export default function ScanAnywherePanel() {
  const [copied, setCopied] = useState(false);
  const bookmarkletRef = useRef(null);

  // The href is a `javascript:` bookmarklet — required so it stores as an
  // executable bookmark when dragged to the bookmarks bar. We set it directly
  // on the DOM node after mount instead of via JSX, so React's URL sanitizer
  // never inspects it (no "future version will block javascript: URLs"
  // warning, and no future hard-block). The node is painted before the user
  // can drag, so the href is in place in time.
  useEffect(() => {
    const el = bookmarkletRef.current;
    if (el) el.setAttribute("href", BOOKMARKLET_SRC);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET_SRC);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy the bookmarklet source:", BOOKMARKLET_SRC);
    }
  }

  // ── Click behavior ─────────────────────────────────────────────────────
  // This link is meant to be DRAGGED to the bookmarks bar. Now that the href
  // is a live `javascript:` URL, a click here would run the bookmarklet against
  // this very page — so instead of letting it fire blind, we (1) nudge the user
  // toward the drag gesture, then (2) run a live preview scan of the current
  // page so the click still does something useful. window.open stays inside the
  // synchronous click handler so it counts as a user gesture (no popup block).
  function handleBookmarkletClick(e) {
    e.preventDefault();
    toastInfo(
      "Drag this up to your bookmarks bar — then click it on any page. Opening a live preview…",
    );
    const selection = window.getSelection
      ? window.getSelection().toString()
      : "";
    const target = selection || `${document.title}. ${window.location.href}`;
    window.open(
      `/?scan=${encodeURIComponent(target.slice(0, 3000))}`,
      "_blank",
      "noopener",
    );
  }

  return (
    <section className="panel panel-pad scan-anywhere-panel">
      <div className="eyebrow">Layer 49 · scan anywhere</div>
      <h2>Bookmarklet + deep-link</h2>
      <p className="muted">
        Drag this to your bookmarks bar. On any page, click it — the selected
        text (or the page title + URL if nothing is selected) opens here with
        the Firewall pre-loaded. Works on desktop and mobile.
      </p>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <a
          ref={bookmarkletRef}
          draggable="true"
          onClick={handleBookmarkletClick}
          className="btn primary"
          style={{ textDecoration: "none" }}
          title="Drag me to your bookmarks bar"
        >
          ↯ Scan with BrainSNN
        </a>
        <button className="btn" onClick={copy}>
          {copied ? "Source copied ✓" : "Copy source"}
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">Deep-link contract</div>
        <ul
          className="muted"
          style={{ marginTop: 6, lineHeight: 1.6, paddingLeft: 18 }}
        >
          <li>
            <code>/?scan=&lt;text&gt;</code> — pre-fill the Firewall with this
            text
          </li>
          <li>
            <code>/?scan-url=&lt;url&gt;</code> — fetch the URL server-side,
            then scan
          </li>
          <li>
            <code>/?r=&lt;hash&gt;</code> — rehydrate a Reaction share card
          </li>
          <li>
            <code>/?i=&lt;hash&gt;</code> — rehydrate an Immunity card
          </li>
          <li>
            <code>/?q=&lt;hash&gt;</code> — rehydrate a Quiz card
          </li>
          <li>
            <code>/?d=&lt;hash&gt;</code> — rehydrate a Daily card
          </li>
          <li>
            <code>/?a=&lt;hash&gt;</code> — rehydrate an Autopsy card
          </li>
          <li>
            <code>/?x=&lt;hash&gt;</code> — rehydrate a Counter-Draft card
          </li>
          <li>
            <code>/?t=&lt;hash&gt;</code> — rehydrate a Timeline card
          </li>
          <li>
            <code>/?n=&lt;hash&gt;</code> — rehydrate an Inbox card
          </li>
          <li>
            <code>/?v=&lt;hash&gt;</code> — rehydrate a Diff card
          </li>
        </ul>
      </div>
    </section>
  );
}
