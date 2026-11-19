#!/usr/bin/env node
import 'dotenv/config';
import { createWorldProjectService } from '../src/server/worldProjectService.js';

// Operator-only cleanup of expired/cancelled upload reservations. Retained
// source objects are never candidates. Default is a read-only report.
const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--help'].includes(arg))) {
  console.error('Usage: npm run world:projects:storage -- [--apply]');
  process.exitCode = 1;
} else if (args.includes('--help')) {
  console.log('Reports abandoned source uploads. --apply deletes only eligible, unretained chunk objects after a ten-minute grace period. Run repeatedly/schedule hourly; each batch is bounded to100 uploads. Uses the same PostgreSQL and private S3 configuration as the application.');
} else {
  const service = createWorldProjectService();
  try {
    const result = await service.cleanupSourceUploads({ apply: args.includes('--apply') });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: typeof error?.code === 'string' ? error.code : 'cleanup-unavailable', message: 'Source cleanup could not finish. Check the private database and object-store configuration, then retry. No retained source was selected for deletion.' }));
    process.exitCode = 1;
  } finally { await service.close(); }
}
