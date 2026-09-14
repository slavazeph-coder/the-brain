// Only for local browser tests. Synthetic credentials, isolated temporary DB,
// no inherited provider keys, no production preloads or external worker.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'brainsnn-ops-browser-'));
const child = spawn(process.execPath, ['dist/server.cjs'], {
  cwd: process.cwd(), stdio: 'inherit', env: {
    PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4186',
    BRAINSNN_LOAD_DOTENV: '0', BRAINSNN_BIND_HOST: '127.0.0.1',
    ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1',
    ORCHESTRATION_DB_PATH: join(dir, 'queue.sqlite'),
    ORCHESTRATION_OWNER_KEY: 'local-browser-owner-fixture-0000000000000000',
    ORCHESTRATION_WORKER_KEY: 'local-browser-worker-fixture-000000000000000',
  },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { rmSync(dir, { recursive: true, force: true }); process.exit(code || 0); });
