/**
 * BrainSNN unified server — Railway / any Node host.
 *
 * Serves:
 *   GET  /                    → Vite SPA (dist/index.html)
 *   GET  /r/:hash             → SSR HTML shell for Reaction share cards
 *   GET  /i/:hash             → SSR HTML shell for Immunity share cards
 *   GET  /api/og              → 1200×630 PNG (?h=, ?type=immunity|reaction)
 *   GET  /api/fetch-url       → HTML-strip reader (?u=)
 *   GET  /api/leaderboard     → weekly top-N + total
 *   POST /api/leaderboard     → submit a score
 *   GET  /healthz             → liveness (Railway healthcheck)
 *
 * Everything SPA-routed falls through to dist/index.html for client routing.
 */

import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { renderOg } from './viral/og.js';
import {
  handleReactionCard, handleImmunityCard, handleQuizCard, handleAutopsyCard,
  handleDailyCard, handleCounterDraftCard, handleTimelineCard, handleInboxCard,
  handleDiffCard, handleRecapCard, handleBadgesCard,
} from './viral/cards.js';
import { handleAttackSubmit, handleAttacksGet } from './viral/attacks.js';
import { handleScore, handleOpenApi } from './viral/api-score.js';
import { handleScoreStream } from './viral/api-stream.js';
import { handleRoomPost, handleRoomGet } from './viral/api-rooms.js';
import { handleSyncPost, handleSyncGet } from './viral/api-sync.js';
import { handleCommunityPack, handleCommunityList } from './viral/api-community.js';
import { handleFetchUrl } from './viral/fetch-url.js';
import { handleLeaderboardGet, handleLeaderboardPost } from './viral/leaderboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '64kb' }));

// --- Liveness ---------------------------------------------------------------
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// --- OG image ---------------------------------------------------------------
app.get('/api/og', async (req, res) => {
  try {
    const png = await renderOg(req.query || {});
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(png);
  } catch (err) {
    // Log and return a small error image-ish response — OG crawlers prefer 200
    console.error('[og] render failed:', err);
    res.status(500).json({ error: 'og render failed' });
  }
});

// --- URL reader -------------------------------------------------------------
app.get('/api/fetch-url', async (req, res) => {
  try {
    await handleFetchUrl(req, res);
  } catch (err) {
    console.error('[fetch-url]', err);
    res.status(500).json({ error: 'fetch-url failed' });
  }
});

// --- Leaderboard ------------------------------------------------------------
app.get('/api/leaderboard', async (req, res) => {
  try {
    await handleLeaderboardGet(req, res);
  } catch (err) {
    console.error('[leaderboard:get]', err);
    res.status(500).json({ error: 'leaderboard get failed' });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  try {
    await handleLeaderboardPost(req, res);
  } catch (err) {
    console.error('[leaderboard:post]', err);
    res.status(500).json({ error: 'leaderboard post failed' });
  }
});

// --- Attack bypass submissions (Layer 25 extension) ------------------------
app.get('/api/attacks', async (req, res) => {
  try { await handleAttacksGet(req, res); }
  catch (err) { console.error('[attacks:get]', err); res.status(500).json({ error: 'attacks get failed' }); }
});
app.post('/api/attacks', async (req, res) => {
  try { await handleAttackSubmit(req, res); }
  catch (err) { console.error('[attacks:post]', err); res.status(500).json({ error: 'attacks post failed' }); }
});

// --- Layer 54 — Public Score API -----------------------------------------
app.post('/api/score', async (req, res) => {
  try { await handleScore(req, res); }
  catch (err) { console.error('[score]', err); res.status(500).json({ error: 'score failed' }); }
});
app.get('/api/openapi.json', handleOpenApi);

// --- Layer 76 — Streaming scoring (SSE) ---
app.post('/api/score/stream', async (req, res) => {
  try { await handleScoreStream(req, res); }
  catch (err) { console.error('[stream]', err); if (!res.headersSent) res.status(500).json({ error: 'stream failed' }); }
});

// --- Layer 77 — Session Rooms ---
app.post('/api/rooms', async (req, res) => {
  try { await handleRoomPost(req, res); }
  catch (err) { console.error('[rooms:post]', err); res.status(500).json({ error: 'rooms post failed' }); }
});
app.get('/api/rooms/:room', async (req, res) => {
  try { await handleRoomGet(req, res); }
  catch (err) { console.error('[rooms:get]', err); res.status(500).json({ error: 'rooms get failed' }); }
});

// --- Layer 96 — Cross-device Sync ---
app.post('/api/sync', async (req, res) => {
  try { await handleSyncPost(req, res); }
  catch (err) { console.error('[sync:post]', err); res.status(500).json({ error: 'sync post failed' }); }
});
app.get('/api/sync/:code', async (req, res) => {
  try { await handleSyncGet(req, res); }
  catch (err) { console.error('[sync:get]', err); res.status(500).json({ error: 'sync get failed' }); }
});

// --- Layer 99 — Community Pack feed ---
app.get('/api/community-pack', handleCommunityPack);
app.get('/api/community-packs', handleCommunityList);

// --- Share card HTML shells -------------------------------------------------
app.get('/r/:hash', handleReactionCard);
app.get('/i/:hash', handleImmunityCard);
app.get('/q/:hash', handleQuizCard);
app.get('/a/:hash', handleAutopsyCard);
app.get('/d/:hash', handleDailyCard);
app.get('/x/:hash', handleCounterDraftCard);
app.get('/t/:hash', handleTimelineCard);
app.get('/n/:hash', handleInboxCard);
app.get('/v/:hash', handleDiffCard);
app.get('/w/:hash', handleRecapCard);
app.get('/b/:hash', handleBadgesCard);

// --- Static SPA -------------------------------------------------------------
if (!existsSync(DIST)) {
  console.warn(`[server] dist/ not found at ${DIST} — run "npm run build" first`);
}

app.use(express.static(DIST, {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Hashed assets get long cache; index.html stays fresh.
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (/\.(js|css|woff2?|png|jpg|svg|webp)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// SPA fallback — anything else loads index.html so client-side routes work.
app.get('*', (_req, res) => {
  res.sendFile(join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[brainsnn] listening on :${PORT}`);
  console.log(`[brainsnn] og + cards + leaderboard ready`);
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.log('[brainsnn] UPSTASH_REDIS_REST_URL not set — leaderboard runs in-memory');
  }
});
