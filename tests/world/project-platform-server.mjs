// Test-only server: uses the production handlers and migrations with PostgreSQL
// (PGlite by default). It is never imported or mounted by the deployed app.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';
import { createMemoryProjectObjectStore } from './helpers/project-object-store.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const express = require('express');

// tenantId: a test that counts projects or keys passes its own, because a shared CI database keeps earlier tests' rows.
export async function startProjectPlatformFixture({ directory, port = 0, objectStore = createMemoryProjectObjectStore(), tenantId = 'tenant_browser_fixture' } = {}) {
  const pool = await createProjectTestPool({ directory });
  const service = createWorldProjectService({ pool, env: {}, objectStore });
  await service.initialize();
  const tenant = await service.provisionTenant({ name: 'Browser test workspace', id: tenantId });
  const credentials = {};
  for (const role of ['admin', 'editor', 'reviewer', 'reader']) {
    credentials[role] = await service.provisionKey({ tenant_id: tenant.id, actor_name: `Fixture ${role}`, role });
  }
  const app = express();
  app.use('/api/world/v1', service.handle);
  app.use(express.static(fileURLToPath(new URL('../../brainsnn-r3f-app/public/', import.meta.url))));
  const server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`, credentials, tenant, service, pool, objectStore,
    async close() {
      await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
      await service.close(); await pool.end();
    },
  };
}
