/**
 * Single source of truth for the public host of the BrainSNN app.
 *
 * Change this in one place when the deploy URL changes. Used by:
 *   - extensionSource.js  (the Chromium MV3 bookmarklet / extension)
 *   - ScanAnywherePanel    (the inline bookmarklet)
 *   - ApiDocsPanel         (curl examples)
 *
 * Why we don't read this from `window.location.origin` at runtime:
 * the bookmarklet code is generated server-side / copy-pasted, and
 * needs to embed the public host as a literal string. Same for the
 * curl examples we render in the docs.
 */

export const APP_HOST = 'https://app.brainsnn.com';

/**
 * Marketing / landing site. Apex domain. Used in cross-links from the
 * R3F app back to the homepage.
 */
export const MARKETING_HOST = 'https://brainsnn.com';
