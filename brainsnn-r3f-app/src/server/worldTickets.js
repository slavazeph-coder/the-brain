// Single-use upload tickets for the World Engine reconstruction worker
// (robotics/arena/workers/site_scan). The browser uploads a capture straight
// to the worker with a ticket this server signs; brainsnn.com never receives
// the video, and the worker's operator token never leaves the worker host.
import { createHmac, randomBytes } from 'node:crypto';

const DEFAULT_TTL_S = 600;

function configuration(env) {
  const enabled = Boolean(env.WORLD_WORKER_URL || env.WORLD_TICKET_SECRET);
  try {
    const url = new URL(String(env.WORLD_WORKER_URL || ''));
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    const secret = String(env.WORLD_TICKET_SECRET || '');
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash
      || secret.length < 32 || secret.length > 512 || /[^\x21-\x7e]/.test(secret)) {
      throw new Error('Invalid configuration');
    }
    const requested = Number(env.WORLD_TICKET_TTL_S);
    // The worker refuses tickets that claim more than an hour.
    const ttlS = Number.isInteger(requested) && requested >= 60 && requested <= 3600 ? requested : DEFAULT_TTL_S;
    return { enabled, configured: true, workerUrl: url.href.replace(/\/$/, ''), secret, ttlS };
  } catch {
    return { enabled, configured: false };
  }
}

/** v1.<expires>.<nonce>.<hex HMAC-SHA256 over "v1.<expires>.<nonce">>; verified by the worker's redeem_ticket(). */
export function signWorldTicket(secret, expiresAt, nonce = randomBytes(16).toString('hex')) {
  const body = `v1.${expiresAt}.${nonce}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** @param {Record<string, string | undefined>} env */
export function createWorldTickets(env = {}, { now = () => Date.now() } = {}) {
  const config = configuration(env);
  const status = config.configured ? 'configured' : config.enabled ? 'invalid_configuration' : 'not_configured';
  return {
    configured: config.configured,
    // The worker URL is public by design: browsers upload to it directly.
    snapshot: () => ({ configured: config.configured, status, workerUrl: config.configured ? config.workerUrl : null }),
    mint() {
      if (!config.configured) return null;
      const expiresAt = Math.floor(now() / 1000) + config.ttlS;
      return { ticket: signWorldTicket(config.secret, expiresAt), expiresAt, workerUrl: config.workerUrl };
    },
  };
}
