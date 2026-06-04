import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");
const indexFile = path.join(distDir, "index.html");
const assetsDir = path.join(distDir, "assets");

const markers = [
  "Feel what you read",
  "See the hidden feelings in anything you read",
  "Not sure what to paste? Tap an example",
];

function fail(message) {
  console.error(`Friendly build check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexFile)) {
  fail("dist/index.html is missing. Run npm run build first.");
}

if (!fs.existsSync(assetsDir)) {
  fail("dist/assets is missing. Run npm run build first.");
}

const indexHtml = fs.readFileSync(indexFile, "utf8");
const scriptMatches = [...indexHtml.matchAll(/src="([^"]*\/assets\/index-[^"]*\.js)"/g)];
const scriptFiles = scriptMatches.map((match) => path.basename(match[1]));

if (scriptFiles.length === 0) {
  fail("dist/index.html does not reference a Vite app chunk.");
}

const assetFiles = fs
  .readdirSync(assetsDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({
    file,
    text: fs.readFileSync(path.join(assetsDir, file), "utf8"),
  }));

const hits = new Map();
for (const marker of markers) {
  const hit = assetFiles.find(({ text }) => text.includes(marker));
  if (!hit) {
    fail(`missing Warm & Simple marker: ${marker}`);
  }
  hits.set(marker, hit.file);
}

console.log("Friendly build check passed.");
console.log(`dist/index.html app chunks: ${scriptFiles.join(", ")}`);
for (const [marker, file] of hits.entries()) {
  console.log(`marker "${marker}" found in ${file}`);
}
