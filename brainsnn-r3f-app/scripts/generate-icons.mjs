/**
 * Generate the PWA / favicon / OG raster assets from public/favicon.svg and
 * the satori OG pipeline in viral/og.js.
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs (checked into public/ so deploys don't depend on this script):
 *   public/icon-192.png         — manifest icon (referenced by manifest.webmanifest)
 *   public/icon-512.png         — manifest icon
 *   public/apple-touch-icon.png — 180×180 iOS home-screen icon
 *   public/og.png               — 1200×630 static social card (homepage og:image)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const svg = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng();
  writeFileSync(join(PUBLIC, name), png);
  console.log(`wrote public/${name} (${png.length} bytes)`);
}

// Static OG card via the same renderer the live /api/og endpoint uses, so the
// homepage card and dynamic share cards stay visually consistent.
const { renderOg } = await import("../viral/og.js");
const og = await renderOg({});
writeFileSync(join(PUBLIC, "og.png"), og);
console.log(`wrote public/og.png (${og.length} bytes)`);
