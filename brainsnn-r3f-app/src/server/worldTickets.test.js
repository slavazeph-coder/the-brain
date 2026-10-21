import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { it } from '../test/tinyVitest.js';
import { createWorldTickets, signWorldTicket } from './worldTickets.js';

const secret = 'world-ticket-secret-'.padEnd(48, 's');
const env = { WORLD_WORKER_URL: 'https://scan.example.test/', WORLD_TICKET_SECRET: secret };

it('world tickets stay off unless a safe worker address and strong secret are configured', () => {
  assert.equal(createWorldTickets({}).snapshot().status, 'not_configured');
  assert.equal(createWorldTickets({}).mint(), null);
  for (const bad of [
    { ...env, WORLD_WORKER_URL: 'http://scan.example.test' },
    { ...env, WORLD_WORKER_URL: 'https://user:pass@scan.example.test' },
    { ...env, WORLD_WORKER_URL: 'https://scan.example.test/?k=1' },
    { ...env, WORLD_TICKET_SECRET: 'short' },
    { ...env, WORLD_TICKET_SECRET: secret.slice(0, 40) + ' spaces ' },
    { WORLD_WORKER_URL: env.WORLD_WORKER_URL },
  ]) {
    const tickets = createWorldTickets(bad);
    assert.equal(tickets.configured, false, JSON.stringify(bad));
    assert.equal(tickets.snapshot().status, 'invalid_configuration');
    assert.equal(tickets.snapshot().workerUrl, null);
  }
  assert.equal(createWorldTickets({ ...env, WORLD_WORKER_URL: 'http://127.0.0.1:8082' }).configured, true);
});

it('world tickets match the worker format, expire and never reveal the secret', () => {
  const tickets = createWorldTickets(env, { now: () => 1_800_000_000_000 });
  const snapshot = tickets.snapshot();
  assert.deepEqual(snapshot, { configured: true, status: 'configured', workerUrl: 'https://scan.example.test' });
  const first = tickets.mint(), second = tickets.mint();
  assert.equal(first.workerUrl, 'https://scan.example.test');
  assert.equal(first.expiresAt, 1_800_000_600);
  const [version, expires, nonce, signature] = first.ticket.split('.');
  assert.equal(version, 'v1');
  assert.equal(Number(expires), first.expiresAt);
  assert.match(nonce, /^[a-f0-9]{32}$/);
  assert.equal(signature, createHmac('sha256', secret).update(`v1.${expires}.${nonce}`).digest('hex'));
  assert.notEqual(first.ticket, second.ticket);
  assert.doesNotMatch(JSON.stringify([snapshot, first]), new RegExp(secret));
  assert.equal(signWorldTicket(secret, 5, 'a'.repeat(32)), `v1.5.${'a'.repeat(32)}.${createHmac('sha256', secret).update(`v1.5.${'a'.repeat(32)}`).digest('hex')}`);
  // Out-of-range lifetimes fall back to ten minutes; the worker rejects anything beyond an hour.
  assert.equal(createWorldTickets({ ...env, WORLD_TICKET_TTL_S: '86400' }, { now: () => 0 }).mint().expiresAt, 600);
  assert.equal(createWorldTickets({ ...env, WORLD_TICKET_TTL_S: '1800' }, { now: () => 0 }).mint().expiresAt, 1800);
});
