# Changelog

## 1.4.0 — 2026-06-12 (UX overhaul)

### Added
- Section headers with one-line blurbs + clickable table-of-contents chips
  in all 8 sections; SectionNav shows per-section panel counts.
- Collapsible panels (default-open) in Tools, Studio, and Defense.
- Visible "Search 100+ layers ⌘K" buttons (sticky nav + long sections).
- Plain-language glossary tooltips on ~12 jargon terms; dismissible
  first-visit intro card.
- Scan verdict region tags click through to the 3D brain selection.

### Changed
- Scan-first landing: slim header → scan box → examples → 3D viewer;
  simulation controls move into a collapsible strip inside the viewer.
- Onboarding rewritten to 6 steps following the new page order (storage
  key bumped to v2 — existing users see the new tour once).

### Fixed
- ⌘K palette jumps now work across sections (previously panels in
  unvisited sections were unmounted and jumps silently failed).

## 1.3.0 — 2026-06-10 (launch-readiness release)

### Fixed
- 3D scene no longer fetches an HDR environment map from a third-party CDN —
  on networks that blocked it, the loader threw past every error boundary and
  unmounted the entire app. Environment lighting is now generated locally.
- Mobile layouts ≤560px no longer clip half the UI (grid track grew to the
  WebGL canvas's intrinsic width; section nav overflowed in column+wrap mode).
- PWA manifest icons existed only as references — `icon-192.png`,
  `icon-512.png`, `apple-touch-icon.png`, and `favicon.svg` now ship.
- `/api/og` and `/api/social-og` return a static PNG fallback on render
  failure instead of 500 JSON (social crawlers cache "no preview").
- Service worker: `/s/:hash` share route added to the network-first list.

### Changed
- Inter is self-hosted via `@fontsource/inter` (latin subsets) — removes the
  render-blocking Google Fonts request; offline PWA fonts work.
- Homepage `og:image` points at static `/og.png` (1200×630, checked in).
- WebGL-unavailable browsers get a friendly message; the rest of the app
  keeps working.
- `index.html` ships a `noscript` fallback and a pre-hydration splash.
- Layer-count copy synced to 100+ across OG cards, manifest, and READMEs.

### CI
- `brainsnn-app-deploy.yml`: test gate → Railway deploy (skips gracefully
  without `RAILWAY_TOKEN`) → version-aware healthcheck that waits for the
  new build to actually serve before going green.
