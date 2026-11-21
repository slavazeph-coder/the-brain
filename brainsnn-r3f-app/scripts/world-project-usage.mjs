#!/usr/bin/env node
import { createWorldProjectService } from '../src/server/worldProjectService.js';
import { USAGE_METRICS } from '../src/server/worldProjectStore.js';

const help = `Print each workspace's API and processing usage for one calendar month (UTC) as CSV, for invoicing.

WORLD_PROJECT_DATABASE_URL (or DATABASE_URL) must name the project database.

node scripts/world-project-usage.mjs [--month YYYY-MM]

Columns: tenant_id, tenant_name, month, ${USAGE_METRICS.join(', ')}.
Counts start when this meter was deployed; earlier months have no rows.
`;

const csv = value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
let service;
try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) process.stdout.write(help);
  else {
    if (args.length && !(args.length === 2 && args[0] === '--month')) throw new Error('Use --month YYYY-MM, or no options for the current month.');
    if (!process.env.WORLD_PROJECT_DATABASE_URL && !process.env.DATABASE_URL) throw new Error('Set WORLD_PROJECT_DATABASE_URL or DATABASE_URL privately before exporting.');
    service = createWorldProjectService();
    const rows = await service.usageReport(args[1]);
    const columns = ['tenant_id', 'tenant_name', 'month', ...USAGE_METRICS];
    process.stdout.write([columns.join(','), ...rows.map(row => columns.map(column => csv(row[column])).join(','))].join('\n') + '\n');
  }
} catch (error) {
  // Connection errors can contain hosts or credentials; print only our own messages.
  const safe = error?.code && error?.status ? error.message : /^(Use |Set WORLD_PROJECT)/.test(error?.message || '') ? error.message : 'Export failed. Check the private database configuration.';
  process.stderr.write(safe + '\n'); process.exitCode = 1;
} finally { if (service) await service.close(); }
