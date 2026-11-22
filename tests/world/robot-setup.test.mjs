import test from 'node:test';
import assert from 'node:assert/strict';
import {ROBOTS, SCHEMA, normalizeWorld, planWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {ROBOT_ART, WORLD_ICONS, ICONS} from '../../brainsnn-r3f-app/public/world/playground-icons.mjs';
import {pace, bodySize, WORLD_CHOICES, mountRobotSetup} from '../../brainsnn-r3f-app/public/world/robot-setup.mjs';

test('every planner robot has a drawing and plain size and pace words', () => {
  for (const [id, robot] of Object.entries(ROBOTS)) {
    assert.match(ROBOT_ART[id] || '', /<svg[^>]+aria-hidden="true"/, `${id} needs a decorative drawing beside its name`);
    assert.match(bodySize(robot), /^\d+(\.\d+)? × \d+(\.\d+)? (cm|m)$/, `${id} size`);
    assert.ok(['Slow', 'Steady', 'Fast'].includes(pace(robot.speed)), `${id} pace`);
  }
  assert.equal(bodySize(ROBOTS.cleaner), '58 × 68 cm');
  assert.equal(bodySize(ROBOTS.forklift), '1.1 × 2.4 m');
  assert.equal(pace(ROBOTS.vacuum.speed), 'Slow');
  assert.equal(pace(ROBOTS.amr.speed), 'Steady');
  assert.equal(pace(ROBOTS.forklift.speed), 'Fast');
});

test('every world choice has a picture, and pictures never stand in for words', () => {
  assert.deepEqual(WORLD_CHOICES.map(w => w.kind), ['sample', 'street', 'empty', 'capture', 'saved']);
  for (const world of WORLD_CHOICES) {
    assert.ok(WORLD_ICONS[world.kind], `${world.kind} picture`);
    assert.ok(world.title && world.plain, `${world.kind} has a title and a plain line`);
  }
  for (const svg of [...Object.values(ROBOT_ART), ...Object.values(WORLD_ICONS), ...Object.values(ICONS)]) {
    assert.match(svg, /aria-hidden="true" focusable="false"/);
  }
});

const reviewedRoom = size => normalizeWorld({schema:SCHEMA,name:'Reviewed empty room',width:size,depth:size,objects:[],provenance:'authored',scaleReviewed:true,mapReviewed:true,start:{x:1,z:1}});
const forklift = {...ROBOTS.forklift,margin:.1};
function blockedStart(world) {
  try { planWorld(world,forklift); }
  catch (error) { assert.ok(error.advice?.start,'The real planner should provide recovery advice.');return error; }
  assert.fail('This fixture should block the forklift start.');
}

// Minimal host controls exercise the mounted UI's note, button and delegated click
// using actual planner errors, without adding a DOM library to the contract suite.
function setupWithIssue(issue) {
  const elements = new Map(['#robot-setup-run','#robot-setup-note','#robot-setup-world','[data-picked-robot]','[data-picked-world]','#robot-setup-fix','.run-icon','.run-label'].map(selector => [selector,{textContent:'',hidden:false}]));
  elements.get('#robot-setup-run').querySelector = selector => elements.get(selector);
  let click;
  const host = {dataset:{},querySelector:selector => elements.get(selector),querySelectorAll:() => [],
    addEventListener(type,listener) { assert.equal(type,'click');click=listener; },replaceChildren() {}};
  const state = {robotId:'forklift',robotName:ROBOTS.forklift.name,origin:'empty',worldName:'Reviewed empty room',planning:false,runDisabled:false,gate:null,issue};
  const calls = {moves:[],settings:0,checks:0};
  const setup = mountRobotSetup({host,robots:ROBOTS,getState:() => state,actions:{
    moveStart:spot => calls.moves.push(spot),showRobotSettings:() => calls.settings++,showCheck:() => calls.checks++,
  }});
  const fix=elements.get('#robot-setup-fix'),note=elements.get('#robot-setup-note');
  return {...setup,state,calls,fix,note,clickFix() {
    assert.equal(fix.hidden,false,'Recovery control should be visible.');
    click({target:{closest:selector => selector === '#robot-setup-fix' ? fix : null}});
  }};
}

test('a fitting start for the current robot offers a move that allows the same envelope to plan', () => {
  const world=reviewedRoom(6),issue=blockedStart(world);
  assert.equal(issue.advice.size,undefined);
  const setup=setupWithIssue(issue);
  assert.equal(setup.fix.textContent,'Move the start to where it fits');
  setup.clickFix();
  assert.deepEqual(setup.calls.moves,[issue.advice.start]);
  assert.equal(setup.calls.settings,0);assert.equal(setup.calls.checks,0);
  assert.ok(planWorld({...world,start:setup.calls.moves[0]},forklift).distance>0,'The suggested move must fit the unchanged forklift.');
  setup.dispose();
});

test('a forklift in a 2 by 2 room opens size settings instead of moving to a smaller-envelope start', () => {
  const world=reviewedRoom(2),issue=blockedStart(world),size=issue.advice.size;
  assert.ok(size>0);
  assert.throws(() => planWorld({...world,start:issue.advice.start},forklift),/no spot in this map fits/);
  assert.ok(planWorld({...world,start:issue.advice.start},{...forklift,width:size,depth:size}).distance>0,'The planner advice is usable only after changing the envelope.');
  const setup=setupWithIssue(issue);
  assert.match(setup.note.textContent,/No starting spot fits the compact forklift at its current size and clearance/);
  assert.equal(setup.fix.textContent,'Change robot size or clearance');
  setup.clickFix();
  assert.deepEqual(setup.calls.moves,[]);assert.equal(setup.calls.settings,1);assert.equal(setup.calls.checks,0);
  // A later compatible map must replace this recovery action with a genuine move.
  const fittingIssue=blockedStart(reviewedRoom(6));setup.state.issue=fittingIssue;setup.refresh();
  assert.equal(setup.fix.textContent,'Move the start to where it fits');setup.clickFix();
  assert.deepEqual(setup.calls.moves,[fittingIssue.advice.start]);assert.equal(setup.calls.settings,1);
  setup.dispose();
});
