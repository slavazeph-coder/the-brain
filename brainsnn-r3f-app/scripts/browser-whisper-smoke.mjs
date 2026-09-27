import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VITE_PORT = 4178;
const DEBUG_PORT = 9227;
const TARGET_URL = `http://127.0.0.1:${VITE_PORT}/scripts/browser-whisper-smoke.html`;
const TIMEOUT_MS = 7 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/')) return candidate;
    const resolved = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (resolved.status === 0 && resolved.stdout.trim()) return resolved.stdout.trim();
  }
  throw new Error(`No Chrome/Chromium binary found. Tried: ${candidates.join(', ')}`);
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForPage() {
  const endpoint = `http://127.0.0.1:${DEBUG_PORT}/json/list`;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const pages = await (await fetch(endpoint)).json();
      const page = pages.find((item) => item.type === 'page' && item.url.includes('browser-whisper-smoke.html'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome may still be booting.
    }
    await sleep(300);
  }
  throw new Error('Timed out waiting for the Chrome DevTools page target.');
}

function openCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;

    function closeWith(error) {
      for (const { reject: rejectCall } of pending.values()) rejectCall(error);
      pending.clear();
    }

    socket.addEventListener('open', () => {
      resolve({
        socket,
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket failed to open.')));
    socket.addEventListener('close', () => closeWith(new Error('Chrome DevTools WebSocket closed.')));
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message || 'CDP command failed.'));
      else call.resolve(message.result);
    });
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result?.result?.value;
}

async function main() {
  if (typeof WebSocket !== 'function') throw new Error(`Node ${process.version} does not expose the WebSocket client required by this smoke runner.`);
  const chrome = findChrome();
  const profileDir = await mkdtemp(join(tmpdir(), 'brainsnn-whisper-chrome-'));
  console.log(`[whisper-smoke] Chrome: ${chrome}`);

  const vite = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1',
    '--port', String(VITE_PORT),
    '--strictPort',
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });

  let viteLog = '';
  vite.stdout.on('data', (chunk) => { viteLog += String(chunk); });
  vite.stderr.on('data', (chunk) => { viteLog += String(chunk); });

  let chromeLog = '';
  let browser = null;
  let cdp = null;
  try {
    await waitForHttp(TARGET_URL);
    browser = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      TARGET_URL,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browser.stdout.on('data', (chunk) => { chromeLog += String(chunk); });
    browser.stderr.on('data', (chunk) => { chromeLog += String(chunk); });

    const page = await waitForPage();
    cdp = await openCdp(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    const started = Date.now();
    let lastStatus = '';
    while (Date.now() - started < TIMEOUT_MS) {
      const snapshot = await evaluate(cdp.send, `(() => ({
        status: document.body?.dataset?.status || 'pending',
        error: document.body?.dataset?.error || '',
        words: document.body?.dataset?.words || '',
        segments: document.body?.dataset?.segments || '',
        device: document.body?.dataset?.device || '',
        text: document.body?.innerText || ''
      }))()`);
      if (snapshot?.status !== lastStatus) {
        console.log(`[whisper-smoke] browser status: ${snapshot?.status || 'unknown'}`);
        lastStatus = snapshot?.status || '';
      }
      if (snapshot?.status === 'pass') {
        console.log(`[whisper-smoke] PASS · ${snapshot.words} timed words · ${snapshot.segments} segments · ${snapshot.device}`);
        console.log(snapshot.text);
        return;
      }
      if (snapshot?.status === 'fail') {
        throw new Error(`Browser Whisper smoke failed: ${snapshot.error || 'unknown browser failure'}\n${snapshot.text || ''}`);
      }
      if (browser.exitCode != null) throw new Error(`Chrome exited early with code ${browser.exitCode}.\n${chromeLog}`);
      await sleep(1500);
    }
    throw new Error(`Browser Whisper smoke exceeded ${Math.round(TIMEOUT_MS / 1000)} seconds.`);
  } catch (error) {
    console.error('[whisper-smoke] Vite log:\n', viteLog.slice(-12000));
    console.error('[whisper-smoke] Chrome log:\n', chromeLog.slice(-12000));
    throw error;
  } finally {
    try { cdp?.socket?.close(); } catch { /* no-op */ }
    try { browser?.kill('SIGTERM'); } catch { /* no-op */ }
    try { vite.kill('SIGTERM'); } catch { /* no-op */ }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
