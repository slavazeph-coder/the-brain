// Render the robot-testing social card using the existing Panda body preview.
// Run from any directory: node brainsnn-r3f-app/scripts/render-robot-og.mjs
// No server, network, model execution or image-generation service is required.
// On macOS use installed Chrome; PLAYWRIGHT_CHROMIUM_PATH can select a binary.
// Panda preview provenance/license: public/arena/assets/robots/ATTRIBUTIONS.md.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, 'public', 'og', 'robot-testing.png');
const PANDA = readFileSync(join(APP, 'public', 'arena', 'assets', 'robots', 'panda.png')).toString('base64');
const SIZE = { width: 1200, height: 630 };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BrainSNN robot testing</title><style>
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif;background:#05070b;color:#f4f7fb;-webkit-font-smoothing:antialiased}
main{position:relative;width:1200px;height:630px;isolation:isolate;background:radial-gradient(ellipse at 86% 46%,#10313c60,transparent 42%),radial-gradient(ellipse at 72% 79%,#31244c4a,transparent 38%),#080c12}
main:after{content:"";position:absolute;inset:22px;border:1px solid #91aed31b;border-radius:24px;pointer-events:none;z-index:3}
.brand{position:absolute;top:58px;left:60px;display:flex;align-items:center;gap:15px;font-size:28px;font-weight:600;letter-spacing:-1px}
.mark{display:grid;place-items:center;width:46px;height:46px;border-radius:13px;background:linear-gradient(145deg,#68eaff,#947cff);color:#041016;font-size:25px;font-weight:900;letter-spacing:0}
h1{position:absolute;left:60px;top:177px;z-index:2;margin:0;font-size:66px;font-weight:600;line-height:1.09;letter-spacing:-3px}h1 span{display:block;color:#86edff}
.status{position:absolute;left:62px;top:392px;z-index:2;margin:0;font-size:15px;font-weight:400;line-height:1.7;color:#b4bfd0;letter-spacing:-.1px}
.status:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin:0 9px 1px 0;background:#947cff}
.body-preview{position:absolute;right:25px;top:93px;width:450px;height:450px;object-fit:contain;filter:drop-shadow(0 25px 28px #0008)}
.body-label{position:absolute;right:112px;top:467px;margin:0;font-size:11px;line-height:1.5;color:#8396ab;letter-spacing:.3px}
footer{position:absolute;left:60px;right:60px;bottom:53px;border-top:1px solid #a3b9d523;padding-top:24px;display:flex;align-items:center;justify-content:space-between;font-size:18px;font-weight:400;letter-spacing:-.25px;color:#c7d0df}
footer small{font-size:13px;letter-spacing:.1px;color:#8293aa}
</style></head><body><main><div class="brand"><span class="mark" aria-hidden="true">B</span>BrainSNN</div><h1>Test your robot.<span>See where it fails.</span></h1><p class="status">Local practice open · real-policy testing in qualification</p><img class="body-preview" src="data:image/png;base64,${PANDA}" alt="Franka Panda robot body preview"><p class="body-label">Panda · body preview</p><footer><span>Robot arcade · policy test packs</span><small>brainsnn.com</small></footer></main></body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : process.platform === 'darwin' ? { channel: 'chrome' } : {}),
});
try {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.route('**/*', route => route.abort());
  await page.setContent(html);
  await page.locator('.body-preview').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`Rendered ${OUT} (${SIZE.width}×${SIZE.height}).`);
} finally {
  await browser.close();
}
