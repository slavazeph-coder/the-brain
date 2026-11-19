/** Real loopback HTTP and owner sessions, with an explicitly authored model transport.
 * No model weights, paid provider, worker processing or physical scan is exercised.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createWorldWorkerProxy } from '../../brainsnn-r3f-app/src/server/worldWorkerProxy.js';
import { createProjectReviewService } from '../../brainsnn-r3f-app/src/server/projectReview.js';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const express = require('express');
export const REVIEW_FIXTURE_PASSCODE = 'authored-review-fixture-20261118';

export async function serveProjectReviewFixture() {
  const app = express(), calls = [];
  let holdNext = false, release = null, abortedCalls = 0;
  const proxy = createWorldWorkerProxy({
    WORLD_WORKER_INTERNAL_URL: 'http://127.0.0.1:1/',
    WORLD_SITE_PASSCODE: REVIEW_FIXTURE_PASSCODE,
    WORLD_SITE_VISITORS: '1',
  });
  const service = createProjectReviewService({
    authorize: req => proxy.ownerSession(req),
    model: 'authored-transport-fixture',
    provider: 'browser-transport-fixture',
    perSessionRuns: 20,
    hourlyRuns: 100,
    generate: async ({ role, prompt, signal }) => {
      const payload = JSON.parse(prompt), project = payload.project;
      calls.push({ role, inputSha256: project.inputSha256 });
      if (holdNext) {
        holdNext = false;
        await new Promise((resolve, reject) => {
          const abort = () => { abortedCalls++; signal.removeEventListener('abort', abort); reject(signal.reason); };
          release = () => { signal.removeEventListener('abort', abort); resolve(); };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      signal.throwIfAborted();
      if (role === 'scope-planner') {
        const walls = project.components.filter(c => c.task === 'wall-finish');
        const floors = project.components.filter(c => c.task === 'floor-finish');
        const pair = (component, id) => ({ componentId: component.componentId, rateId: id });
        return JSON.stringify({
          options: [
            { id: 'option-a', title: 'Keep the floor, refresh walls', summary: 'Authored provider fixture: a bounded wall finish scope.',
              items: walls.map(c => pair(c, 'wall-standard')), assumptions: ['The existing floor is retained.'], questions: [] },
            { id: 'option-b', title: 'Renew walls and floor', summary: 'Authored provider fixture: an alternative scope. <img src=x onerror="window.__reviewXss=true">',
              items: [...walls.map(c => pair(c, 'wall-premium')), ...floors.map(c => pair(c, 'floor-premium'))],
              assumptions: ['Preparation and disposal remain separately scoped.'], questions: ['Check substrate condition on site.'] },
          ],
          questions: ['Confirm the scope and dimensions with the contractor.'],
        });
      }
      return JSON.stringify({
        summary: `${role === 'estimator' ? 'Estimator' : 'Reviewer'} transport fixture: quantities remain inferred and this is a preliminary review.`,
        findings: [{ severity: 'warning', message: 'Verify substrate preparation before a final quotation.',
          componentIds: [], optionIds: ['option-a', 'option-b'] }],
        needsRevision: false,
        recommendedOptionId: role === 'reviewer' ? 'option-a' : null,
      });
    },
  });
  app.use('/api/world/project-review', service.handle);
  app.use('/api/world', proxy.handle);
  app.use(express.static(fileURLToPath(new URL('../../brainsnn-r3f-app/public', import.meta.url))));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    get abortedCalls() { return abortedCalls; },
    hold() { holdNext = true; },
    release() { release?.(); release = null; },
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
