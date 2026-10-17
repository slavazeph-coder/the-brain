/* BrainSNN Site Tests: reviewed geometry and deterministic planning previews.
 * Visual capture, collision geometry and learned-policy execution stay separate. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'brainsnn.site-scene.v1';
  let host = null, selection = {}, scene = null, renderer = null, step = 'test', view = 'geometry';
  let sceneId = 0, mapEpoch = 0, assetEpoch = 0, workerEpoch = 0, body = null, pointCloud = null, selectedObstacle = '', placement = '', mode = 'navigation', proxy = 'selected';
  let result = null, resultSelection = null, planning = false, planner = null, planningEpoch = 0, planCancel = null, cursor = 0, running = false, timer = 0, lastTime = 0, simTime = 0, speed = 8;
  let references = [], asset = null, assetMeta = null, assetTransform = { scale: 1, x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationZ: 0 };
  let message = 'Sample space loaded. Run a path preview, or bring your own space.', messageError = false, generation = 0;
  let worker = null, workerJob = null, workerFile = null, pollTimer = 0, workerStatus = '', workerBusy = false;
  let operationsAssumptions = null, operationsEstimate = null, operationsOpen = false, operationsRenderKey = '';
  const requests = new Set();
  const $ = id => host?.querySelector('#' + id);
  const core = () => window.BrainSNNSiteCore;
  const operations = () => window.BrainSNNSiteOperations;
  const robot = () => ({ ...core()?.robotPreset(proxy === 'cleaner' ? 'cleaner' : selection.robotId || 'g1'), ...(body || {}) });
  const hasAppearance = () => Boolean(asset || pointCloud);
  const appearanceName = () => asset?.name || (pointCloud ? 'Reconstructed point cloud' : '');
  const terminalJob = status => ['complete', 'completed', 'succeeded', 'failed', 'cancelled'].includes(status);
  const jobError = value => typeof value === 'string' ? value : value?.message || '';
  const robotName = () => selection.robot?.name || (window.BrainSNNRobots || []).find(r => r.id === selection.robotId)?.name || selection.robotId || 'Robot';
  const modelName = () => selection.model?.name || (window.BrainSNNModels || []).find(m => m.id === selection.modelId)?.name || selection.modelId || 'Selected model';
  const signature = s => JSON.stringify([s.robotId, s.modelId, s.task, s.seed]);
  const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const time = seconds => Number.isFinite(seconds) ? seconds >= 60 ? Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's' : seconds.toFixed(1) + 's' : '—';
  const minutes = value => Number.isFinite(value) ? (value === 0 ? '0 min' : value < 1 ? '<1 min' : Math.round(value) + ' min') : '—';
  function assumptions() {
    if (!operationsAssumptions && operations()) operationsAssumptions = operations().defaults();
    return operationsAssumptions;
  }
  function recalculateOperations() {
    operationsEstimate = null;
    if (!operations() || !scene?.scaleConfirmed || proxy !== 'cleaner' || mode !== 'coverage' || result?.status !== 'complete') return;
    try { operationsEstimate = operations().estimate(scene, result, assumptions()); }
    catch (error) { tell('Cleaning estimate: ' + error.message, true); }
  }
  function money(value, currency) { return value === null || !Number.isFinite(value) ? 'Enter your rates' : currency + ' ' + value.toFixed(2); }
  function tell(value, error = false) { message = value; messageError = error; text('site-status', value); $('site-status')?.classList.toggle('is-error', error); }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(scene)); } catch { /* Geometry remains in memory when storage is unavailable. */ } }
  function initialScene() {
    if (scene) return;
    try { const raw = localStorage.getItem(STORE); if (raw) { scene = core().normalizeScene(JSON.parse(raw)); message = 'Your reviewed map is restored in this browser. Source media stays local to the open page.'; } } catch { /* Ignore an obsolete or invalid saved scene. */ }
    if (!scene) scene = core().sampleScene();
  }
  function stop() { running = false; cancelAnimationFrame(timer); timer = 0; lastTime = 0; }
  function invalidate() { stop(); planningEpoch++; planCancel?.(); planCancel = null; planner?.terminate(); planner = null; planning = false; result = null; resultSelection = null; operationsEstimate = null; cursor = 0; simTime = 0; renderer?.setTrace([], 0); renderer?.setCoverage?.(null); }
  function applyScene(next, note) {
    const normalized = core().normalizeScene(next);
    scene = normalized; mapEpoch++; sceneId++; invalidate(); save(); renderer?.setScene(scene); renderer?.setRobot(robot());
    renderInspector(); update(); if (note) tell(note);
  }
  function mutate(change, note) { try { const next = clone(scene); change(next); applyScene(next, note); } catch (error) { tell(error.message, true); renderInspector(); } }
  function download(name, value, type = 'application/json') {
    const blob = value instanceof Blob ? value : new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setStep(next) { step = next; if (host) host.dataset.siteStep = step; placement = ''; renderInspector(); update(); }
  function fields(items) { return '<div class="site-fields">' + items.map(([label, id, value, min, max, increment]) => '<label>' + label + '<input id="' + id + '" type="number" value="' + esc(value) + '" min="' + min + '" max="' + max + '" step="' + (increment || '0.1') + '"></label>').join('') + '</div>'; }
  function render() {
    host.classList.add('site-workspace'); host.dataset.siteStep = step; operationsRenderKey = '';
    host.innerHTML = '<header class="site-heading"><div><span class="site-eyebrow">REAL WORLD → ROBOT WORLD</span><h2>Your space.<br><span>Their proving ground.</span></h2><p>Bring a place. Review the map. Find out what gets in the way.</p></div><div class="site-local-badge"><span></span> Local first <small>Your files stay here until you send them to your worker.</small></div></header>' +
      '<div class="site-shell"><nav class="site-steps" aria-label="Site test steps"><button data-site-step="capture"><b>01</b><span>Capture<small>Bring your space</small></span><i>↗</i></button><button data-site-step="review"><b>02</b><span>Review<small>Make the map testable</small></span><i>↗</i></button><button data-site-step="test"><b>03</b><span>Test<small>Explore the route</small></span><i>↗</i></button></nav>' +
      '<div class="site-main"><aside id="site-inspector" class="site-inspector"></aside><section class="site-stage" aria-label="Interactive site test"><div class="site-stage-bar"><div><span class="site-micro" id="site-scene-source">SAMPLE SPACE</span><strong id="site-scene-name"></strong></div><span class="site-preview-badge">PLANNING PREVIEW</span></div>' +
      '<div class="site-view-toolbar"><div class="site-segment" aria-label="Scene layers"><button data-site-view="reality">Reality</button><button data-site-view="geometry">Geometry</button><button data-site-view="robot">Robot view</button></div><div class="site-camera"><button data-site-camera="orbit" aria-label="Orbit camera">3D</button><button data-site-camera="top" aria-label="Top down camera">Top</button></div></div>' +
      '<div class="site-viewport" id="site-viewport"><div id="site-renderer" class="site-renderer"></div><div class="site-map-hint" id="site-map-hint">Drag to orbit · Scroll to zoom</div><div class="site-canvas-label"><span id="site-canvas-robot"></span><small id="site-canvas-model"></small></div><div id="site-placement" class="site-placement" hidden></div></div>' +
      '<div class="site-operations-output" id="site-operations-output" aria-live="polite"></div>' +
      '<div class="site-transport"><button id="site-run" class="site-button site-primary" data-site-action="run">▶ Run path preview</button><button class="site-button site-icon" data-site-action="reset" aria-label="Reset playback">↺</button><label class="site-speed">Replay<select id="site-speed" aria-label="Replay speed"><option value="1">1×</option><option value="8" selected>8×</option><option value="32">32×</option></select></label><div class="site-clock"><strong id="site-time">0.0s</strong><small>estimated travel time</small></div></div>' +
      '<div class="site-timeline"><input id="site-scrubber" type="range" min="0" max="0" value="0" disabled aria-label="Replay planned robot route"><div><span id="site-replay-note">Run once to explore the route frame by frame.</span><span id="site-replay-end">—</span></div></div>' +
      '<div class="site-metrics"><div><span id="site-area-label">Reachable area</span><strong id="site-area">—</strong><small>planning estimate</small></div><div><span>Route length</span><strong id="site-distance">—</strong><small>collision-aware path</small></div><div><span>Travel only</span><strong id="site-duration">—</strong><small>constant-speed estimate</small></div><div><span>Test outcome</span><strong id="site-outcome">Ready</strong><small id="site-outcome-note">No model executed</small></div></div></section></div>' +
      '<div class="site-status" id="site-status" role="status" aria-live="polite"></div></div><p class="site-integrity">This layer previews routes against reviewed floor geometry. Robot dimensions and speeds are illustrative. It does not execute the selected AI, validate balance or manipulation, or measure cleaning quality.</p>';
    host.addEventListener('click', handleClick); host.addEventListener('change', handleChange); host.addEventListener('input', handleInput);
    renderInspector();
    try {
      if (!window.BrainSNNSiteRenderer) throw new Error('The 3D renderer did not load. You can still edit the map and export a route report.');
      renderer = window.BrainSNNSiteRenderer.create($('site-renderer'), { onPick: pick, onSelect: id => { selectedObstacle = id; setStep('review'); }, onError: value => tell(value, true) });
      renderer.setScene(scene); renderer.setRobot(robot()); renderer.setMode(view);
      if (result) { renderer.setTrace(result.trace, cursor); renderer.setCoverage?.(mode === 'coverage' ? result.grid : null); }
      if (asset) loadAsset(asset, false);
      else if (pointCloud) { renderer.setPointCloud(pointCloud); renderer.setAssetTransform(assetTransform); renderer.setMode(view); }
    } catch (error) { tell(error.message, true); }
    update(); tell(message, messageError);
  }
  function capturePanel() {
    const media = references.map((ref, i) => '<div class="site-reference">' + (ref.type.startsWith('video/') ? '<video src="' + esc(ref.url) + '" controls playsinline preload="metadata"></video>' : '<img src="' + esc(ref.url) + '" alt="Local capture reference">') + '<div><span>' + esc(ref.file.name) + '</span><button data-site-remove-ref="' + i + '" aria-label="Remove ' + esc(ref.file.name) + '">×</button></div></div>').join('');
    return '<div class="site-panel-title"><span class="site-micro">01 / CAPTURE</span><h3>Start with your gym.</h3><p>Import a measured floor map today. Add a scan as a visual reference, review the map, then estimate a cleaning run.</p></div>' +
      '<div class="site-gym-guide"><b>Scan → reviewed map → route → time & cost</b><p>A supported floor-map JSON goes straight to review. A phone video or 3D visual still needs a measured floor map.</p><button class="site-link" data-site-action="gym-estimate">Estimate gym cleaning →</button></div>' +
      '<label class="site-dropzone"><span class="site-upload-icon">↑</span><strong>Add a capture reference</strong><small>Phone video or photos · local preview</small><input id="site-reference-input" type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" multiple></label>' +
      '<p class="site-note">References help you draw the map. They do not automatically generate geometry.</p>' + media +
      '<div class="site-import-grid"><label class="site-button">Import floor map<input id="site-map-input" type="file" accept=".json,application/json"></label><label class="site-button">Add 3D visual<input id="site-asset-input" type="file" accept=".glb,.usdz"></label></div><p class="site-note">Floor map: BrainSNN or RoomPlan JSON. Visual: GLB or ASCII USDZ. Binary RoomPlan USDZ needs GLB conversion.</p>' +
      (hasAppearance() ? '<div class="site-asset-row"><span><b>Visual only</b>' + esc(appearanceName()) + '</span><button class="site-link" data-site-action="remove-asset">Remove</button></div>' : '') +
      '<button class="site-button site-wide" data-site-action="new-map">Draw my floor map →</button><button class="site-link" data-site-action="sample">Explore the sample space</button>' +
      '<details class="site-help"><summary>How to capture a useful gym</summary><ol><li>Capture one floor, walking slowly along usable aisles and through doorways.</li><li>Measure floor dimensions and narrow passages. Mark equipment, mats, stairs, drains and areas the robot must avoid.</li><li>Mirrors, glass and repetitive equipment can confuse reconstruction. Check the map against the actual gym.</li><li>Confirm one real measurement and the robot dimensions before estimating. Keep people out of the capture where possible.</li></ol><p>Supported RoomPlan JSON can provide a starting floor map. A raw video requires your connected reconstruction worker and manual floor review. Reconstruction produces an unscaled visual reference, not a ready collision map.</p><a href="gym-pilot.html" target="_blank" rel="noopener noreferrer">One-gym pilot checklist ↗</a></details>' + workerPanel();
  }
  function reviewPanel() {
    const obstacle = scene.obstacles.find(o => o.id === selectedObstacle);
    return '<div class="site-panel-title"><span class="site-micro">02 / REVIEW</span><h3>Give the world its rules.</h3><p>Check the size. Mark what blocks the robot. Confirm your map before a run.</p></div>' +
      '<label class="site-field">Space name<input id="site-name" maxlength="100" value="' + esc(scene.name) + '"></label>' + fields([['Width · m', 'site-width', scene.width, 1, 100], ['Depth · m', 'site-depth', scene.depth, 1, 100]]) +
      '<label class="site-checkbox"><input id="site-scale-confirmed" type="checkbox" ' + (scene.scaleConfirmed ? 'checked' : '') + '><span>I checked the dimensions against a real measurement.<small>' + (scene.source?.kind === 'sample' ? 'The sample uses authored dimensions.' : 'Changing floor dimensions clears this confirmation.') + '</small></span></label>' +
      '<div class="site-section-label"><h4>Place on the map</h4><span>Click to position</span></div><div class="site-placement-tools"><button data-site-place="start">◎ Start</button><button data-site-place="goal">⚑ Goal</button><button data-site-place="obstacle">＋ Obstacle</button></div>' +
      fields([['Start X · m', 'site-start-x', scene.start[0], 0, scene.width], ['Start Z · m', 'site-start-z', scene.start[1], 0, scene.depth], ['Goal X · m', 'site-goal-x', scene.goal[0], 0, scene.width], ['Goal Z · m', 'site-goal-z', scene.goal[1], 0, scene.depth]]) +
      '<div class="site-section-label"><h4>Obstacles</h4><span>' + scene.obstacles.length + ' objects</span></div><select id="site-obstacle-select" class="site-select" aria-label="Select an obstacle"><option value="">Choose an obstacle</option>' + scene.obstacles.map(o => '<option value="' + esc(o.id) + '" ' + (o.id === selectedObstacle ? 'selected' : '') + '>' + esc(o.label || o.id) + '</option>').join('') + '</select>' +
      (obstacle ? '<div class="site-obstacle-editor"><label class="site-field">Label<input id="site-obstacle-label" maxlength="80" value="' + esc(obstacle.label || '') + '"></label>' + fields([['Center X · m', 'site-obstacle-x', obstacle.x, 0, scene.width], ['Center Z · m', 'site-obstacle-z', obstacle.z, 0, scene.depth], ['Width · m', 'site-obstacle-width', obstacle.width, 0.1, scene.width], ['Depth · m', 'site-obstacle-depth', obstacle.depth, 0.1, scene.depth], ['Height · m', 'site-obstacle-height', obstacle.height, 0.1, 10]]) + '<button class="site-link site-danger" data-site-action="delete-obstacle">Remove obstacle</button></div>' : '<p class="site-note">Click an obstacle in the 3D view to edit it.</p>') +
      (hasAppearance() ? '<details class="site-help"><summary>Align visual asset</summary><p>Alignment changes the appearance only. Collision geometry stays on this reviewed map.</p>' + fields([['Scale', 'site-asset-scale', assetTransform.scale, 0.001, 1000, 0.01], ['X · m', 'site-asset-x', assetTransform.x, -100, 100], ['Y · m', 'site-asset-y', assetTransform.y, -100, 100], ['Z · m', 'site-asset-z', assetTransform.z, -100, 100], ['Yaw · °', 'site-asset-rotation', assetTransform.rotation * 180 / Math.PI, -360, 360, 1], ['Tilt X · °', 'site-asset-rotationX', (assetTransform.rotationX || 0) * 180 / Math.PI, -360, 360, 1], ['Tilt Z · °', 'site-asset-rotationZ', (assetTransform.rotationZ || 0) * 180 / Math.PI, -360, 360, 1]]) + '<button class="site-link" data-site-action="frame-asset">Frame visual in view</button></details>' : '') +
      (scene.source?.warnings?.length ? '<details class="site-help"><summary>Import review notes</summary><ul>' + scene.source.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></details>' : '') +
      '<button class="site-button site-primary site-wide" data-site-step="test">Ready to test →</button><button class="site-link" data-site-action="export-scene">Export this map ↓</button>';
  }
  function testPanel() {
    const r = robot();
    return '<div class="site-panel-title"><span class="site-micro">03 / TEST</span><h3>See where it gets stuck.</h3><p>Run a route. Change the space. Replay the difference.</p></div>' +
      '<button class="site-button site-primary site-wide site-gym-action" data-site-action="gym-estimate">Estimate gym cleaning ↗</button><p class="site-note">Uses your reviewed map and an editable generic cleaner. Your Arena selection stays selected.</p>' +
      '<div class="site-selected-pair"><span>YOUR ARENA SELECTION</span><strong>' + esc(robotName()) + '</strong><p>' + esc(modelName()) + ' <b>not executed</b></p></div>' +
      '<label class="site-field">Planning body<select id="site-proxy"><option value="selected" ' + (proxy === 'selected' ? 'selected' : '') + '>' + esc(robotName()) + ' · footprint proxy</option><option value="cleaner" ' + (proxy === 'cleaner' ? 'selected' : '') + '>Generic cleaning robot · coverage proxy</option></select></label>' +
      '<label class="site-field">Test<select id="site-test-mode"><option value="navigation" ' + (mode === 'navigation' ? 'selected' : '') + '>Reach a destination</option><option value="coverage" ' + (mode === 'coverage' ? 'selected' : '') + ' ' + (proxy !== 'cleaner' ? 'disabled' : '') + '>Cover the reachable floor</option></select></label>' +
      '<details class="site-help"><summary>Set robot dimensions & speed</summary><p>Enter measured values to replace the illustrative planning envelope.</p>' + fields([['Width · m', 'site-body-width', r.width, 0.1, 5], ['Depth · m', 'site-body-depth', r.depth, 0.1, 5], ['Speed · m/s', 'site-body-speed', r.speed, 0.05, 3, 0.05], ...(proxy === 'cleaner' ? [['Cleaning width · m', 'site-body-operationWidth', r.operationWidth, 0.1, 5]] : [])]) + '</details><div class="site-body-specs"><span>Envelope <b>' + Number(r.width).toFixed(2) + ' × ' + Number(r.depth).toFixed(2) + ' m</b></span><span>Travel speed <b>' + Number(r.speed).toFixed(2) + ' m/s</b></span></div><p class="site-note">' + (proxy === 'cleaner' ? 'Illustrative cleaning footprint. Coverage is a route estimate, not proof of cleaning quality.' : 'A clearance proxy for this body. The selected policy and “' + esc(selection.task || 'mission') + '” task do not execute in this preview.') + '</p>' +
      (proxy === 'cleaner' && mode === 'coverage' ? operationsPanel() : '') +
      (!scene.scaleConfirmed ? '<div class="site-callout"><strong>Confirm scale first.</strong><p>Review floor dimensions before calculating a route.</p><button class="site-link" data-site-step="review">Review the map →</button></div>' : '') +
      '<div class="site-section-label"><h4>Change the challenge</h4></div><div class="site-challenges"><button data-site-action="challenge-obstacle"><span>▧</span> Add a blocker<small>Then place it in the scene</small></button><button data-site-action="change-goal"><span>⚑</span> Move the goal<small>Try another route</small></button></div>' +
      (result?.trace?.length > 2 ? '<button class="site-button site-wide" data-site-action="block-route">Surprise: block this route ↗</button>' : '') + '<div class="site-report-actions"><button class="site-button site-wide" id="site-export-report" data-site-action="export-report" ' + (!result ? 'disabled' : '') + '>Export route report ↓</button><button class="site-link" data-site-action="export-scene">Save editable scenario ↓</button></div><details class="site-help"><summary>What this result means</summary><p>The planner uses static 2D clearance and a constant speed. Results are estimates on your reviewed geometry. It does not run GR00T or another named policy, evaluate humanoid balance, or predict dynamic crowds.</p><p>Real learned-policy tests remain in Arena with a compatible connected worker.</p></details>';
  }
  function operationsPanel() {
    const a = assumptions();
    if (!a) return '<p class="site-note">Cleaning estimates did not load. Reload the page; floor planning remains available.</p>';
    return '<details id="site-operations-assumptions" class="site-help site-operations-assumptions" ' + (operationsOpen ? 'open' : '') + '><summary>Cleaning assumptions & your rates</summary><p>Illustrative planning inputs. Replace them with measured gym and robot values. Rates are yours, not market quotes.</p>' +
      fields([['Passes', 'site-ops-passes', a.passes, 1, 10, 1], ['Seconds per turn', 'site-ops-turnSeconds', a.turnSeconds, 0, 120, 1], ['Setup · min', 'site-ops-setupMinutes', a.setupMinutes, 0, 1440, 1], ['Finish · min', 'site-ops-finishMinutes', a.finishMinutes, 0, 1440, 1], ['Expected help events', 'site-ops-expectedInterventions', a.expectedInterventions, 0, 1000, 1], ['Minutes per event', 'site-ops-minutesPerIntervention', a.minutesPerIntervention, 0, 1440, 1], ['Service every · m²', 'site-ops-serviceAreaM2', a.serviceAreaM2, 0, 1000000, 1], ['Service stop · min', 'site-ops-serviceMinutes', a.serviceMinutes, 0, 1440, 1]]) +
      '<p class="site-note">Service every 0 m² disables service stops. Expected help is a user assumption, not a predicted failure rate.</p>' +
      '<label class="site-checkbox"><input id="site-ops-includeUncovered" type="checkbox" ' + (a.includeUncovered ? 'checked' : '') + '><span>Allow human follow-up for uncovered floor<small>Includes the free floor outside the coverage estimate. Verify that it is safe and accessible for people.</small></span></label>' +
      fields([['Manual work · m²/hour', 'site-ops-manualM2PerHour', a.manualM2PerHour, 0.1, 1000000, 1]]) +
      '<div class="site-section-label"><h4>Your cost assumptions</h4></div><label class="site-field">Currency label<input id="site-ops-currency" value="' + esc(a.currency) + '" maxlength="3" pattern="[A-Z]{3}" autocomplete="off"></label>' +
      fields([['Labour · ' + esc(a.currency) + '/hour', 'site-ops-laborHourlyRate', a.laborHourlyRate, 0, 1000000, 0.01], ['Robot · ' + esc(a.currency) + '/hour', 'site-ops-robotHourlyCost', a.robotHourlyCost, 0, 1000000, 0.01], ['Consumables · ' + esc(a.currency) + '/m²', 'site-ops-consumablesPerM2', a.consumablesPerM2, 0, 1000000, 0.001]]) +
      '<p class="site-note">Enter all three rates to see a total. Enter 0 for a cost you intentionally exclude. Robot cost applies to run time; labour applies to help time. No currency conversion is performed.</p></details>';
  }
  function updateOperationsOutput() {
    const output = $('site-operations-output'); if (!output) return;
    const estimate = operationsEstimate;
    const key = JSON.stringify([estimate?.estimateDigest || null, scene?.source?.kind, scene?.scaleConfirmed, proxy, mode, planning, Boolean(operations())]);
    if (key === operationsRenderKey) return; operationsRenderKey = key;
    if (!estimate) {
      output.innerHTML = '<div class="site-operations-intro"><div><span class="site-micro">ONE GYM FLOOR</span><strong>Plan the work before the first clean.</strong><p>' + (!operations() ? 'Cleaning estimates are unavailable. Reload this page to try again.' : !scene.scaleConfirmed ? 'Import or draw a floor map, check equipment and aisles, then confirm real dimensions.' : proxy === 'cleaner' && mode === 'coverage' ? planning ? 'Calculating coverage. Time, help and cost will use this route and your assumptions.' : 'Run coverage to estimate robot time, human help and your operating cost.' : 'Use a generic cleaner on this map to estimate coverage, time, human help and cost.') + '</p></div><button class="site-button" data-site-action="gym-estimate" ' + (!operations() || planning ? 'disabled' : '') + '>Estimate gym cleaning ↗</button></div>';
      return;
    }
    const t = estimate.timing, c = estimate.costs, area = estimate.coverage;
    output.innerHTML = '<div class="site-operations-heading"><div><span class="site-micro">' + (scene.source?.kind === 'sample' ? 'SAMPLE FLOOR · ASSUMPTION-BASED ESTIMATE' : 'REVIEWED MAP · ASSUMPTION-BASED ESTIMATE') + '</span><strong>What this cleaning run could take</strong></div><button class="site-link" data-site-action="edit-operations">Edit assumptions ↗</button></div>' +
      '<div class="site-operations-metrics"><div><span>Robot run</span><strong id="site-ops-robot-time">' + minutes(t.robotRunMinutes) + '</strong><small>travel, turns & service</small></div><div><span>Human help</span><strong id="site-ops-help-time">' + minutes(t.humanHelpMinutes) + '</strong><small>setup, service & follow-up</small></div><div><span>Elapsed estimate</span><strong id="site-ops-elapsed-time">' + minutes(t.sequentialElapsedMinutes) + '</strong><small>sequential schedule</small></div><div><span>Operating cost</span><strong class="' + (c.total === null ? 'site-ops-missing' : '') + '" id="site-ops-total">' + esc(money(c.total, c.currency)) + '</strong><small>' + (c.total === null ? 'your 3 cost rates are required' : 'per planned cleaning run') + '</small></div></div>' +
      '<div class="site-operations-foot"><span>' + Number(area.coveredAreaM2).toFixed(1) + ' m² covered · ' + Number(area.manualFollowupAreaM2).toFixed(1) + ' m² human follow-up · ' + area.passes + (area.passes === 1 ? ' pass' : ' passes') + '</span><span>Labour ' + esc(money(c.labor, c.currency)) + ' · Robot ' + esc(money(c.robot, c.currency)) + ' · Supplies ' + esc(money(c.consumables, c.currency)) + '</span></div>' +
      '<details class="site-operations-limits"><summary>Estimate limits & assumptions</summary><p>Uses this route, reviewed geometry and your inputs. Actual cleaning quality, crowds, battery limits and learned robot policies have not been tested. Human help is a planning allowance.</p>' + (estimate.warnings?.length ? '<ul>' + estimate.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') + '</details>';
  }
  function workerPanel() {
    const job = workerJob;
    return '<details class="site-help site-worker" ' + (worker || workerBusy ? 'open' : '') + '><summary>Reconstruct on my worker <span>GPU</span></summary><p>Send a capture to your own reconstruction worker. No compute is rented by this page.</p><form id="site-worker-form"><label class="site-field">Worker URL<input id="site-worker-url" type="url" placeholder="https://your-worker.example" value="' + esc(worker?.url || '') + '" autocomplete="off" required></label><label class="site-field">Private token<input id="site-worker-token" type="password" placeholder="Worker token" value="' + esc(worker?.token || '') + '" autocomplete="off" required></label><button type="submit" class="site-button site-wide" ' + (workerBusy ? 'disabled' : '') + '>' + (worker ? 'Check connection' : 'Connect worker') + '</button></form>' +
      (worker ? '<label class="site-field">Capture to reconstruct<input id="site-worker-file" type="file" accept=".mp4,.mov,.zip,video/mp4,video/quicktime,application/zip"></label><p class="site-note">' + (workerFile ? esc(workerFile.name) + ' · ' + (workerFile.size / 1024 / 1024).toFixed(1) + ' MB' : 'Select a video or a ZIP of images. This upload is separate from local references.') + '</p><button class="site-button site-primary site-wide" data-site-action="reconstruct" ' + (!workerFile || !worker.capabilities.available || workerBusy || job && !terminalJob(job.status) ? 'disabled' : '') + '>Send capture & reconstruct</button>' : '') +
      (job ? '<div class="site-worker-job"><strong>' + esc(job.stage || job.status) + '</strong><progress max="100" value="' + Math.max(0, Math.min(100, (job.progress || 0) <= 1 ? (job.progress || 0) * 100 : job.progress)) + '"></progress><span>' + esc(jobError(job.error)) + '</span>' + ((job.artifacts || []).some(a => a.name === 'point-cloud.json') ? '<button class="site-button site-primary site-wide" data-site-action="open-reconstruction">Open as a new 3D space ↗</button>' : '') + (job.artifacts || []).map((a, i) => '<button class="site-link" data-site-artifact="' + i + '">Download ' + esc(a.name) + ' ↓</button>').join('') + '<button class="site-link site-danger" data-site-action="cancel-reconstruction">Cancel / delete scan job</button></div>' : '') +
      '<p class="site-worker-links"><a href="site-scan-worker.html" target="_blank" rel="noopener noreferrer">Worker setup ↗</a><a href="downloads/brainsnn-site-scan-worker.zip" download>Download kit ↓</a></p><p class="site-note" id="site-worker-status">' + esc(workerStatus || 'Credentials stay in memory. Reconstruction outputs must be reviewed and scaled before simulation.') + '</p>' + (worker ? '<button class="site-link" data-site-action="disconnect-worker">Disconnect worker</button>' : '') + '</details>';
  }
  function renderInspector() {
    const panel = $('site-inspector'); if (!panel || !scene) return;
    panel.innerHTML = step === 'capture' ? capturePanel() : step === 'review' ? reviewPanel() : testPanel();
    panel.querySelector('#site-worker-form')?.addEventListener('submit', connectWorker);
    const operationsDetails = panel.querySelector('#site-operations-assumptions');
    operationsDetails?.addEventListener('toggle', () => { if (host?.contains(operationsDetails)) operationsOpen = operationsDetails.open; });
    updateButtons();
  }
  function updateButtons() {
    host?.querySelectorAll('[data-site-step]').forEach(el => { if (el.closest('.site-steps')) el.setAttribute('aria-current', el.dataset.siteStep === step ? 'step' : 'false'); });
    host?.querySelectorAll('[data-site-view]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.siteView === view)));
    host?.querySelectorAll('[data-site-place]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.sitePlace === placement)));
    if ($('site-placement')) { $('site-placement').hidden = !placement; $('site-placement').textContent = placement ? 'Click the floor to place ' + (placement === 'obstacle' ? 'an obstacle' : 'the ' + placement) + ' · Esc to cancel' : ''; }
  }
  function update() {
    if (!host || !scene) return;
    const metrics = result?.metrics, point = result?.trace?.[cursor];
    text('site-scene-name', scene.name);
    text('site-scene-source', (scene.source?.kind === 'sample' ? 'SAMPLE SPACE' : 'YOUR SPACE') + ' · ' + scene.width.toFixed(1) + ' × ' + scene.depth.toFixed(1) + ' M');
    text('site-canvas-robot', (proxy === 'cleaner' ? 'Generic cleaning robot' : robotName()) + ' · planning proxy');
    text('site-canvas-model', modelName() + ' selected · no policy execution');
    text('site-run', planning ? 'Planning route…' : running ? 'Ⅱ Pause' : result?.trace?.length && cursor < result.trace.length - 1 ? '▶ Resume preview' : '▶ Run ' + (mode === 'coverage' ? 'coverage' : 'path') + ' preview');
    if ($('site-run')) $('site-run').disabled = !scene.scaleConfirmed || planning;
    text('site-time', time(point?.t || 0));
    text('site-area-label', mode === 'coverage' ? 'Covered floor' : 'Reachable area');
    text('site-area', metrics ? Number(mode === 'coverage' ? metrics.coveredArea : metrics.reachableArea).toFixed(1) + ' m²' : '—');
    text('site-distance', metrics ? Number(metrics.distance).toFixed(1) + ' m' : '—');
    text('site-duration', metrics ? time(metrics.durationSeconds) : '—');
    text('site-outcome', result ? result.status === 'complete' ? 'Route found' : result.status === 'blocked' ? 'Blocked' : 'Check scale' : scene.scaleConfirmed ? 'Ready' : 'Review scale');
    text('site-outcome-note', result?.status === 'blocked' ? 'Review path clearance' : 'No model executed');
    const scrubber = $('site-scrubber'); if (scrubber) { scrubber.disabled = !result?.trace?.length; scrubber.max = String(Math.max(0, (result?.trace?.length || 0) - 1)); scrubber.value = String(cursor); }
    text('site-replay-note', result?.trace?.length ? 'Planned route · ' + (cursor + 1) + ' / ' + result.trace.length + ' positions · ' + speed + '× replay' : result ? 'No traversable route found. Review the map and planning envelope.' : 'Run once to explore the route frame by frame.');
    text('site-replay-end', metrics ? time(metrics.durationSeconds) : '—');
    if ($('site-export-report')) $('site-export-report').disabled = !result;
    updateOperationsOutput();
    updateButtons();
  }
  function tick(now) {
    if (!running || !host || !result?.trace?.length) return;
    if (!lastTime) lastTime = now;
    simTime += Math.min((now - lastTime) / 1000, 0.1) * speed; lastTime = now;
    const trace = result.trace;
    while (cursor < trace.length - 1 && trace[cursor + 1].t <= simTime) cursor++;
    renderer?.setTrace(trace, cursor); update();
    if (cursor >= trace.length - 1) { stop(); update(); tell('Preview complete. Move an obstacle or change the goal to test another route.'); } else timer = requestAnimationFrame(tick);
  }
  async function calculatePlan(planScene, planRobot, planMode, operation) {
    if (typeof Worker === 'undefined') return core().plan(planScene, planRobot, { mode: planMode });
    return new Promise((resolve, reject) => {
      const instance = new Worker('site-plan-worker.js'); planner = instance;
      let finished = false;
      const finish = (error, value) => {
        if (finished) return; finished = true; clearTimeout(timeout); instance.terminate();
        if (planner === instance) { planner = null; planCancel = null; }
        error ? reject(error) : resolve(value);
      };
      const timeout = setTimeout(() => finish(new Error('Planning took too long. Simplify the map and try again.')), 15000);
      planCancel = () => { const error = new Error('Planning cancelled.'); error.name = 'AbortError'; finish(error); };
      instance.onmessage = event => { if (event.data?.id !== operation) return; finish(event.data.ok ? null : new Error(event.data.error || 'Planning failed.'), event.data.result); };
      instance.onerror = () => finish(new Error('The route planner did not load. Reload this page and try again.'));
      instance.postMessage({ id: operation, scene: planScene, robot: planRobot, options: { mode: planMode } });
    });
  }
  async function run() {
    if (planning) return;
    if (running) { stop(); update(); return; }
    if (!scene.scaleConfirmed) { setStep('review'); tell('Confirm the measured floor dimensions before running a preview.', true); return; }
    if (!result || cursor >= result.trace.length - 1) {
      const operation = ++planningEpoch, version = generation;
      const selected = clone({ robotId: selection.robotId, modelId: selection.modelId, task: selection.task, seed: selection.seed });
      planning = true; update(); tell('Calculating clearance and a route through your reviewed geometry…');
      try {
        const planned = await calculatePlan(clone(scene), robot(), mode, operation);
        if (operation !== planningEpoch || version !== generation || !host) return;
        result = planned; resultSelection = selected; planning = false; recalculateOperations();
        cursor = 0; simTime = 0; renderer?.setTrace(result.trace, 0); renderer?.setCoverage?.(mode === 'coverage' ? result.grid : null); renderInspector(); update();
        if (result.status !== 'complete' || !result.trace.length) { tell(result.reason || 'No route found. Review start, goal and robot clearance.', true); return; }
      } catch (error) {
        if (operation === planningEpoch && version === generation && host) { invalidate(); if (error.name !== 'AbortError') tell(error.message, true); update(); }
        return;
      }
    }
    running = true; lastTime = 0; timer = requestAnimationFrame(tick); update(); tell('Playing a deterministic planning preview. The selected AI is not executing.');
  }
  function pick(point) {
    if (!placement) return;
    const [x, z] = Array.isArray(point) ? point : [point.x, point.z];
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const kind = placement;
    mutate(next => {
      if (kind === 'start' || kind === 'goal') next[kind] = [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
      else { const id = 'obstacle-' + Date.now().toString(36); next.obstacles.push({ id, label: 'New obstacle', x, z, width: 0.7, depth: 0.7, height: 1 }); selectedObstacle = id; }
    }, 'Map updated. Run again to calculate the new route.');
    placement = ''; if (kind === 'obstacle') step = 'review'; renderInspector(); update();
  }
  function exportScene() { download('brainsnn-site-scenario.json', { schema: 'brainsnn.site.scenario.v1', scene, planning: { proxy, mode, body }, operations: assumptions() ? { assumptions: assumptions() } : null, selected: { robotId: selection.robotId, modelId: selection.modelId, task: selection.task, seed: selection.seed }, appearance: hasAppearance() ? { filename: appearanceName(), transform: assetTransform, included: false } : null }); }
  function exportReport() {
    if (!result) return;
    download('brainsnn-site-route-report.json', { schema: 'brainsnn.site.report.v1', createdAt: new Date().toISOString(), execution: { kind: 'deterministic-2d-planning-preview', policyExecuted: false, benchmarkResult: null, physicsValidated: false, capturedRealityValidated: false }, selected: resultSelection, planningBody: robot(), scene, mode, result, operations: operationsEstimate, operationsAssumptions: assumptions(), visualAsset: hasAppearance() ? { filename: appearanceName(), included: false, collisionGeometry: false, transform: assetTransform } : null, notes: ['Imported appearance is separate from collision geometry.', 'Speeds and body envelopes are illustrative. Confirm them against the actual robot.', 'Coverage does not measure cleaning quality.', 'Cleaning time, human help and cost are estimates from user supplied assumptions; rates are not market quotes.'] }); tell('Route report downloaded with map-bound estimates and selected policy marked as not executed.');
  }
  async function importMap(file) {
    if (!file) return; const version = generation, operation = ++mapEpoch;
    const current = () => version === generation && operation === mapEpoch && Boolean(host);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Map JSON must be under 2 MB.');
      const raw = JSON.parse(await file.text()); if (!current()) return;
      let imported, restoredPlanning = null, restoredOperations;
      if (raw.scene) imported = core().normalizeScene(raw.scene);
      else if (raw.schemaVersion === 'brainsnn.site.v1' || raw.width && raw.depth && raw.start && raw.goal) imported = core().normalizeScene(raw);
      else imported = core().importRoomPlan(raw);
      imported.scaleConfirmed = false;
      if (raw.schema === 'brainsnn.site.scenario.v1' && raw.planning) {
        const plan = raw.planning, restored = {};
        if (!['selected', 'cleaner'].includes(plan.proxy) || !['navigation', 'coverage'].includes(plan.mode)) throw new Error('The saved planning configuration is invalid.');
        const limits = { width: [0.1, 5], depth: [0.1, 5], height: [0.1, 5], speed: [0.05, 3], operationWidth: [0.05, 5] };
        for (const [key, value] of Object.entries(plan.body || {})) { if (key === 'provenance') continue; if (!limits[key] || typeof value !== 'number' || !Number.isFinite(value) || value < limits[key][0] || value > limits[key][1]) throw new Error('The saved robot dimension or speed is invalid.'); restored[key] = value; }
        restoredPlanning = { proxy: plan.proxy, mode: plan.proxy === 'cleaner' ? plan.mode : 'navigation', body: plan.proxy === 'cleaner' || raw.selected?.robotId === selection.robotId ? (Object.keys(restored).length ? { ...restored, provenance: 'User supplied planning assumptions.' } : null) : null };
      }
      if (raw.schema === 'brainsnn.site.scenario.v1' && raw.operations != null) {
        if (!operations()) throw new Error('The cleaning-estimate module must load before restoring these assumptions.');
        if (typeof raw.operations !== 'object' || Array.isArray(raw.operations) || !raw.operations.assumptions || typeof raw.operations.assumptions !== 'object' || Array.isArray(raw.operations.assumptions)) throw new Error('The saved cleaning assumptions are invalid.');
        restoredOperations = operations().normalizeAssumptions(raw.operations.assumptions);
      }
      if (restoredPlanning) { proxy = restoredPlanning.proxy; mode = restoredPlanning.mode; body = restoredPlanning.body; }
      if (restoredOperations) { operationsAssumptions = restoredOperations; operationsOpen = true; }
      selectedObstacle = '';
      applyScene(imported, 'Map imported. Check dimensions, obstacles and scale before running.'); setStep('review');
    } catch (error) { if (current()) tell('Map import: ' + error.message, true); }
  }
  async function loadAsset(file, isNew = true) {
    if (!file || !renderer) return; const version = generation, operation = ++assetEpoch;
    const current = () => version === generation && operation === assetEpoch && Boolean(host);
    try {
      const metadata = await renderer.importAsset(file); if (!current()) return;
      if (isNew) assetTransform = { scale: 1, x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationZ: 0 };
      asset = file; pointCloud = null; assetMeta = metadata; renderer.setAssetTransform(assetTransform); if (isNew) view = 'reality'; renderer.setMode(view); renderInspector(); update();
      if (isNew) tell('3D appearance loaded. Align it in Review; only the reviewed floor map affects the route.');
    } catch (error) { if (current()) tell('3D import: ' + error.message, true); }
  }
  function addReferences(files) {
    for (const file of Array.from(files || [])) {
      if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(file.type)) { tell('Use JPG, PNG, WebP, MP4, MOV or WebM for local references.', true); continue; }
      if (references.length >= 8 || file.size > 150 * 1024 * 1024 || references.reduce((sum, r) => sum + r.file.size, 0) + file.size > 250 * 1024 * 1024) { tell('Keep references below 8 files, 150 MB each and 250 MB total.', true); continue; }
      references.push({ file, url: URL.createObjectURL(file), type: file.type });
      tell('Capture added locally. Draw or import a floor map, or explicitly send a capture to your worker.');
    }
    renderInspector();
  }
  function estimateGym() {
    if (!operations()) { tell('The cleaning-estimate module did not load. Reload the page and try again.', true); return; }
    if (proxy !== 'cleaner' || mode !== 'coverage') { proxy = 'cleaner'; mode = 'coverage'; body = null; invalidate(); renderer?.setRobot(robot()); }
    operationsOpen = true; setStep('test');
    if (!scene.scaleConfirmed) { tell('Review your gym map and confirm measured dimensions, then run coverage. Your map and Arena selection are preserved.', true); return; }
    if (!result) run();
    else { recalculateOperations(); update(); tell('Cleaning estimates use this coverage route. Edit assumptions and enter your own rates below.'); }
  }
  function handleClick(event) {
    const button = event.target.closest('button'); if (!button || !host.contains(button) || button.disabled) return;
    if (button.dataset.siteStep) { setStep(button.dataset.siteStep); return; }
    if (button.dataset.siteView) { view = button.dataset.siteView; renderer?.setMode(view); if (view === 'robot') renderer?.setCamera('robot'); update(); return; }
    if (button.dataset.siteCamera) { renderer?.setCamera(button.dataset.siteCamera); if (view === 'robot') { view = 'geometry'; renderer?.setMode(view); update(); } return; }
    if (button.dataset.sitePlace) { placement = placement === button.dataset.sitePlace ? '' : button.dataset.sitePlace; renderer?.setCamera('top'); updateButtons(); return; }
    if (button.dataset.siteRemoveRef !== undefined) { const removed = references.splice(Number(button.dataset.siteRemoveRef), 1)[0]; if (removed) URL.revokeObjectURL(removed.url); renderInspector(); return; }
    if (button.dataset.siteArtifact !== undefined) { downloadArtifact(Number(button.dataset.siteArtifact)); return; }
    switch (button.dataset.siteAction) {
      case 'gym-estimate': estimateGym(); break;
      case 'edit-operations': operationsOpen = true; setStep('test'); $('site-operations-assumptions')?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' }); break;
      case 'run': run(); break;
      case 'reset': if (planning) { invalidate(); update(); tell('Planning cancelled. Your reviewed map is unchanged.'); break; } stop(); cursor = 0; simTime = 0; renderer?.setTrace(result?.trace || [], 0); update(); tell('Playback reset. Your map and route are unchanged.'); break;
      case 'sample': clearAppearance(); selectedObstacle = ''; proxy = 'selected'; body = null; mode = 'navigation'; applyScene(core().sampleScene(), 'Sample space loaded. This is an authored example, not a customer scan.'); setStep('test'); break;
      case 'new-map': clearAppearance(); selectedObstacle = ''; applyScene({ ...core().sampleScene(), name: 'My space', width: 10, depth: 8, floor: [[0, 0], [10, 0], [10, 8], [0, 8]], start: [1, 1], goal: [9, 7], obstacles: [], scaleConfirmed: false, source: { kind: 'manual', name: 'Manual floor map', warnings: [] } }, 'Set your floor dimensions and add obstacles. Your reference remains in Capture.'); setStep('review'); break;
      case 'delete-obstacle': mutate(next => { next.obstacles = next.obstacles.filter(o => o.id !== selectedObstacle); }, 'Obstacle removed. Run again to update the route.'); selectedObstacle = ''; renderInspector(); break;
      case 'challenge-obstacle': setStep('review'); placement = 'obstacle'; renderer?.setCamera('top'); updateButtons(); tell('Click the floor to add a blocker, then run the route again.'); break;
      case 'change-goal': placement = 'goal'; renderer?.setCamera('top'); updateButtons(); tell('Click the floor to set a new destination.'); break;
      case 'remove-asset': clearAppearance(); renderInspector(); tell('Visual removed. The reviewed collision map is unchanged.'); break;
      case 'export-scene': exportScene(); break;
      case 'export-report': exportReport(); break;
      case 'reconstruct': reconstruct(); break;
      case 'open-reconstruction': openReconstruction(); break;
      case 'frame-asset': renderer?.frameAsset?.(); break;
      case 'block-route': { const point = result?.trace?.[Math.floor(result.trace.length / 2)]; if (!point) break; mutate(next => { const id = 'surprise-' + Date.now().toString(36); const r = robot(); next.obstacles.push({ id, label: 'Route blocker', x: point.x, z: point.z, width: Math.min(scene.width * 0.25, r.width + 0.4), depth: Math.min(scene.depth * 0.25, r.depth + 0.4), height: 0.9 }); selectedObstacle = id; }, 'A surprise now blocks the previous route. Run again to find out whether the robot can get around it.'); setStep('test'); break; }
      case 'cancel-reconstruction': cancelReconstruction(); break;
      case 'disconnect-worker': workerEpoch++; clearTimeout(pollTimer); requests.forEach(c => c.abort()); worker = null; workerJob = null; workerFile = null; workerBusy = false; workerStatus = 'Disconnected. Any already running job remains on your worker until cancelled there.'; renderInspector(); break;
    }
  }
  function clearAppearance() { assetEpoch++; asset = null; pointCloud = null; assetMeta = null; renderer?.clearAsset(); }
  function handleChange(event) {
    const el = event.target, id = el.id;
    if (id.startsWith('site-ops-')) {
      const a = assumptions(), key = id.replace('site-ops-', '');
      if (!a || !Object.prototype.hasOwnProperty.call(a, key)) return;
      const isRate = ['laborHourlyRate', 'robotHourlyCost', 'consumablesPerM2'].includes(key);
      const value = key === 'includeUncovered' ? el.checked : key === 'currency' ? el.value.trim().toUpperCase() : el.value.trim() === '' ? (isRate ? null : NaN) : Number(el.value);
      try { operationsAssumptions = operations().normalizeAssumptions({ ...a, [key]: value }); operationsOpen = true; recalculateOperations(); renderInspector(); update(); tell('Cleaning assumptions updated. Your existing coverage route is reused.'); }
      catch (error) { tell('Cleaning assumptions: ' + error.message, true); renderInspector(); }
      return;
    }
    if (id === 'site-reference-input') { addReferences(el.files); return; }
    if (id === 'site-map-input') { importMap(el.files?.[0]); return; }
    if (id === 'site-asset-input') { loadAsset(el.files?.[0]); return; }
    if (id === 'site-worker-file') { workerFile = el.files?.[0] || null; renderInspector(); return; }
    if (id === 'site-speed') { speed = Number(el.value); update(); return; }
    if (id === 'site-obstacle-select') { selectedObstacle = el.value; renderInspector(); return; }
    if (id === 'site-proxy') { proxy = el.value; body = null; if (proxy !== 'cleaner') mode = 'navigation'; invalidate(); renderer?.setRobot(robot()); renderInspector(); update(); tell('Planning body changed. Run a new route. Arena robot and model selection are preserved.'); return; }
    if (id === 'site-test-mode') { mode = el.value; invalidate(); renderInspector(); update(); return; }
    if (id === 'site-name') { mutate(next => { next.name = el.value; }); return; }
    if (id === 'site-scale-confirmed') { mutate(next => { next.scaleConfirmed = el.checked; }, el.checked ? 'Scale confirmed. The map is ready for a planning preview.' : 'Scale confirmation cleared.'); return; }
    if (id === 'site-width' || id === 'site-depth') {
      try { applyScene(core().resizeScene(scene, id === 'site-width' ? Number(el.value) : scene.width, id === 'site-depth' ? Number(el.value) : scene.depth), 'Floor resized, including obstacle positions. Confirm the new measurements before running.'); } catch (error) { tell(error.message, true); renderInspector(); } return;
    }
    if (/^site-(start|goal)-(x|z)$/.test(id)) { const [, point, axis] = id.split('-'); mutate(next => { next[point][axis === 'x' ? 0 : 1] = Number(el.value); }, 'Position updated. Run again to calculate the new route.'); return; }
    if (id.startsWith('site-obstacle-') && selectedObstacle) { const key = id.replace('site-obstacle-', ''); mutate(next => { const obstacle = next.obstacles.find(o => o.id === selectedObstacle); if (obstacle) obstacle[key] = key === 'label' ? el.value : Number(el.value); }, 'Obstacle updated. The previous route has been cleared.'); return; }
    if (id.startsWith('site-body-')) {
      const key = id.replace('site-body-', ''), value = Number(el.value);
      if (!Number.isFinite(value) || value < (key === 'speed' ? 0.05 : 0.1) || value > (key === 'speed' ? 3 : 5)) { tell('Use a measured body value between ' + (key === 'speed' ? '0.05 and 3.' : '0.1 and 5.'), true); renderInspector(); return; }
      body = { ...(body || {}), [key]: value, provenance: 'User supplied planning assumptions.' }; invalidate(); renderer?.setRobot(robot()); renderInspector(); update(); tell('Robot envelope updated. Run a fresh route.'); return;
    }
    if (id.startsWith('site-asset-')) {
      const key = id.replace('site-asset-', ''), value = Number(el.value); if (!Number.isFinite(value) || key === 'scale' && value <= 0) { tell('Enter a valid visual transform.', true); return; }
      assetTransform[key] = key.startsWith('rotation') ? value * Math.PI / 180 : value; renderer?.setAssetTransform(assetTransform); tell('Appearance alignment updated. Collision geometry has not changed.');
    }
  }
  function handleInput(event) {
    if (event.target.id !== 'site-scrubber' || !result) return;
    stop(); cursor = Math.max(0, Math.min(result.trace.length - 1, Number(event.target.value))); simTime = result.trace[cursor]?.t || 0; renderer?.setTrace(result.trace, cursor); update();
  }
  function keyDown(event) { if (event.key === 'Escape' && host) { placement = ''; updateButtons(); } }
  function visibility() { if (document.hidden) { stop(); update(); clearTimeout(pollTimer); } else if (host && workerJob) schedulePoll(); }
  function safeWorkerURL(value) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('Use an HTTPS worker URL, or HTTP on localhost. Do not include credentials, query strings or fragments in the URL.');
    return u.href.replace(/\/$/, '');
  }
  async function workerFetch(path, options = {}, connection = worker, responseType = 'json') {
    if (!connection) throw new Error('Connect your worker first.');
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), options.body instanceof File ? 120000 : 30000);
    const limit = responseType === 'blob' ? 64 * 1024 * 1024 : 8 * 1024 * 1024;
    try {
      const response = await fetch(connection.url + path, { ...options, headers: { Authorization: 'Bearer ' + connection.token, ...options.headers }, signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (Number(response.headers?.get('content-length')) > limit) throw new Error('The worker response exceeds the browser size limit.');
      const chunks = []; let length = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('The worker response exceeds the browser size limit.'); } chunks.push(next.value); }
      } else { const bytes = new Uint8Array(await response.arrayBuffer()); length = bytes.byteLength; if (length > limit) throw new Error('The worker response exceeds the browser size limit.'); chunks.push(bytes); }
      if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let data = null;
      if (responseType === 'json' || !response.ok) { try { data = length ? JSON.parse(new TextDecoder().decode(bytes)) : {}; } catch { if (response.ok) throw new Error('The worker returned unreadable JSON.'); } }
      if (!response.ok) { const detail = typeof data?.detail === 'string' ? data.detail : jobError(data?.error); throw new Error('Worker returned ' + response.status + (detail ? ': ' + detail.slice(0, 240) : '. Check its token and allowed website origin.')); }
      return responseType === 'blob' ? new Blob([bytes], { type: response.headers?.get('content-type') || 'application/octet-stream' }) : data;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  async function connectWorker(event) {
    event.preventDefault(); const version = generation, operation = ++workerEpoch;
    clearTimeout(pollTimer); requests.forEach(c => c.abort());
    let connection;
    const current = () => operation === workerEpoch && version === generation && Boolean(host) && worker === connection;
    try {
      const url = safeWorkerURL($('site-worker-url')?.value.trim()), token = $('site-worker-token')?.value.trim(); if (!token) throw new Error('Enter the private worker token.');
      if (!worker || worker.url !== url) workerJob = null;
      connection = { url, token, capabilities: {} }; worker = connection; workerBusy = true; workerStatus = 'Checking reconstruction capabilities…'; renderInspector();
      const data = await workerFetch('/v1/site-scans/capabilities', {}, connection); if (!current()) return;
      if (data.version !== 1 || !Array.isArray(data.acceptedTypes)) throw new Error('This endpoint does not advertise the BrainSNN scan-worker protocol.');
      connection.capabilities = data; workerStatus = data.available ? 'Worker ready. Uploads go only to this worker. Output geometry still needs review and scale confirmation.' : 'Worker connected, but reconstruction is unavailable: ' + (data.missing || []).join(', ');
      schedulePoll();
    } catch (error) {
      if (operation !== workerEpoch || version !== generation || !host) return;
      workerStatus = error.name === 'AbortError' ? 'Connection timed out or was cancelled.' : error.message; worker = null; workerJob = null;
    } finally { if (operation === workerEpoch && version === generation && host) { workerBusy = false; renderInspector(); } }
  }
  async function reconstruct() {
    if (!worker || !workerFile || workerBusy) return;
    const version = generation, operation = workerEpoch, connection = worker, chosen = workerFile;
    const current = () => operation === workerEpoch && version === generation && worker === connection && Boolean(host);
    try {
      const max = Number(connection.capabilities.maxUploadBytes) || 150 * 1024 * 1024;
      if (chosen.size > max) throw new Error('This capture exceeds the worker upload limit of ' + Math.round(max / 1024 / 1024) + ' MB.');
      const contentType = chosen.type || (/\.zip$/i.test(chosen.name) ? 'application/zip' : /\.mov$/i.test(chosen.name) ? 'video/quicktime' : 'video/mp4');
      if (!(connection.capabilities.acceptedTypes || []).includes(contentType)) throw new Error('This worker does not accept ' + contentType + '. Choose a supported capture type.');
      workerBusy = true; workerStatus = 'Uploading your capture to the connected worker…'; renderInspector();
      const data = await workerFetch('/v1/site-scans', { method: 'POST', headers: { 'Content-Type': contentType, 'X-Filename': encodeURIComponent(chosen.name) }, body: chosen }, connection);
      if (!current()) return;
      if (data.version !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id || '')) throw new Error('Worker returned an invalid scan job.');
      workerJob = data; workerStatus = 'Reconstruction queued. A point cloud is not yet a reviewed collision map.'; schedulePoll();
    } catch (error) { if (current()) workerStatus = error.name === 'AbortError' ? 'Upload interrupted. Check your worker before trying again.' : error.message; }
    finally { if (current()) { workerBusy = false; renderInspector(); } }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!worker || !workerJob || !host || document.hidden || terminalJob(workerJob.status)) return;
    pollTimer = setTimeout(pollWorker, 2000);
  }
  async function pollWorker() {
    const version = generation, operation = workerEpoch, connection = worker, jobId = workerJob?.id; if (!jobId || !connection) return;
    const current = () => version === generation && operation === workerEpoch && connection === worker && Boolean(host) && jobId === workerJob?.id;
    try {
      const data = await workerFetch('/v1/site-scans/' + encodeURIComponent(jobId), {}, connection); if (!current()) return;
      if (data.id !== jobId || data.version !== 1) throw new Error('Worker returned a mismatched scan job.');
      workerJob = data;
      workerStatus = ['complete', 'completed', 'succeeded'].includes(data.status) ? 'Reconstruction finished. Open the result in 3D, align it, establish metric scale, then review the floor geometry.' : data.status === 'failed' ? 'Reconstruction failed. ' + jobError(data.error) : data.status === 'cancelled' ? 'Reconstruction cancelled.' : 'Processing on your worker. You can continue reviewing the local map.';
      if (step === 'capture') renderInspector(); schedulePoll();
    } catch (error) { if (current()) { workerStatus = error.name === 'AbortError' ? 'Worker check interrupted. Reconnect to check the job.' : error.message; if (step === 'capture') renderInspector(); } }
  }
  function artifactPath(artifact, jobId) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(artifact?.name || '') || artifact.name.includes('..')) throw new Error('Worker artifact name is invalid.');
    return '/v1/site-scans/' + encodeURIComponent(jobId) + '/artifacts/' + encodeURIComponent(artifact.name);
  }
  async function downloadArtifact(index) {
    const artifact = workerJob?.artifacts?.[index], jobId = workerJob?.id, connection = worker, operation = workerEpoch, version = generation; if (!artifact || !connection) return;
    const current = () => operation === workerEpoch && version === generation && connection === worker && jobId === workerJob?.id && Boolean(host);
    try { const blob = await workerFetch(artifactPath(artifact, jobId), {}, connection, 'blob'); if (current()) download(artifact.name, blob); }
    catch (error) { if (current()) { workerStatus = error.message; renderInspector(); } }
  }
  async function openReconstruction() {
    const artifact = workerJob?.artifacts?.find(a => a.name === 'point-cloud.json'), jobId = workerJob?.id, connection = worker;
    if (!artifact || !connection || !renderer?.setPointCloud) return;
    const operation = workerEpoch, version = generation, appearanceOperation = ++assetEpoch, mapOperation = mapEpoch;
    const current = () => operation === workerEpoch && version === generation && connection === worker && jobId === workerJob?.id && appearanceOperation === assetEpoch && mapOperation === mapEpoch && Boolean(host);
    try {
      workerStatus = 'Loading reconstruction. Opening it starts a new unscaled floor map.'; renderInspector();
      const cloud = await workerFetch(artifactPath(artifact, jobId), {}, connection); if (!current()) return;
      const metadata = renderer.setPointCloud(cloud);
      asset = null; pointCloud = cloud; assetMeta = metadata; assetTransform = { scale: 1, x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationZ: 0 };
      selectedObstacle = ''; applyScene({ ...core().sampleScene(), name: 'Reconstructed space', width: 10, depth: 8, floor: [[0, 0], [10, 0], [10, 8], [0, 8]], start: [1, 1], goal: [9, 7], obstacles: [], scaleConfirmed: false, source: { kind: 'reconstruction-reference', name: 'COLMAP sparse visual reference', warnings: ['The point cloud is in arbitrary units and may not be upright.', 'Floor dimensions and collision obstacles must be measured and reviewed manually.'] } });
      view = 'reality'; renderer.setMode(view); renderer.frameAsset?.(); setStep('review');
      tell('Real reconstruction opened as a visual reference. Your new floor map is empty and unscaled. Set dimensions, align the cloud, and mark obstacles before testing.');
    } catch (error) { if (current()) { workerStatus = error.message; renderInspector(); tell('Reconstruction preview: ' + error.message, true); } }
  }
  async function cancelReconstruction() {
    const connection = worker, jobId = workerJob?.id, operation = ++workerEpoch, version = generation; if (!connection || !jobId) return;
    clearTimeout(pollTimer); requests.forEach(c => c.abort());
    const current = () => operation === workerEpoch && version === generation && connection === worker && jobId === workerJob?.id && Boolean(host);
    try { await workerFetch('/v1/site-scans/' + encodeURIComponent(jobId), { method: 'DELETE' }, connection); if (current()) { workerJob = null; workerStatus = 'Job cancelled and deletion requested on your worker.'; } }
    catch (error) { if (current()) workerStatus = error.message; }
    if (operation === workerEpoch && version === generation && host) { workerBusy = false; renderInspector(); }
  }
  function suspend() {
    generation++; stop(); planningEpoch++; planCancel?.(); planCancel = null; planner?.terminate(); planner = null; planning = false; clearTimeout(pollTimer); requests.forEach(c => c.abort()); requests.clear(); workerBusy = false;
    if (host) { host.removeEventListener('click', handleClick); host.removeEventListener('change', handleChange); host.removeEventListener('input', handleInput); host.querySelectorAll('video').forEach(video => video.pause()); }
    document.removeEventListener('keydown', keyDown); document.removeEventListener('visibilitychange', visibility);
    renderer?.dispose(); renderer = null; host = null;
  }
  function updateSelection(next) {
    const changed = signature(next) !== signature(selection); selection = clone(next || {});
    if (changed) { invalidate(); body = null; proxy = 'selected'; mode = 'navigation'; renderer?.setRobot(robot()); if (host) { renderInspector(); update(); tell('Selection updated. Your map is preserved; run a fresh preview for this robot.'); } }
  }
  function mount(element, next = {}) {
    suspend(); host = element; updateSelection(next);
    if (!core()) { host.innerHTML = '<p class="site-status is-error">The site planning layer did not load. Reload to try again.</p>'; return; }
    initialScene(); render(); document.addEventListener('keydown', keyDown); document.addEventListener('visibilitychange', visibility); schedulePoll();
  }
  function getState() { return clone({ selection: { robotId: selection.robotId, modelId: selection.modelId, task: selection.task, seed: selection.seed }, scene, step, view, placement, mode, proxy, body, running, cursor, policyExecuted: false, result, resultSelection, planning, operations: { assumptions: assumptions(), estimate: operationsEstimate }, referenceCount: references.length, visualAsset: hasAppearance() ? { name: appearanceName(), metadata: assetMeta, transform: assetTransform } : null, reconstruction: workerJob ? { id: workerJob.id, status: workerJob.status, stage: workerJob.stage } : null, workerConnected: Boolean(worker), message }); }
  window.BrainSNNSiteWorkspace = { mount, suspend, updateSelection, getState };
})();
