#!/usr/bin/env node
/**
 * Node 22.6+. Records a world update for review in an existing World Project:
 *   node examples/world-update-apply.mjs <project-id> <path/to/project-requests.json> [--any-baseline]
 * with WORLD_PROJECT_API_URL and WORLD_PROJECT_API_KEY (an editor key). The project's current as-is revision must hold the
 * scan the walk was compared with (its reconstruction.json) as a source; --any-baseline skips that check knowingly.
 * This only proposes. A different named reviewer confirms the evidence and approves each robot's change.
 */
import { readFile } from 'node:fs/promises';
import { createProjectsClient, ProjectsApiError } from '../brainsnn-r3f-app/public/world/projects-client.mjs';
import { applyWorldUpdatePlan } from '../brainsnn-r3f-app/public/world/world-update-plan.mjs';

const args = process.argv.slice(2);
const anyBaseline = args.includes('--any-baseline');
const [projectId, planPath] = args.filter(arg => arg !== '--any-baseline');
const apiKey = process.env.WORLD_PROJECT_API_KEY;
const baseUrl = process.env.WORLD_PROJECT_API_URL;
if (!projectId || !planPath || !apiKey || !baseUrl) {
  console.error('Usage: node examples/world-update-apply.mjs <project-id> <project-requests.json> with WORLD_PROJECT_API_URL and WORLD_PROJECT_API_KEY set. Never put the key in a URL.');
  process.exitCode = 1;
} else {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (!plan.steps?.length) {
    console.log(plan.note || 'Nothing to propose.');
  } else {
    const client = createProjectsClient({ apiKey, baseUrl });
    try {
      const { project, ids } = await applyWorldUpdatePlan(client, projectId, plan, {
        baseline: anyBaseline ? 'any' : 'require',
        onStep: step => console.log(`${step.action} ${step.ref} -> ${step.id}`),
      });
      console.log(JSON.stringify({ project_id: project.id, version: project.version, created: ids,
        next: 'A different named reviewer confirms each evidence item, then approves or rejects each change.' }, null, 2));
    } catch (error) {
      if (error instanceof ProjectsApiError) {
        console.error(`${error.message} (code ${error.code}, request ${error.requestId}). Steps before this one were recorded.`);
      } else {
        console.error(error.message);
      }
      process.exitCode = 1;
    }
  }
}
