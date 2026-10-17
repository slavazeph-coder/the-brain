/* Exact-robot campaign drafts and local report inspection. No compute is started here. */
(() => {
  'use strict';
  const MAX_SEED = 2147483647;
  const MAX_REPORT_BYTES = 2 * 1024 * 1024;
  const REPORT_STATUSES = Object.freeze(['task_success', 'task_miss', 'infrastructure_error', 'partial_recording', 'interrupted', 'unattempted']);
  const REPORT_LABELS = Object.freeze({ task_success: 'Task success', task_miss: 'Task miss', infrastructure_error: 'Infrastructure error', partial_recording: 'Partial recording', interrupted: 'Interrupted', unattempted: 'Not attempted' });
  const LIMITS = Object.freeze({ trials: 100000, workers: 256, dollars: 1000000, hourlyRate: 10000, pilotEpisodes: 10000000, elapsedSeconds: 31536000, loadingMinutes: 1440 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isBlank = value => value == null || String(value).trim() === '';
  const number = value => isBlank(value) ? null : Number(value);
  const currency = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const decimal = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  const initialFields = () => ({ totalTrials: '10', maxWorkers: '1', startSeed: '42', costCeilingUSD: '100', pilotEpisodes: '', pilotElapsedSeconds: '', pilotWorkers: '', hourlyRateUSD: '', loadingMinutes: '0', storageUSD: '0', egressUSD: '0', provider: 'unassigned', taskId: '', protocol: 'benchmark' });

  function validate(input = {}, profile = null) {
    const errors = {}, values = {};
    function numeric(key, title, min, max, integer = false, optional = false) {
      const value = number(input[key]);
      if (value === null && optional) { values[key] = null; return; }
      if (value === null || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
        errors[key] = title + ' must be ' + (integer ? 'a whole number ' : 'a number ') + 'from ' + min.toLocaleString('en-US') + ' to ' + max.toLocaleString('en-US') + '.';
      } else values[key] = value;
    }
    numeric('totalTrials', 'Total trials', 1, LIMITS.trials, true);
    numeric('maxWorkers', 'Simultaneous workers', 1, LIMITS.workers, true);
    numeric('startSeed', 'First seed', 0, MAX_SEED, true);
    numeric('costCeilingUSD', 'Spending limit', 0.01, LIMITS.dollars);
    numeric('loadingMinutes', 'Loading minutes per worker', 0, LIMITS.loadingMinutes);
    numeric('storageUSD', 'Storage allowance', 0, LIMITS.dollars);
    numeric('egressUSD', 'Transfer allowance', 0, LIMITS.dollars);
    if (values.maxWorkers > values.totalTrials) errors.maxWorkers = 'Use no more workers than total trials.';
    if (Number.isSafeInteger(values.startSeed) && Number.isSafeInteger(values.totalTrials) && values.startSeed + values.totalTrials - 1 > MAX_SEED) errors.startSeed = 'This seed range exceeds 2,147,483,647. Choose a smaller first seed.';
    const pilotKeys = ['pilotEpisodes', 'pilotElapsedSeconds', 'pilotWorkers', 'hourlyRateUSD'];
    const hasPilot = pilotKeys.some(key => !isBlank(input[key]));
    numeric('pilotEpisodes', 'Completed pilot episodes', 1, LIMITS.pilotEpisodes, true, !hasPilot);
    numeric('pilotElapsedSeconds', 'Pilot elapsed seconds', 0.001, LIMITS.elapsedSeconds, false, !hasPilot);
    numeric('pilotWorkers', 'Pilot workers', 1, LIMITS.workers, true, !hasPilot);
    numeric('hourlyRateUSD', 'Price per worker-hour', 0.000001, LIMITS.hourlyRate, false, !hasPilot);
    values.taskId = String(input.taskId ?? '').trim();
    values.protocol = String(input.protocol ?? 'practice');
    values.provider = String(input.provider ?? 'unassigned');
    if (!['unassigned', 'vast', 'runpod', 'huggingface', 'own'].includes(values.provider)) errors.provider = 'Choose one of the listed compute destinations.';
    if (!profile || typeof profile.id !== 'string' || typeof profile.robotId !== 'string' || typeof profile.modelId !== 'string') errors.profile = 'Choose an exact robot and model recipe.';
    if (!values.taskId || values.taskId.length > 300) errors.taskId = 'Enter the exact task ID, up to 300 characters.';
    if (!['practice', 'benchmark'].includes(values.protocol) || (profile && !profile.protocols?.includes(values.protocol))) errors.protocol = 'Choose a protocol supported by this recipe.';
    return { valid: Object.keys(errors).length === 0, errors, values, hasPilot };
  }

  function estimate(input, profile) {
    const checked = validate(input, profile);
    if (!checked.valid || !checked.hasPilot) return null;
    const v = checked.values;
    const episodesPerWorkerSecond = v.pilotEpisodes / (v.pilotElapsedSeconds * v.pilotWorkers);
    const runtimeWorkerHours = v.totalTrials / episodesPerWorkerSecond / 3600;
    const loadingWorkerHours = v.maxWorkers * v.loadingMinutes / 60;
    const runtimeWallHours = runtimeWorkerHours / v.maxWorkers;
    const wallHours = runtimeWallHours + v.loadingMinutes / 60;
    const computeUSD = (runtimeWorkerHours + loadingWorkerHours) * v.hourlyRateUSD;
    const totalUSD = computeUSD + v.storageUSD + v.egressUSD;
    return { episodesPerWorkerSecond, runtimeWorkerHours, loadingWorkerHours, runtimeWallHours, wallHours, computeUSD, storageUSD: v.storageUSD, egressUSD: v.egressUSD, totalUSD, withinCeiling: totalUSD <= v.costCeilingUSD, remainingUSD: v.costCeilingUSD - totalUSD };
  }

  function buildPlan(input, profile, arenaSelection = null) {
    const checked = validate(input, profile);
    if (!checked.valid) { const error = new Error('Correct the campaign fields before exporting.'); error.errors = checked.errors; throw error; }
    const v = checked.values;
    const requirements = [
      'An external orchestrator must validate this plan, enforce the spending limit and start workers.',
      'Pin and verify the checkpoint revision, saved processors, simulator version, environment assets and container image.',
      'Verify the complete robot, observation, action, controller and timing contract on the chosen worker.',
      'Measure the same task, hardware and recording settings before accepting this estimate.',
      'Track billed loading, retries, idle time, storage and transfers; stop and release resources at the limit.'
    ];
    if (profile.reason) requirements.push(profile.reason);
    if (!profile.tasks?.some(task => task.id === v.taskId)) requirements.push('The supplied task ID is not in this local recipe; verify it with the worker.');
    const plan = {
      schema: 'brainsnn.campaign.plan.v1', status: 'draft', execution: { state: 'plan-only', workersStarted: 0, providerConnected: false, budgetEnforced: false },
      recipe: clone(profile), selection: { robotId: profile.robotId, modelId: profile.modelId, profileId: profile.id, taskId: v.taskId, protocol: v.protocol },
      arenaSelection: arenaSelection ? { robotId: arenaSelection.robotId || null, modelId: arenaSelection.modelId || null, task: arenaSelection.task || null, seed: arenaSelection.seed ?? null } : null,
      trials: { total: v.totalTrials, seeds: { strategy: 'consecutive', first: v.startSeed, last: v.startSeed + v.totalTrials - 1, count: v.totalTrials }, attemptsPerSeed: 1, countMeaning: 'Complete episodes; not concurrently rendered worlds.' },
      scheduling: { provider: v.provider, maxConcurrentWorkers: v.maxWorkers, desiredEpisodeRetries: 0, semantics: 'Planning request only. Provider capacity and per-worker concurrency are unverified.' },
      budget: { currency: 'USD', ceiling: v.costCeilingUSD, enforcement: 'external-orchestrator-required', loadingMinutesPerWorker: v.loadingMinutes, storageAllowance: v.storageUSD, transferAllowance: v.egressUSD },
      pilot: checked.hasPilot ? { source: 'user-entered-unverified', completedEpisodes: v.pilotEpisodes, elapsedSeconds: v.pilotElapsedSeconds, workers: v.pilotWorkers, pricePerWorkerHourUSD: v.hourlyRateUSD } : null,
      estimate: estimate(input, profile),
      assumptions: ['All pilot workers were allocated for the entered elapsed time.', 'Future workers match the pilot hardware, task, policy, camera and recording settings.', 'Worker throughput scales linearly; queue delays, retries, throttling and extra idle time are excluded.', 'Loading is a separate allowance and must not already be counted in pilot elapsed time.'],
      requirements
    };
    return plan;
  }

  function parseReport(source) {
    if (typeof source !== 'string' || source.length > MAX_REPORT_BYTES) throw new Error('Report must be a JSON file no larger than 2 MiB.');
    // Count UTF-8 bytes as well as JS characters without allocating an encoded copy.
    let bytes = 0;
    for (const character of source) { const point = character.codePointAt(0); bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; if (bytes > MAX_REPORT_BYTES) throw new Error('Report must be no larger than 2 MiB.'); }
    let value;
    try { value = JSON.parse(source); } catch { throw new Error('Invalid JSON. Choose the campaign report written by the runner.'); }
    const object = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    const integer = (item, min, max) => Number.isSafeInteger(item) && item >= min && item <= max;
    const text = (item, max = 300) => typeof item === 'string' && item.length > 0 && item.length <= max;
    const nullableText = (item, max) => item === null || text(item, max);
    const hash = item => typeof item === 'string' && /^[a-f0-9]{64}$/i.test(item);
    function require(condition, message) { if (!condition) throw new Error(message); }
    require(object(value) && value.schema === 'brainsnn.campaign.report.v1', 'Unsupported report. Expected brainsnn.campaign.report.v1.');
    require(text(value.campaignId) && hash(value.planSha256) && text(value.checkpointRevision), 'Report identity, plan hash or checkpoint revision is missing or invalid.');
    require(value.profileId === 'panda-pi05-libero' && value.protocol === 'benchmark', 'This viewer supports locked Panda + π0.5 LIBERO campaign reports.');
    require(['complete', 'partial', 'interrupted'].includes(value.state), 'Unsupported campaign state.');
    require(integer(value.totalEpisodes, 1, 10), 'This runner supports reports containing 1 to 10 episodes. Larger packs remain unqualified.');
    require(integer(value.attemptedEpisodes, 0, value.totalEpisodes) && integer(value.completedEpisodes, 0, value.totalEpisodes), 'Report episode totals are invalid.');
    require(typeof value.elapsedSeconds === 'number' && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0, 'Report elapsed time is invalid.');
    require(object(value.execution) && value.execution.sequential === true && value.execution.maxConcurrentWorkers === 1 && value.execution.attemptsPerCase === 1 && value.execution.budgetEnforced === false, 'Report must describe sequential execution, one worker and one attempt per case, without enforced billing.');
    require(object(value.counts) && REPORT_STATUSES.every(key => integer(value.counts[key], 0, value.totalEpisodes)), 'Report outcome counts are missing or invalid.');
    require(Array.isArray(value.cases) && value.cases.length === value.totalEpisodes, 'Report must include exactly one case for every planned episode.');
    const counted = Object.fromEntries(REPORT_STATUSES.map(key => [key, 0]));
    for (const [index, item] of value.cases.entries()) {
      require(object(item) && item.index === index && /^libero_spatial:[0-9]$/.test(item.taskId) && integer(item.seed, 0, MAX_SEED) && REPORT_STATUSES.includes(item.status), 'Each case needs an ordered index, supported task, valid seed and recognized outcome.');
      counted[item.status]++;
      const completed = item.status === 'task_success' || item.status === 'task_miss';
      require(item.steps === null || integer(item.steps, 0, 220), 'Case step count is invalid.');
      require(nullableText(item.recordingId, 300) && (item.manifestSha256 === null || hash(item.manifestSha256)) && nullableText(item.bundlePath, 4096) && nullableText(item.resultPath, 4096), 'Case evidence references are missing or invalid.');
      require(completed ? item.taskSuccess === (item.status === 'task_success') && item.steps !== null && text(item.recordingId) && hash(item.manifestSha256) && text(item.bundlePath, 4096) && text(item.resultPath, 4096) : item.taskSuccess === null, 'Only completed episodes can report a task success or miss, with complete evidence references.');
      require(item.status !== 'task_success' || item.steps > 0, 'A completed task success must contain policy steps.');
      require(item.status !== 'task_miss' || item.steps === 220, 'A completed LIBERO Spatial task miss must reach its 220-step horizon.');
      require(item.status !== 'unattempted' || ['steps', 'recordingId', 'manifestSha256', 'bundlePath', 'resultPath'].every(key => item[key] === null) && item.initialStateId == null && item.initialStateSha256 == null, 'An unattempted case cannot contain execution evidence.');
      require(item.initialStateId === undefined || item.initialStateId === null || integer(item.initialStateId, 0, MAX_SEED), 'Initial-state ID is invalid.');
      require(item.initialStateSha256 === undefined || item.initialStateSha256 === null || hash(item.initialStateSha256), 'Initial-state hash is invalid.');
    }
    require(REPORT_STATUSES.every(key => counted[key] === value.counts[key]), 'Outcome counts do not match the episode cases.');
    require(value.completedEpisodes === counted.task_success + counted.task_miss && value.attemptedEpisodes === value.totalEpisodes - counted.unattempted, 'Completed or attempted episode totals do not match the outcomes.');
    require(value.state === 'complete' ? value.completedEpisodes === value.totalEpisodes : value.state === 'partial' ? value.completedEpisodes < value.totalEpisodes && counted.unattempted === 0 && counted.interrupted === 0 : counted.interrupted > 0 || counted.unattempted > 0, 'Campaign state contradicts its episode outcomes.');
    if (value.coverage !== undefined) {
      const coverage = value.coverage;
      require(object(coverage) && integer(coverage.observedInitialConditions, 0, value.attemptedEpisodes) && integer(coverage.distinctInitialConditions, 0, coverage.observedInitialConditions) && coverage.repeatedInitialConditions === coverage.observedInitialConditions - coverage.distinctInitialConditions, 'Initial-condition coverage counts are invalid.');
      const observed = value.cases.filter(item => item.initialStateId != null);
      const distinct = new Set(observed.map(item => JSON.stringify([item.taskId, item.initialStateId])));
      require(coverage.observedInitialConditions === observed.length && coverage.distinctInitialConditions === distinct.size, 'Initial-condition coverage does not match the episode cases.');
    }
    return value;
  }

  function node(tag, content, className) {
    const element = document.createElement(tag);
    if (content != null) element.textContent = String(content);
    if (className) element.className = className;
    return element;
  }
  function reportDetail(target, label, value) { target.appendChild(node('dt', label)); target.appendChild(node('dd', value)); }
  function renderReport(report) {
    const target = root.querySelector('[data-campaign-report]');
    target.replaceChildren(); target.hidden = false;
    const state = { complete: 'Complete execution', partial: 'Partial campaign', interrupted: 'Interrupted campaign' }[report.state];
    target.appendChild(node('p', state + ' · ' + report.completedEpisodes + '/' + report.totalEpisodes + ' episodes completed', 'campaign-report-state ' + report.state));
    target.appendChild(node('p', 'Imported summary · not independently verified. A completed task miss is a valid evaluation outcome. Infrastructure errors, partial recordings and interruptions are excluded from completed episodes.', 'campaign-copy'));
    const totals = node('div', null, 'campaign-report-totals');
    for (const status of REPORT_STATUSES) { const item = node('div'); item.appendChild(node('strong', report.counts[status])); item.appendChild(node('span', REPORT_LABELS[status])); totals.appendChild(item); }
    target.appendChild(totals);
    if (report.coverage) target.appendChild(node('p', report.coverage.distinctInitialConditions + ' distinct initial conditions from ' + report.coverage.observedInitialConditions + ' observed · ' + report.coverage.repeatedInitialConditions + ' repeats. Consecutive seeds may select repeated initial states; seeds are not unique conditions.', 'campaign-report-coverage'));
    const metadata = node('dl', null, 'campaign-report-metadata');
    for (const [label, value] of [['Campaign', report.campaignId], ['Recipe', 'Panda + π0.5 · LIBERO Spatial · locked run'], ['Checkpoint revision', report.checkpointRevision], ['Elapsed', decimal(report.elapsedSeconds) + ' seconds'], ['Plan SHA-256', report.planSha256]]) reportDetail(metadata, label, value);
    target.appendChild(metadata);
    const scroll = node('div', null, 'campaign-report-table-wrap'), table = node('table', null, 'campaign-report-table');
    table.appendChild(node('caption', 'Episode outcomes and local evidence files'));
    const head = node('thead'), headings = node('tr');
    for (const label of ['Episode / task', 'Seed / initial state', 'Outcome / steps', 'Evidence to inspect']) { const cell = node('th', label); cell.setAttribute('scope', 'col'); headings.appendChild(cell); }
    head.appendChild(headings); table.appendChild(head);
    const body = node('tbody');
    for (const item of report.cases) {
      const row = node('tr');
      const identity = node('td'); identity.appendChild(node('strong', (item.index + 1) + ' · ' + item.taskId)); row.appendChild(identity);
      const seed = node('td', item.seed); seed.appendChild(node('small', item.initialStateId == null ? 'Initial state not recorded' : 'Initial state ' + item.initialStateId)); row.appendChild(seed);
      if (item.initialStateSha256) seed.appendChild(node('small', 'State SHA-256: ' + item.initialStateSha256));
      const outcome = node('td'); outcome.appendChild(node('strong', REPORT_LABELS[item.status], 'campaign-report-outcome ' + item.status)); outcome.appendChild(node('small', item.steps == null ? 'Steps unavailable' : item.steps + ' steps')); row.appendChild(outcome);
      const evidence = node('td');
      if (item.bundlePath) evidence.appendChild(node('code', item.bundlePath)); else evidence.appendChild(node('span', 'No retained bundle reference'));
      if (item.resultPath) evidence.appendChild(node('code', item.resultPath));
      if (item.recordingId) evidence.appendChild(node('small', 'Recording: ' + item.recordingId));
      if (item.manifestSha256) evidence.appendChild(node('small', 'Manifest SHA-256: ' + item.manifestSha256));
      row.appendChild(evidence); body.appendChild(row);
    }
    table.appendChild(body); scroll.appendChild(table); target.appendChild(scroll);
    target.appendChild(node('p', 'Open each retained episode bundle manually in the Arena inspector to check its manifest, frames and completion. File paths are references on the operator’s machine. This report does not verify policy execution, enforce spending limits or qualify larger campaigns.', 'campaign-report-note'));
  }
  let reportImportSequence = 0;
  async function importReportFile(file) {
    if (!root || !file) return null;
    const sequence = ++reportImportSequence;
    const status = root.querySelector('[data-campaign-report-status]'), target = root.querySelector('[data-campaign-report]');
    target.replaceChildren(); target.hidden = true;
    status.textContent = 'Opening local report…';
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_REPORT_BYTES || typeof file.text !== 'function') throw new Error('Choose a JSON report no larger than 2 MiB.');
      const source = await file.text();
      if (sequence !== reportImportSequence) return null;
      const report = parseReport(source);
      renderReport(report);
      status.textContent = 'Opened ' + String(file.name || 'campaign report').slice(0, 160) + ' locally. Summary remains unverified.';
      return report;
    } catch (error) {
      if (sequence === reportImportSequence) status.textContent = 'Could not open report: ' + error.message;
      return null;
    }
  }

  let root = null, fields = initialFields(), selection = null, profile = null, manualProfile = false, lastArenaKey = null;
  function registry() { return window.BrainSNNArenaProfiles; }
  function field(key) { return root?.querySelector('[data-campaign-field="' + key + '"]'); }
  function capture() { if (root) for (const element of root.querySelectorAll('[data-campaign-field]')) fields[element.dataset.campaignField] = element.value; }
  function clearPilot() { for (const key of ['pilotEpisodes', 'pilotElapsedSeconds', 'pilotWorkers', 'hourlyRateUSD']) { fields[key] = ''; if (field(key)) field(key).value = ''; } }
  function fillTaskAndProtocol(previousId) {
    if (profile?.id !== previousId) {
      clearPilot();
      fields.taskId = !manualProfile && selection?.task ? selection.task : profile?.tasks?.[0]?.id || '';
      fields.protocol = profile?.protocols?.includes('benchmark') ? 'benchmark' : profile?.protocols?.[0] || 'practice';
      if (field('taskId')) field('taskId').value = fields.taskId;
    }
    const protocol = field('protocol');
    if (protocol) { protocol.innerHTML = (profile?.protocols || ['practice']).map(value => '<option value="' + esc(value) + '">' + (value === 'benchmark' ? 'Locked run · fixed conditions' : 'Practice · logged interventions') + '</option>').join(''); protocol.value = fields.protocol; }
    const tasks = root?.querySelector('#campaign-task-options');
    if (tasks) tasks.innerHTML = (profile?.tasks || []).map(task => '<option value="' + esc(task.id) + '">' + esc(task.label) + '</option>').join('');
  }
  function refreshSelection(force = false) {
    if (!root) return;
    capture();
    selection = window.BrainSNNExperiment?.getState?.() || null;
    const arenaKey = JSON.stringify(selection ? [selection.robotId, selection.modelId, selection.task, selection.seed, selection.protocol, selection.mode] : null);
    const changed = arenaKey !== lastArenaKey || force === true; lastArenaKey = arenaKey;
    const previousId = profile?.id;
    if (!manualProfile) {
      profile = selection?.mode !== 'demo' ? registry()?.findForSelection?.(selection || {}) || null : null;
      if (changed) {
        if (selection?.seed != null && !isBlank(selection.seed)) { fields.startSeed = String(selection.seed); if (field('startSeed')) field('startSeed').value = fields.startSeed; }
        const nextTask = selection?.task || profile?.tasks?.[0]?.id || '';
        const nextProtocol = profile?.protocols?.includes(selection?.protocol) ? selection.protocol : profile?.protocols?.[0] || 'practice';
        if (fields.taskId !== nextTask || fields.protocol !== nextProtocol) clearPilot();
        fields.taskId = nextTask; fields.protocol = nextProtocol; if (field('taskId')) field('taskId').value = fields.taskId;
      }
    }
    fillTaskAndProtocol(previousId);
    renderProfile(); update();
  }
  function renderProfile() {
    const picker = root.querySelector('[data-campaign-profile]');
    picker.innerHTML = '<option value="">Choose an exact recipe</option>' + (registry()?.list?.() || []).map(item => '<option value="' + esc(item.id) + '">' + esc(item.name + ' · ' + item.environment) + '</option>').join('');
    picker.value = profile?.id || '';
    const summary = root.querySelector('[data-campaign-profile-summary]');
    const preserved = !profile && selection?.robotId && selection?.modelId;
    summary.innerHTML = profile
      ? '<strong>' + esc(profile.name) + '</strong><p>' + esc(profile.description || profile.environment) + '</p><span>' + (manualProfile ? 'Selected for this campaign' : 'Following your Arena selection') + ' · Recipe only</span><p class="campaign-requirement">' + esc(profile.reason || 'Connect and verify a matching worker before execution.') + '</p>'
      : '<strong>' + (preserved ? 'Your Arena pair is preserved' : 'Choose the robot and brain to test') + '</strong><p>' + (preserved ? esc(selection.robotId + ' + ' + selection.modelId) + ' has no exact local campaign recipe. Select a recipe explicitly to plan a separate campaign.' : 'Select a matched recipe below, or choose a robot and model in the Arena.') + '</p>';
  }
  function update() {
    if (!root) return;
    capture();
    const checked = validate(fields, profile), result = estimate(fields, profile);
    for (const element of root.querySelectorAll('[data-campaign-field]')) {
      const error = checked.errors[element.dataset.campaignField];
      element.setAttribute('aria-invalid', error ? 'true' : 'false');
      const target = root.querySelector('[data-campaign-error="' + element.dataset.campaignField + '"]');
      if (target) target.textContent = error || '';
    }
    const seed = root.querySelector('[data-campaign-seeds]');
    seed.textContent = checked.errors.startSeed || checked.errors.totalTrials ? 'Choose a valid seed range.' : 'Seeds ' + decimal(checked.values.startSeed) + '–' + decimal(checked.values.startSeed + checked.values.totalTrials - 1) + ' · one episode per seed';
    const summary = root.querySelector('[data-campaign-estimate]');
    summary.innerHTML = result ? '<div><span>Estimated worker-hours</span><strong>' + decimal(result.runtimeWorkerHours + result.loadingWorkerHours) + '</strong></div><div><span>Ideal elapsed time</span><strong>' + decimal(result.wallHours) + ' h</strong></div><div><span>Estimated total</span><strong>' + currency(result.totalUSD) + '</strong></div><p class="campaign-budget ' + (result.withinCeiling ? 'within' : 'over') + '">' + (result.withinCeiling ? currency(result.remainingUSD) + ' below your limit' : currency(-result.remainingUSD) + ' above your limit. Reduce trials or revise the plan.') + '</p><p class="campaign-estimate-note">Based on your pilot inputs and linear scaling. Includes ' + currency(result.computeUSD) + ' compute, ' + currency(result.storageUSD) + ' storage and ' + currency(result.egressUSD) + ' transfer allowance. Queue time, retries and additional idle time are excluded.</p>'
      : '<div class="campaign-estimate-empty"><span class="campaign-orbit" aria-hidden="true">◎</span><strong>Measure first. Scale with evidence.</strong><p>Enter completed pilot episodes, elapsed seconds, worker count and price to calculate this exact campaign.</p></div>';
    const download = root.querySelector('[data-campaign-export]'); download.disabled = !checked.valid;
    root.querySelector('[data-campaign-export-note]').textContent = checked.valid ? (result && !result.withinCeiling ? 'This draft is over budget. Its limit must be enforced by your orchestrator.' : 'Downloads a draft with the recipe, seeds, budget and unresolved setup requirements.') : checked.errors.profile || checked.errors.taskId || 'Correct the highlighted fields to export this plan.';
    root.querySelectorAll('[data-campaign-trials]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.campaignTrials === fields.totalTrials)));
    const note = root.querySelector('[data-campaign-operator-note]');
    note.textContent = profile?.id !== 'panda-pi05-libero' ? 'This recipe remains a planning draft. The current runner supports Panda + π0.5 LIBERO only.'
      : fields.protocol !== 'benchmark' ? 'This practice plan will be rejected by the runner. Choose a locked run to prepare an executable pack.'
      : number(fields.totalTrials) > 10 || number(fields.maxWorkers) !== 1 ? 'This plan exceeds the current runner limits: at most ten episodes, one worker and no retries. Larger campaigns remain unqualified.'
      : !/^libero_spatial:[0-9]$/.test(fields.taskId) ? 'The current runner accepts LIBERO Spatial task IDs 0–9. This task remains a draft.'
      : checked.valid ? 'This draft fits the runner’s episode, recipe and protocol limits. Hardware, policy execution and retained evidence still require operator validation.'
      : 'Correct the highlighted fields before using this draft with the runner.';
  }
  function input(key, label, attrs = '', help = '') {
    return '<label class="campaign-field"><span>' + label + '</span><input data-campaign-field="' + key + '" value="' + esc(fields[key]) + '" ' + attrs + ' aria-describedby="campaign-' + key + '-help campaign-' + key + '-error"><small id="campaign-' + key + '-help">' + help + '</small><small id="campaign-' + key + '-error" data-campaign-error="' + key + '" class="campaign-field-error"></small></label>';
  }
  function mount(element) {
    if (!element) return;
    root = element;
    if (root.dataset.campaignMounted === 'true') { refreshSelection(); return; }
    root.dataset.campaignMounted = 'true';
    root.innerHTML = '<div class="campaign-heading"><div><p class="campaign-kicker">TEST PACKS</p><h1>Test packs &amp; pricing</h1><p>Choose a test size. See the assumptions behind its price.</p></div></div><div id="arena-runtime-pricing" data-arena-pricing></div><section class="campaign-pack" aria-labelledby="campaign-pack-title"><div class="campaign-pack-heading"><span class="campaign-pack-count" aria-hidden="true">10</span><div><p class="campaign-kicker">FIRST PACK · IN QUALIFICATION</p><h2 id="campaign-pack-title">10-episode test pack</h2></div></div><p class="campaign-pack-description">One robot, one policy, ten fixed tasks. Each episode is one task attempt.</p><p class="campaign-pack-recipe">Initial recipe: Panda + π0.5 · LIBERO Spatial.</p><p class="campaign-pack-readiness" data-campaign-readiness>Current kit: up to ten sequential Panda + π0.5 episodes, after a verified GPU pilot.</p><div class="campaign-pack-deliverables"><h4>Each qualified pack includes…</h4><ul><li>A report of task successes, completed misses and execution errors.</li><li>Retained per-episode recordings to inspect and replay.</li><li>The policy, task and initial-condition details behind each result.</li></ul></div><div class="campaign-pack-actions"><button type="button" class="campaign-arcade-cta" data-page="playground">Try the arcade <span aria-hidden="true">↗</span></button><p><strong>Demo available now.</strong> Scripted local practice lets you explore tasks; it is not a policy score.</p></div></section><details class="campaign-tools" data-campaign-tools><summary>Operator tools</summary><div class="campaign-tools-content"><section class="campaign-evidence" aria-label="Evaluation reports"><div class="campaign-section-heading"><span>↓</span><h3>Inspect an evaluation report</h3></div><p class="campaign-copy">Open the JSON summary from the ten-episode runner. Completed task successes and misses stay separate from infrastructure errors, partial recordings and interruptions.</p><label class="campaign-report-picker"><span>Open report JSON</span><input type="file" accept="application/json,.json" data-campaign-report-file aria-label="Open campaign report JSON"><small>Local file · maximum 2 MiB · no upload</small></label><p class="campaign-download-status" data-campaign-report-status role="status" aria-live="polite"></p><div data-campaign-report hidden></div></section><details class="campaign-operator"><summary>Run the ten-episode pack</summary><p>A configured Panda + π0.5 LIBERO worker and a verified retained pilot are required. The default pack runs the ten LIBERO Spatial tasks at seed 7, one after another. An exported plan runs up to ten consecutive seeds for its selected task.</p><pre><code>python scripts/run-campaign.py --url "$ARENA_WORKER_URL" --origin "$ARENA_ORIGIN" --pilot "$PILOT_DIR" --out "$CAMPAIGN_DIR"</code></pre><p>Run from the worker kit directory. Pass <code>--plan draft.json</code> to use your exported selection. Use <code>--resume</code> to continue an interrupted output directory. Open the resulting <code>report.json</code> above and inspect each retained episode bundle in the Arena inspector.</p><p data-campaign-operator-note></p><a href="evaluation-setup.html">Worker setup, evidence requirements and limits ↗</a></details><div class="campaign-plan-heading"><h3>Plan your next evaluation pack</h3><p>The 1,000 and 100,000 episode options are unqualified drafts. They require external orchestration, measured capacity and cost controls.</p></div><div class="campaign-layout"><section class="campaign-config" aria-label="Campaign configuration"><div class="campaign-section-heading"><span>01</span><h3>One exact recipe</h3><button type="button" class="campaign-text-button" data-campaign-use-arena>Use Arena selection ↗</button></div><div class="campaign-profile-summary" data-campaign-profile-summary></div><label class="campaign-field"><span>Robot + brain + environment</span><select data-campaign-profile aria-label="Campaign recipe"></select></label><div class="campaign-two">' + input('taskId', 'Task ID', 'type="text" maxlength="300" list="campaign-task-options"', 'Must match the worker task. Visible labels are not task IDs.') + '<label class="campaign-field"><span>Experiment protocol</span><select data-campaign-field="protocol"></select><small>The ten-episode runner accepts locked runs only. Practice stays a draft.</small><small data-campaign-error="protocol" class="campaign-field-error"></small></label></div><datalist id="campaign-task-options"></datalist><div class="campaign-section-heading"><span>02</span><h3>Define the test set</h3></div><div class="campaign-trial-pills" role="group" aria-label="Total trial presets">' + [['1', '1 pilot'], ['10', '10 test'], ['1000', '1,000 plan'], ['10000', '10,000 plan'], ['100000', '100,000 plan']].map(([value, label]) => '<button type="button" data-campaign-trials="' + value + '" aria-pressed="false">' + label + '</button>').join('') + '</div><div class="campaign-two">' + input('totalTrials', 'Total trial episodes', 'type="number" min="1" max="100000" step="1" inputmode="numeric"', 'Ten episodes can run sequentially; larger packs are drafts.') + input('maxWorkers', 'Simultaneous workers', 'type="number" min="1" max="256" step="1" inputmode="numeric"', 'Independent from total trial count.') + '</div><div class="campaign-two">' + input('startSeed', 'First seed', 'type="number" min="0" max="2147483647" step="1" inputmode="numeric"', 'Consecutive seeds; maximum 2,147,483,647.') + input('costCeilingUSD', 'Spending limit · USD', 'type="number" min="0.01" max="1000000" step="any" inputmode="decimal"', 'A requested limit. Enforcement requires an orchestrator.') + '</div><p class="campaign-seeds" data-campaign-seeds></p></section><aside class="campaign-sizing" aria-label="Pilot measurement and estimate"><div class="campaign-section-heading"><span>03</span><h3>Size from your pilot</h3></div><p class="campaign-copy">Use measurements from this recipe on the hardware you intend to use. Changing the recipe clears these inputs.</p><div class="campaign-two">' + input('pilotEpisodes', 'Completed episodes', 'type="number" min="1" max="10000000" step="1" inputmode="numeric" placeholder="Enter count"', 'Count successful and failed completed trials.') + input('pilotElapsedSeconds', 'Elapsed seconds', 'type="number" min="0.001" max="31536000" step="any" inputmode="decimal" placeholder="Enter seconds"', 'Wall time, excluding the separate loading allowance.') + input('pilotWorkers', 'Workers in pilot', 'type="number" min="1" max="256" step="1" inputmode="numeric" placeholder="Enter count"', 'Allocated for the full measured duration.') + input('hourlyRateUSD', 'USD per worker-hour', 'type="number" min="0.000001" max="10000" step="any" inputmode="decimal" placeholder="Your provider rate"', 'Enter the price for the measured hardware.') + '</div><details class="campaign-allowances"><summary>Compute destination & cost allowances</summary><label class="campaign-field"><span>Planned destination</span><select data-campaign-field="provider"><option value="unassigned">Choose later</option><option value="vast">Vast</option><option value="runpod">Runpod</option><option value="huggingface">Hugging Face Jobs</option><option value="own">Own worker</option></select><small>Destination preference only. No provider is connected.</small></label>' + input('loadingMinutes', 'Loading minutes per worker', 'type="number" min="0" max="1440" step="any" inputmode="decimal"', 'Billed loading allowance, additional to pilot time.') + '<div class="campaign-two">' + input('storageUSD', 'Storage allowance · USD', 'type="number" min="0" max="1000000" step="any" inputmode="decimal"', 'Enter a total campaign allowance.') + input('egressUSD', 'Transfer allowance · USD', 'type="number" min="0" max="1000000" step="any" inputmode="decimal"', 'Enter a total campaign allowance.') + '</div></details><div class="campaign-estimate" data-campaign-estimate aria-live="polite"></div><button type="button" class="campaign-export" data-campaign-export>Export campaign plan <span aria-hidden="true">↓</span></button><p class="campaign-export-note" data-campaign-export-note></p><p class="campaign-download-status" data-campaign-download-status role="status"></p></aside></div></div></details>';
    window.BrainSNNArenaPricing?.mount?.(root.querySelector('[data-arena-pricing]'));
    root.addEventListener('input', event => { if (event.target.matches('[data-campaign-field]')) { if (['taskId', 'protocol', 'provider'].includes(event.target.dataset.campaignField)) clearPilot(); update(); } });
    root.addEventListener('change', event => {
      if (event.target.matches('[data-campaign-profile]')) { capture(); const old = profile?.id; manualProfile = true; profile = registry()?.find?.(event.target.value) || null; fillTaskAndProtocol(old); renderProfile(); update(); }
      else if (event.target.matches('[data-campaign-report-file]')) { const file = event.target.files?.[0]; if (file) importReportFile(file); event.target.value = ''; }
      else if (event.target.matches('[data-campaign-field]')) { if (['taskId', 'protocol', 'provider'].includes(event.target.dataset.campaignField)) clearPilot(); update(); }
    });
    root.addEventListener('click', event => {
      if (event.target.closest('[data-page="playground"]')) { window.BrainSNNWorkspace?.showPage?.('playground'); window.BrainSNNExperiment?.restoreFromURL?.(); }
      const preset = event.target.closest('[data-campaign-trials]');
      if (preset) { fields.totalTrials = preset.dataset.campaignTrials; field('totalTrials').value = fields.totalTrials; if (number(fields.totalTrials) <= 10) fields.maxWorkers = '1'; else if (number(fields.maxWorkers) > number(fields.totalTrials)) fields.maxWorkers = fields.totalTrials; field('maxWorkers').value = fields.maxWorkers; update(); }
      if (event.target.closest('[data-campaign-use-arena]')) { manualProfile = false; refreshSelection(true); }
      if (event.target.closest('[data-campaign-export]')) {
        capture();
        try {
          const plan = buildPlan(fields, profile, selection), blob = new Blob([JSON.stringify(plan, null, 2) + '\n'], { type: 'application/json' });
          const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'brainsnn-' + profile.id + '-' + plan.trials.total + '-trial-plan.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          root.querySelector('[data-campaign-download-status]').textContent = 'Campaign draft downloaded. No workers started.';
        } catch (error) { root.querySelector('[data-campaign-download-status]').textContent = error.message; }
      }
    });
    refreshSelection();
  }
  window.BrainSNNCampaign = Object.freeze({ mount, refreshSelection, validate, estimate, buildPlan, parseReport, importReportFile, maxReportBytes: MAX_REPORT_BYTES, limits: LIMITS });
  window.addEventListener('brainsnn:experiment', refreshSelection);
  function init() { const element = document.getElementById('arena-campaign-root'); if (element) mount(element); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
