#!/usr/bin/env node
import { createWorldProjectService } from '../src/server/worldProjectService.js';

const help = `Provision a BrainSNN project workspace and a named API credential.

WORLD_PROJECT_DATABASE_URL (or DATABASE_URL) must name the target PostgreSQL database.
The credential appears once in this terminal. Deliver it through your private credential channel.

node scripts/world-project-admin.mjs --tenant-name "Workspace" --actor-name "Named operator" --role admin
  [--tenant-id existing_id] [--actor-id existing_principal_id] [--expires-at ISO_TIMESTAMP]

Use the same tenant ID/name and actor ID/name/role when rotating an existing principal's credential.
This command applies the additive project schema. It does not modify World processing credentials.
`;

function options(args) {
  if (args.includes('--help') || args.includes('-h')) return null;
  const allowed = new Set(['tenant-name','actor-name','role','tenant-id','actor-id','expires-at']);
  const out = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/,'');
    if (!args[index]?.startsWith('--') || !allowed.has(key) || Object.hasOwn(out,key) || !args[index+1] || args[index+1].startsWith('--')) throw new Error('Use the named options shown by --help.');
    out[key] = args[index+1];
  }
  if (!out['tenant-name'] || !out['actor-name'] || !out.role) throw new Error('Supply --tenant-name, --actor-name and --role.');
  if (out['actor-id'] && !out['tenant-id']) throw new Error('An existing principal requires --tenant-id.');
  return out;
}

let service;
try {
  const args = options(process.argv.slice(2));
  if (!args) process.stdout.write(help);
  else {
    if (!process.env.WORLD_PROJECT_DATABASE_URL && !process.env.DATABASE_URL) throw new Error('Set WORLD_PROJECT_DATABASE_URL or DATABASE_URL privately before provisioning.');
    service = createWorldProjectService();
    await service.initialize();
    const tenant = await service.provisionTenant({name:args['tenant-name'],...(args['tenant-id']?{id:args['tenant-id']}:{})});
    const created = await service.provisionKey({tenant_id:tenant.id,actor_name:args['actor-name'],role:args.role,
      ...(args['actor-id']?{actor_id:args['actor-id']}:{}),...(args['expires-at']?{expires_at:args['expires-at']}:{}),});
    process.stdout.write(JSON.stringify({tenant,...created},null,2)+'\n');
  }
} catch(error) {
  // Connection errors can contain hosts or credentials; emit only our bounded domain/usage messages.
  const safe = error?.code && error?.status ? error.message
    : /^(Use |Supply |An existing|Set WORLD_PROJECT)/.test(error?.message||'') ? error.message : 'Provisioning failed. Check the private database configuration and migration permissions.';
  process.stderr.write(safe+'\n'); process.exitCode = 1;
} finally { if (service) await service.close(); }
