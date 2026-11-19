// Run locally with umask 077 and redirect stdout to a private file. The site
// mapping contains a secret; the worker mapping contains only its SHA-256 hash.
import { createHash, randomBytes } from 'node:crypto';

const [tenant, enginesCSV, storage] = process.argv.slice(2);
const engines = (enginesCSV || '').split(',').filter(Boolean);
const storageBytes = Number(storage);
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant || '') || ['operator', 'site-owner', 'site-visitors'].includes(tenant) ||
    !engines.length || engines.length > 17 || engines.some(value => !/^[a-z][a-z0-9-]{0,63}$/.test(value)) ||
    new Set(engines).size !== engines.length || !Number.isSafeInteger(storageBytes) || storageBytes < 7_000_000_000) {
  console.error('Usage: node scripts/world-project-worker-tenant.mjs TENANT_ID ENGINE[,ENGINE] STORAGE_BYTES');
  console.error('Use the provisioned project tenant ID, explicit licensed engine grants, and at least 7000000000 bytes.');
  process.exitCode = 1;
} else {
  const token = randomBytes(32).toString('base64url');
  console.log(JSON.stringify({
    warning: 'PRIVATE: merge these mappings with existing values; do not overwrite other organizations.',
    site: { WORLD_PROJECT_WORKER_TOKENS_JSON: { [tenant]: token } },
    worker: { WORLD_PROJECT_WORKER_TENANTS_JSON: [{ id: tenant,
      token_sha256: createHash('sha256').update(token).digest('hex'), engines,
      limits: { upload_count: 12, upload_bytes: 536870912, job_count: 12, active_jobs: 1, storage_bytes: storageBytes },
    }] },
  }, null, 2));
}
