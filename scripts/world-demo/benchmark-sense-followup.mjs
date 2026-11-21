/** Paired evaluation of stopping at 14 points and accepting one extra allowance when offered. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  continueSenseTrial, runSenseTrial, SENSE_EXTRA_POINTS, SENSE_STRATEGIES, summarizeSenseRuns,
} from '../../brainsnn-r3f-app/public/world/sense-policy.mjs';

const bytes = readFileSync(new URL('../../tests/world/fixtures/sense-followup-seeds.json', import.meta.url));
const seeds = JSON.parse(bytes);
const initialBudget = 14;
const cases = Object.entries(seeds).flatMap(([mode, values]) => values.map(seed => ({mode, seed})));

function compare(strategy) {
  const first = [], last = [];
  let continued = 0;
  for (const testCase of cases) {
    const run = runSenseTrial({...testCase, split: 'test', task: 'find', robot: 'rover', budget: initialBudget, strategy});
    first.push(run.outcome);
    if (run.canContinue) {
      continued++;
      last.push(continueSenseTrial(run).outcome);
    } else {
      last.push(run.outcome);
    }
  }
  return {
    strategy, continued,
    initial: summarizeSenseRuns(strategy, first),
    withFollowUp: summarizeSenseRuns(strategy, last),
  };
}

console.log(JSON.stringify({
  cases: cases.length, initialBudget, extraPoints: SENSE_EXTRA_POINTS,
  seedsSha256: createHash('sha256').update(bytes).digest('hex'),
  results: SENSE_STRATEGIES.map(compare),
}, null, 2));
