/* Exact-robot campaign planning. No queue, worker allocation or provider API is invoked. */
(() => {
  'use strict';
  const MAX_SEED = 2147483647;
  const LIMITS = Object.freeze({ trials: 100000, workers: 256, dollars: 1000000, hourlyRate: 10000, pilotEpisodes: 10000000, elapsedSeconds: 31536000, loadingMinutes: 1440 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isBlank = value => value == null || String(value).trim() === '';
  const number = value => isBlank(value) ? null : Number(value);
  const currency = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const decimal = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  const initialFields = () => ({ totalTrials: '1000', maxWorkers: '1', startSeed: '42', costCeilingUSD: '100', pilotEpisodes: '', pilotElapsedSeconds: '', pilotWorkers: '', hourlyRateUSD: '', loadingMinutes: '0', storageUSD: '0', egressUSD: '0', provider: 'unassigned', taskId: '', protocol: 'practice' });

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

  let root = null, fields = initialFields(), selection = null, profile = null, manualProfile = false, lastArenaKey = null;
  function registry() { return window.BrainSNNArenaProfiles; }
  function field(key) { return root?.querySelector('[data-campaign-field="' + key + '"]'); }
  function capture() { if (root) for (const element of root.querySelectorAll('[data-campaign-field]')) fields[element.dataset.campaignField] = element.value; }
  function clearPilot() { for (const key of ['pilotEpisodes', 'pilotElapsedSeconds', 'pilotWorkers', 'hourlyRateUSD']) { fields[key] = ''; if (field(key)) field(key).value = ''; } }
  function fillTaskAndProtocol(previousId) {
    if (profile?.id !== previousId) {
      clearPilot();
      fields.taskId = !manualProfile && selection?.task ? selection.task : profile?.tasks?.[0]?.id || '';
      fields.protocol = profile?.protocols?.includes(fields.protocol) ? fields.protocol : profile?.protocols?.[0] || 'practice';
      if (field('taskId')) field('taskId').value = fields.taskId;
    }
    const protocol = field('protocol');
    if (protocol) { protocol.innerHTML = (profile?.protocols || ['practice']).map(value => '<option value="' + esc(value) + '">' + (value === 'benchmark' ? 'Benchmark · locked conditions' : 'Practice · logged interventions') + '</option>').join(''); protocol.value = fields.protocol; }
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
  }
  function input(key, label, attrs = '', help = '') {
    return '<label class="campaign-field"><span>' + label + '</span><input data-campaign-field="' + key + '" value="' + esc(fields[key]) + '" ' + attrs + ' aria-describedby="campaign-' + key + '-help campaign-' + key + '-error"><small id="campaign-' + key + '-help">' + help + '</small><small id="campaign-' + key + '-error" data-campaign-error="' + key + '" class="campaign-field-error"></small></label>';
  }
  function mount(element) {
    if (!element) return;
    root = element;
    if (root.dataset.campaignMounted === 'true') { refreshSelection(); return; }
    root.dataset.campaignMounted = 'true';
    root.innerHTML = '<div class="campaign-heading"><div><p class="campaign-kicker">FROM ONE RUN TO A REPRODUCIBLE CAMPAIGN</p><h2>Test the pair. Explore the edge.</h2><p>Keep your robot, brain and task together as you plan the next thousand trials.</p></div><span class="campaign-plan-status"><i aria-hidden="true"></i>Plan only · no workers started</span></div><div class="campaign-layout"><section class="campaign-config" aria-label="Campaign configuration"><div class="campaign-section-heading"><span>01</span><h3>One exact recipe</h3><button type="button" class="campaign-text-button" data-campaign-use-arena>Use Arena selection ↗</button></div><div class="campaign-profile-summary" data-campaign-profile-summary></div><label class="campaign-field"><span>Robot + brain + environment</span><select data-campaign-profile aria-label="Campaign recipe"></select></label><div class="campaign-two">' + input('taskId', 'Task ID', 'type="text" maxlength="300" list="campaign-task-options"', 'Must match the worker task. Visible labels are not task IDs.') + '<label class="campaign-field"><span>Experiment protocol</span><select data-campaign-field="protocol"></select><small>Benchmark conditions must stay fixed.</small><small data-campaign-error="protocol" class="campaign-field-error"></small></label></div><datalist id="campaign-task-options"></datalist><div class="campaign-section-heading"><span>02</span><h3>Define the test set</h3></div><div class="campaign-trial-pills" role="group" aria-label="Total trial presets">' + [['1', '1 pilot'], ['1000', '1,000'], ['10000', '10,000'], ['100000', '100,000']].map(([value, label]) => '<button type="button" data-campaign-trials="' + value + '" aria-pressed="false">' + label + '</button>').join('') + '</div><div class="campaign-two">' + input('totalTrials', 'Total trial episodes', 'type="number" min="1" max="100000" step="1" inputmode="numeric"', 'Complete trials across the campaign.') + input('maxWorkers', 'Simultaneous workers', 'type="number" min="1" max="256" step="1" inputmode="numeric"', 'Independent from total trial count.') + '</div><div class="campaign-two">' + input('startSeed', 'First seed', 'type="number" min="0" max="2147483647" step="1" inputmode="numeric"', 'Consecutive seeds; maximum 2,147,483,647.') + input('costCeilingUSD', 'Spending limit · USD', 'type="number" min="0.01" max="1000000" step="any" inputmode="decimal"', 'A requested limit. Enforcement requires an orchestrator.') + '</div><p class="campaign-seeds" data-campaign-seeds></p></section><aside class="campaign-sizing" aria-label="Pilot measurement and estimate"><div class="campaign-section-heading"><span>03</span><h3>Size from your pilot</h3></div><p class="campaign-copy">Use measurements from this recipe on the hardware you intend to use. Changing the recipe clears these inputs.</p><div class="campaign-two">' + input('pilotEpisodes', 'Completed episodes', 'type="number" min="1" max="10000000" step="1" inputmode="numeric" placeholder="Enter count"', 'Count successful and failed completed trials.') + input('pilotElapsedSeconds', 'Elapsed seconds', 'type="number" min="0.001" max="31536000" step="any" inputmode="decimal" placeholder="Enter seconds"', 'Wall time, excluding the separate loading allowance.') + input('pilotWorkers', 'Workers in pilot', 'type="number" min="1" max="256" step="1" inputmode="numeric" placeholder="Enter count"', 'Allocated for the full measured duration.') + input('hourlyRateUSD', 'USD per worker-hour', 'type="number" min="0.000001" max="10000" step="any" inputmode="decimal" placeholder="Your provider rate"', 'Enter the price for the measured hardware.') + '</div><details class="campaign-allowances"><summary>Compute destination & cost allowances</summary><label class="campaign-field"><span>Planned destination</span><select data-campaign-field="provider"><option value="unassigned">Choose later</option><option value="vast">Vast</option><option value="runpod">Runpod</option><option value="huggingface">Hugging Face Jobs</option><option value="own">Own worker</option></select><small>Destination preference only. No provider is connected.</small></label>' + input('loadingMinutes', 'Loading minutes per worker', 'type="number" min="0" max="1440" step="any" inputmode="decimal"', 'Billed loading allowance, additional to pilot time.') + '<div class="campaign-two">' + input('storageUSD', 'Storage allowance · USD', 'type="number" min="0" max="1000000" step="any" inputmode="decimal"', 'Enter a total campaign allowance.') + input('egressUSD', 'Transfer allowance · USD', 'type="number" min="0" max="1000000" step="any" inputmode="decimal"', 'Enter a total campaign allowance.') + '</div></details><div class="campaign-estimate" data-campaign-estimate aria-live="polite"></div><button type="button" class="campaign-export" data-campaign-export>Export campaign plan <span aria-hidden="true">↓</span></button><p class="campaign-export-note" data-campaign-export-note></p><p class="campaign-download-status" data-campaign-download-status role="status"></p></aside></div>';
    root.addEventListener('input', event => { if (event.target.matches('[data-campaign-field]')) { if (['taskId', 'protocol', 'provider'].includes(event.target.dataset.campaignField)) clearPilot(); update(); } });
    root.addEventListener('change', event => {
      if (event.target.matches('[data-campaign-profile]')) { capture(); const old = profile?.id; manualProfile = true; profile = registry()?.find?.(event.target.value) || null; fillTaskAndProtocol(old); renderProfile(); update(); }
      else if (event.target.matches('[data-campaign-field]')) { if (['taskId', 'protocol', 'provider'].includes(event.target.dataset.campaignField)) clearPilot(); update(); }
    });
    root.addEventListener('click', event => {
      const preset = event.target.closest('[data-campaign-trials]');
      if (preset) { fields.totalTrials = preset.dataset.campaignTrials; field('totalTrials').value = fields.totalTrials; if (number(fields.maxWorkers) > number(fields.totalTrials)) { fields.maxWorkers = fields.totalTrials; field('maxWorkers').value = fields.maxWorkers; } update(); }
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
  window.BrainSNNCampaign = Object.freeze({ mount, refreshSelection, validate, estimate, buildPlan, limits: LIMITS });
  window.addEventListener('brainsnn:experiment', refreshSelection);
  function init() { const element = document.getElementById('arena-campaign-root'); if (element) mount(element); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
