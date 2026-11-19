#!/usr/bin/env node
import { createApiWaitlist } from '../src/server/apiWaitlist.js';

const help = `Read or prune the BrainSNN API access waitlist.

WORLD_PROJECT_DATABASE_URL (or DATABASE_URL) must name the site's PostgreSQL database,
for example by running this through \`railway run\` on the site service.

node scripts/api-waitlist-admin.mjs count
node scripts/api-waitlist-admin.mjs csv > waitlist.csv
node scripts/api-waitlist-admin.mjs remove --email person@example.com

The CSV contains personal contact details. Keep it out of the repository and shared drives.
`;

const cell = value => {
  const text = String(value ?? '');
  // Neutralize spreadsheet formulas as well as quoting separators.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

let waitlist;
try {
  const [command, flag, value, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { process.stdout.write(help); process.exit(0); }
  if (!process.env.WORLD_PROJECT_DATABASE_URL && !process.env.DATABASE_URL) throw new Error('Set WORLD_PROJECT_DATABASE_URL or DATABASE_URL privately first.');
  waitlist = createApiWaitlist();
  if (command === 'count' && !flag) {
    const rows = await waitlist.list();
    const byUse = rows.reduce((counts, row) => ({ ...counts, [row.use_case]: (counts[row.use_case] || 0) + 1 }), {});
    process.stdout.write(`${rows.length} on the waitlist\n${Object.entries(byUse).map(([use, n]) => `  ${use}: ${n}`).join('\n')}\n`);
  } else if (command === 'csv' && !flag) {
    const columns = ['email', 'name', 'company', 'use_case', 'monthly_volume', 'details', 'source', 'submissions', 'created_at', 'updated_at'];
    process.stdout.write(`${columns.join(',')}\n`);
    for (const row of await waitlist.list()) process.stdout.write(`${columns.map(column => cell(row[column])).join(',')}\n`);
  } else if (command === 'remove' && flag === '--email' && value && rest.length === 0) {
    process.stdout.write((await waitlist.remove(value)) ? 'Removed.\n' : 'That address is not on the waitlist.\n');
  } else {
    throw new Error('Use one of the commands shown by --help.');
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await waitlist?.close();
}
