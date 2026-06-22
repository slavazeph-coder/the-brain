// One-time generator for public/og-image.png (1200x630 social card).
//
// Rasterization is an author-time step, not part of the app build. Run it with
// the rasterizer installed without saving it to package.json:
//
//   npm install --no-save @resvg/resvg-js
//   node scripts/build-og.mjs
//
// The committed public/og-image.png is what ships; runtime and CI never need
// this script or @resvg/resvg-js. Colors are locked to the BrainSNN theme.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const FONTS = "/mnt/skills/examples/canvas-design/canvas-fonts";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00f5ff"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.9">
      <stop offset="0" stop-color="#a855f7" stop-opacity="0.16"/>
      <stop offset="0.6" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="#06060a"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="6" fill="url(#brand)"/>

  <!-- monogram tile -->
  <rect x="96" y="150" width="120" height="120" rx="26" fill="url(#brand)"/>
  <text x="156" y="212" text-anchor="middle" font-family="JetBrains Mono"
        font-size="40" font-weight="700" fill="#06060a" letter-spacing="1">SNN</text>

  <!-- wordmark -->
  <text x="248" y="232" font-family="Work Sans" font-size="76" font-weight="700" fill="#f1f1f6">BrainSNN</text>

  <!-- tagline -->
  <text x="98" y="356" font-family="Work Sans" font-size="44" font-weight="700" fill="#f1f1f6">Affective Intelligence for Online Content</text>
  <text x="98" y="416" font-family="Work Sans" font-size="30" font-weight="400" fill="#9aa0b4">Powered by Spiking Neural Networks and Crumb LLM</text>

  <!-- footer accents -->
  <text x="98" y="540" font-family="JetBrains Mono" font-size="22" font-weight="500" fill="#00f5ff">brainsnn.com</text>
  <text x="98" y="574" font-family="JetBrains Mono" font-size="18" font-weight="400" fill="#a855f7">O(N log N) · WAVE-EQUATION ATTENTION CORE</text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    loadSystemFonts: false,
    fontFiles: [
      `${FONTS}/JetBrainsMono-Bold.ttf`,
      `${FONTS}/JetBrainsMono-Regular.ttf`,
      `${FONTS}/WorkSans-Bold.ttf`,
      `${FONTS}/WorkSans-Regular.ttf`,
    ],
    defaultFontFamily: "Work Sans",
  },
});

const png = resvg.render().asPng();
writeFileSync(new URL("../public/og-image.png", import.meta.url), png);
console.log("Wrote public/og-image.png", png.length, "bytes");
