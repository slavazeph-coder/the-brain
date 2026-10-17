'use strict';
// Synthetic summaries only. No policy, simulator or retained recording is executed.
function makeReport(statuses = ['task_success', 'task_miss']) {
  const counts = Object.fromEntries(['task_success', 'task_miss', 'infrastructure_error', 'partial_recording', 'interrupted', 'unattempted'].map(key => [key, 0]));
  const cases = statuses.map((status, index) => {
    counts[status]++;
    const completed = status === 'task_success' || status === 'task_miss';
    return { index, taskId: 'libero_spatial:' + index % 10, seed: 7, status, steps: completed ? status === 'task_success' ? 30 : 220 : null, taskSuccess: completed ? status === 'task_success' : null, recordingId: completed ? 'synthetic-' + index : null, manifestSha256: completed ? 'b'.repeat(64) : null, bundlePath: completed ? 'episodes/' + index + '/recording.json' : null, resultPath: completed ? 'episodes/' + index + '/result.json' : null, initialStateId: completed ? 0 : null, initialStateSha256: completed ? 'c'.repeat(64) : null };
  });
  const completedEpisodes = counts.task_success + counts.task_miss;
  return { schema: 'brainsnn.campaign.report.v1', campaignId: 'synthetic-fixture-only', state: completedEpisodes === cases.length ? 'complete' : counts.interrupted || counts.unattempted ? 'interrupted' : 'partial', planSha256: 'a'.repeat(64), profileId: 'panda-pi05-libero', checkpointRevision: 'synthetic-no-model-executed', protocol: 'benchmark', totalEpisodes: cases.length, attemptedEpisodes: cases.length - counts.unattempted, completedEpisodes, counts, cases, elapsedSeconds: 120, execution: { sequential: true, maxConcurrentWorkers: 1, attemptsPerCase: 1, budgetEnforced: false }, coverage: { observedInitialConditions: completedEpisodes, distinctInitialConditions: completedEpisodes, repeatedInitialConditions: 0, identity: 'taskId + initialStateId', claim: 'Consecutive seeds may select repeated initial states; seeds are not unique conditions.' }, claim: 'Synthetic fixture only. No real robot policy execution.' };
}
module.exports = { makeReport };
