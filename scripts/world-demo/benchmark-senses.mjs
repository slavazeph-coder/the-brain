/** Run the preselected, balanced second evaluation with the playground's own scorer. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runSenseTrial, SENSE_STRATEGIES, summarizeSenseRuns, trainSenseMemory} from '../../brainsnn-r3f-app/public/world/sense-policy.mjs';
import {SENSES} from '../../brainsnn-r3f-app/public/world/sense-room.mjs';

const seeds = readFileSync(new URL('../../tests/world/fixtures/sense-holdout-seeds.json', import.meta.url));
const cases = Object.entries(JSON.parse(seeds)).flatMap(([mode, list]) => list.map(seed => ({seed, mode})));
const memory = trainSenseMemory();
const summary = [];
function evaluate(task, robot, strategy, disabled = null) {
  const enabledSenses = SENSES.filter(s => s !== disabled);
  const outcomes = cases.map(params => runSenseTrial({
    ...params, task, robot, strategy, enabledSenses, memory, split: 'test', budget: 14,
  }).outcome);
  summary.push({task, robot, disabled, ...summarizeSenseRuns(strategy, outcomes)});
}
for (const strategy of SENSE_STRATEGIES) {
  evaluate('find', 'rover', strategy);
  evaluate('find', 'forklift', strategy);
  evaluate('delivery', 'rover', strategy);
}
for (const sense of SENSES) evaluate('find', 'rover', 'memory', sense);
console.log(JSON.stringify({
  cases: cases.length, budget: 14, split: 'test', trainingCases: memory.trainingCases,
  seedsSha256: createHash('sha256').update(seeds).digest('hex'), summary,
}, null, 2));
