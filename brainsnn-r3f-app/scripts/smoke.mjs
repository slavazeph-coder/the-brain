/**
 * Headless smoke test — drives the BUILT app like a first-time visitor and
 * fails loudly on the regressions that have actually bitten this project:
 * a page error unmounting the app, the scan flow breaking, or the layout
 * overflowing on phones.
 *
 *   npm run build && node server.js &   (PORT 8080)
 *   node scripts/smoke.mjs              (exits 1 on any failure)
 *
 * Playwright resolution: local node_modules first (CI installs it with
 * `npm i --no-save playwright`), then the preinstalled global module.
 */

const BASE = process.env.SMOKE_URL || "http://localhost:8080";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import(
    "/opt/node22/lib/node_modules/playwright/index.mjs"
  ));
}

const failures = [];
const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label) => {
  failures.push(label);
  console.error(`  ✗ ${label}`);
};
const check = (cond, label) => (cond ? ok(label) : fail(label));

const browser = await chromium.launch({ args: ["--no-sandbox"] });

// ── Desktop: load → scan → brain link ─────────────────────────────────
console.log("desktop 1440×900");
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(BASE, { timeout: 60000 });
await page.waitForTimeout(5000);

check(
  (await page.evaluate(() => document.getElementById("root").children.length)) > 0,
  "app mounted (root not empty)",
);

const skip = page.locator('button:has-text("Skip")');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(400);

check((await page.locator(".scan-hero").count()) === 1, "scan hero present");

// Demo tile → verdict card
await page.locator(".demo-tiles button, .demo-tile").first().click();
await page.waitForTimeout(1500);
check(
  (await page.locator(".scan-hero").textContent()).toLowerCase().includes("risk"),
  "demo tile produces a verdict",
);

// Region link → 3D selection
const regionBtn = page.locator("button.region-link").first();
if (await regionBtn.count()) {
  await regionBtn.click();
  await page.waitForTimeout(1000);
  const chip = await page.evaluate(() =>
    [...document.querySelectorAll(".viewer-chip")]
      .map((c) => c.textContent)
      .find((t) => t.startsWith("Selected")),
  );
  check(Boolean(chip && !chip.includes("undefined")), `region link selects (${chip})`);
} else {
  fail("region link buttons missing from verdict card");
}

check(pageErrors.length === 0, `no page errors (${pageErrors.join("; ") || "clean"})`);
await page.close();

// ── Mobile: no horizontal overflow ────────────────────────────────────
console.log("mobile 390×844");
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
const mErrors = [];
m.on("pageerror", (e) => mErrors.push(e.message));
await m.goto(BASE, { timeout: 60000 });
await m.waitForTimeout(5000);
const mskip = m.locator('button:has-text("Skip")');
if (await mskip.count()) await mskip.first().click();
await m.waitForTimeout(400);

const scrollW = await m.evaluate(() => document.documentElement.scrollWidth);
check(scrollW <= 390, `no horizontal overflow (scrollWidth=${scrollW})`);
check(
  await m.evaluate(() => {
    const el = document.querySelector(".sim-controls");
    return el ? !el.open : false;
  }),
  "sim controls collapsed by default on phones",
);
check(mErrors.length === 0, `no mobile page errors (${mErrors.join("; ") || "clean"})`);
await m.close();
await browser.close();

if (failures.length) {
  console.error(`\nSMOKE FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nSMOKE PASSED");
