// Tests use the same SQL as production. PGlite embeds PostgreSQL and provides
// one exclusive connection; serialize checkout so transactions cannot overlap.
// Set WORLD_PROJECT_TEST_DATABASE_URL to exercise a real multi-connection server.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../brainsnn-r3f-app/package.json', import.meta.url));

export async function createProjectTestPool({ directory, connectionString = process.env.WORLD_PROJECT_TEST_DATABASE_URL } = {}) {
  if (connectionString) {
    const { Pool } = require('pg');
    return new Pool({ connectionString, max: 5 });
  }
  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite(directory);
  await database.waitReady;
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      let released = false;
      return {
        async query(sql, values = []) {
          const result = await database.query(sql, values);
          return { ...result, rowCount: result.affectedRows ?? result.rows.length };
        },
        release() { if (!released) { released = true; unlock(); } },
      };
    },
    async query(sql, values) {
      const client = await pool.connect();
      try { return await client.query(sql, values); } finally { client.release(); }
    },
    async end() { await tail; await database.close(); },
  };
  return pool;
}
