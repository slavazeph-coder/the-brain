/* BrainSNN floor-run estimates. Geometry comes from the reviewed route;
 * service, human assistance and cost inputs remain operator assumptions. */
(function (root, factory) {
  var api = factory(root.BrainSNNSiteCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrainSNNSiteOperations = api;
}(typeof window !== 'undefined' ? window : globalThis, function (core) {
  'use strict';
  var SCHEMA = 'brainsnn.site-operations.v1', EPS = 1e-8;
  function fail(message) { throw new Error(message); }
  function finite(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(name + ' must be a number from ' + min + ' to ' + max + '.');
    return value;
  }
  function defaults() {
    return { currency: 'CAD', passes: 1, turnSeconds: 3, setupMinutes: 5, finishMinutes: 3, expectedInterventions: 0, minutesPerIntervention: 2, serviceAreaM2: 0, serviceMinutes: 0, manualM2PerHour: 120, includeUncovered: true, laborHourlyRate: null, robotHourlyCost: null, consumablesPerM2: null };
  }
  function normalizeAssumptions(input) {
    if (input === undefined) input = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Operational assumptions must be an object.');
    var out = defaults();
    Object.keys(out).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) out[key] = input[key]; });
    if (typeof out.currency !== 'string' || !/^[A-Z]{3}$/.test(out.currency)) fail('Currency must be a three-letter uppercase code. Rates are not converted between currencies.');
    finite(out.passes, 'Passes', 1, 10); if (!Number.isInteger(out.passes)) fail('Passes must be a whole number.');
    finite(out.turnSeconds, 'Delay per turn', 0, 120);
    ['setupMinutes', 'finishMinutes', 'minutesPerIntervention', 'serviceMinutes'].forEach(function (key) { finite(out[key], key, 0, 1440); });
    finite(out.expectedInterventions, 'Expected interventions', 0, 1000); if (!Number.isInteger(out.expectedInterventions)) fail('Expected interventions must be a whole number.');
    finite(out.serviceAreaM2, 'Area between service stops', 0, 1000000);
    if (out.serviceAreaM2 > 0 && out.serviceAreaM2 < 0.1) fail('Area between service stops must be zero or at least 0.1 square metres.');
    finite(out.manualM2PerHour, 'Manual follow-up productivity', 0.1, 1000000);
    if (typeof out.includeUncovered !== 'boolean') fail('Include uncovered floor must be true or false.');
    ['laborHourlyRate', 'robotHourlyCost', 'consumablesPerM2'].forEach(function (key) { if (out[key] !== null) finite(out[key], key, 0, 1000000); });
    return out;
  }
  function routeFacts(scene, plan) {
    if (!Array.isArray(plan.path) || !plan.path.length || plan.path.length > 20000) fail('The route needs a bounded path before estimating operations.');
    var distance = 0, turns = 0, previousDirection = null;
    plan.path.forEach(function (p, i) {
      if (!Array.isArray(p) || p.length !== 2) fail('The route contains an invalid floor position.');
      finite(p[0], 'Route x', 0, scene.width); finite(p[1], 'Route z', 0, scene.depth);
      if (!i) {
        if (Math.hypot(p[0] - scene.start[0], p[1] - scene.start[1]) > EPS) fail('The route no longer starts at the reviewed floor start.');
        return;
      }
      var before = plan.path[i - 1], dx = p[0] - before[0], dz = p[1] - before[1], length = Math.hypot(dx, dz);
      distance += length;
      if (length <= EPS) return;
      var direction = [dx / length, dz / length];
      if (previousDirection) {
        var dot = Math.max(-1, Math.min(1, direction[0] * previousDirection[0] + direction[1] * previousDirection[1]));
        if (Math.acos(dot) > Math.PI / 12 + 1e-9) turns++;
      }
      previousDirection = direction;
    });
    finite(plan.metrics.distance, 'Planned route distance', 0, 20000000);
    if (Math.abs(plan.metrics.distance - distance) > Math.max(EPS, distance * 1e-8)) fail('The route distance has changed. Run the current floor again.');
    return { distance: distance, turns: turns };
  }
  function estimate(input, plan, assumptionsInput) {
    if (!core || typeof core.normalizeScene !== 'function' || typeof core.digest !== 'function') fail('Load the site planner before estimating a floor run.');
    var scene = core.normalizeScene(input), assumptions = normalizeAssumptions(assumptionsInput), sceneDigest = core.digest(scene);
    if (!scene.scaleConfirmed) fail('Confirm measured floor dimensions before estimating a run.');
    if (!plan || typeof plan !== 'object' || plan.schemaVersion !== 'brainsnn.site-plan.v1') fail('Run a supported floor coverage route before estimating operations.');
    if (plan.sceneDigest !== sceneDigest) fail('The reviewed floor has changed. Run the current floor again before estimating operations.');
    if (plan.status !== 'complete') fail('A complete route is required before estimating operations.');
    if (plan.mode !== 'coverage') fail('Choose floor coverage to estimate cleaning time, assistance and cost.');
    if (!plan.robot || plan.robot.kind !== 'cleaner') fail('Choose a cleaning robot planning body before estimating a floor run.');
    var speed = finite(plan.robot.speed, 'Robot route speed', 0.05, 3);
    if (!plan.metrics || typeof plan.metrics !== 'object') fail('The route has no floor coverage metrics.');
    var floorArea = core.polygonArea(scene.floor);
    var free = finite(plan.metrics.freeArea, 'Free floor area', 0, floorArea + EPS);
    var covered = finite(plan.metrics.coveredArea, 'Route-covered floor estimate', 0, free + EPS);
    covered = Math.min(free, covered);
    var facts = routeFacts(scene, plan), passes = assumptions.passes;
    var workedArea = covered * passes, uncovered = Math.max(0, free - covered), manualArea = assumptions.includeUncovered ? uncovered : 0;
    var stops = assumptions.serviceAreaM2 > 0 ? Math.max(0, Math.ceil(workedArea / assumptions.serviceAreaM2) - 1) : 0;
    var travelMinutes = facts.distance / speed * passes / 60, turnMinutes = facts.turns * passes * assumptions.turnSeconds / 60;
    var serviceMinutes = stops * assumptions.serviceMinutes, interventionMinutes = assumptions.expectedInterventions * assumptions.minutesPerIntervention;
    var manualMinutes = manualArea / assumptions.manualM2PerHour * 60;
    var robotMinutes = travelMinutes + turnMinutes + serviceMinutes;
    var humanMinutes = assumptions.setupMinutes + assumptions.finishMinutes + serviceMinutes + interventionMinutes + manualMinutes;
    // Servicing pauses the robot and uses human time; count that shared period only once.
    var elapsedMinutes = robotMinutes + assumptions.setupMinutes + assumptions.finishMinutes + interventionMinutes + manualMinutes;
    var missingRates = ['laborHourlyRate', 'robotHourlyCost', 'consumablesPerM2'].filter(function (key) { return assumptions[key] === null; });
    var costs = { currency: assumptions.currency, labor: assumptions.laborHourlyRate === null ? null : humanMinutes / 60 * assumptions.laborHourlyRate, robot: assumptions.robotHourlyCost === null ? null : robotMinutes / 60 * assumptions.robotHourlyCost, consumables: assumptions.consumablesPerM2 === null ? null : workedArea * assumptions.consumablesPerM2, total: null, missingRates: missingRates };
    if (!missingRates.length) costs.total = costs.labor + costs.robot + costs.consumables;
    var warnings = [
      'This is an operator-assumption estimate on reviewed geometry. No robot, learned policy, physics or cleaning quality was tested.',
      'Covered floor is a brush-width grid estimate, not proof that the floor was cleaned. Uncovered area includes edges and disconnected floor.',
      'The coverage route visits planning-grid cells. Cleaning width does not optimize lane spacing; travel time can differ substantially from a deployed robot.',
      'Turns use heading changes greater than 15 degrees plus your entered delay. Acceleration, crowds, sensing and robot-specific motion are not modelled.',
      'Human assistance uses entered setup, finishing, intervention and manual-productivity assumptions. The map cannot predict intervention frequency.',
      'Elapsed time assumes the robot run, assistance and manual follow-up occur sequentially. Service time is included only once.',
      'Robot cost covers the estimated occupied route time, including entered service stops. Financing, tax and unentered overhead are excluded.'
    ];
    if (!assumptions.serviceAreaM2) warnings.push('Service stops are disabled. Battery charging, docking, water refill, waste emptying and travel to service are not otherwise predicted.');
    else warnings.push('Service-stop count uses your entered area capacity. Charging, docking and travel to service require separate measured allowance; no actual service location was routed.');
    if (passes > 1) warnings.push('Multiple passes repeat the same route. Transit from the end back to the next pass start is not included.');
    if (!assumptions.includeUncovered) warnings.push('Manual follow-up of uncovered floor is excluded from time and cost.');
    if (missingRates.length) warnings.push('Enter every cost rate, including explicit zero rates where appropriate, before a total per-run cost can be shown.');
    if (scene.source.kind === 'sample') warnings.push('This floor is an illustrative sample, not a captured customer gym.');
    var out = {
      schemaVersion: SCHEMA, sceneDigest: sceneDigest, planDigest: core.digest(plan), assumptionsDigest: core.digest(assumptions),
      assumptions: assumptions,
      provenance: { evidenceType: 'operator-assumption-estimate', sceneSource: { kind: scene.source.kind, name: scene.source.name }, planningRobot: { id: typeof plan.robot.id === 'string' ? plan.robot.id.slice(0, 60) : 'cleaner', label: typeof plan.robot.label === 'string' ? plan.robot.label.slice(0, 100) : 'Cleaning robot planning body', provenance: typeof plan.robot.provenance === 'string' ? plan.robot.provenance.slice(0, 200) : 'Operator supplied planning assumptions.' } },
      policyExecuted: false, physicsExecuted: false, cleaningQualityValidated: false,
      coverage: { freeAreaM2: free, coveredAreaM2: covered, uncoveredAreaM2: uncovered, manualFollowupAreaM2: manualArea, workedAreaM2: workedArea, coveragePercent: free > 0 ? covered / free * 100 : 0, passes: passes },
      route: { distanceMeters: facts.distance, workingDistanceMeters: facts.distance * passes, speedMetersPerSecond: speed, headingChanges: facts.turns, turnsAllPasses: facts.turns * passes, serviceStops: stops },
      timing: { travelMinutes: travelMinutes, turnMinutes: turnMinutes, serviceMinutes: serviceMinutes, setupMinutes: assumptions.setupMinutes, finishMinutes: assumptions.finishMinutes, interventionMinutes: interventionMinutes, manualFollowupMinutes: manualMinutes, robotRunMinutes: robotMinutes, humanHelpMinutes: humanMinutes, sequentialElapsedMinutes: elapsedMinutes },
      costs: costs, warnings: warnings
    };
    out.estimateDigest = core.digest(out);
    return out;
  }
  return { defaults: defaults, normalizeAssumptions: normalizeAssumptions, estimate: estimate };
}));
