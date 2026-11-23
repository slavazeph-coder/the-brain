import {SENSES} from './sense-room.mjs';
import {continueSenseTrial, runSenseTrial, SENSE_EXTRA_POINTS} from './sense-policy.mjs';

const el = id => document.getElementById(id);
const NAMES = {sight:'Sight', hearing:'Hearing', touch:'Touch', smell:'Smell', taste:'Taste'};
const STRATEGIES = {
  baseline:'Sight only',
  active:'Choose clues without memory',
  memory:'Use lessons from practice rooms',
};
const VERDICTS = {
  reached:'Found and reached the matching cart.',
  wrong_cart:'The robot chose the wrong cart.',
  blocked:'The robot could not reach its choice.',
  correct_abstention:'The robot stopped without choosing.',
  false_absence:'The robot reported a missing target when more than one matched.',
  missed_target:'The robot stopped even though the matching cart could be found.',
  ambiguous_choice:'The robot chose a cart when there was no unique match.',
};
const COLOR = {amber:'#ffb639',orange:'#fba353',blue:'#7eb4f7',teal:'#68d9cb',green:'#8ecb7b',red:'#e38a88',purple:'#b6a1e4',white:'#eeeee4',gray:'#afbaba',grey:'#afbaba'};
const seedBase = 13001;
let seed = seedBase;
let run, stepIndex = 0, timer, benchmarkWorker, compareSequence = 0, reportToSave;

function node(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function tagSVG(name, props, text) {
  const result = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k,v] of Object.entries(props)) result.setAttribute(k,v);
  if (text !== undefined) result.textContent = text;
  return result;
}
function capitalize(value) {
  const word = String(value ?? 'No reading');
  return word[0].toUpperCase() + word.slice(1);
}
function enabledSenses() {
  return [...document.querySelectorAll('#sense-choices input:checked')].map(input => input.value);
}
function settings() {
  return {seed,task:el('task').value,split:'test',mode:el('mode').value,budget:Number(el('limit').value),
    robot:el('robot').value,strategy:el('strategy').value,enabledSenses:enabledSenses()};
}
function stop() {
  clearInterval(timer);
  timer = null;
  el('play').textContent = 'Play trial';
}
function datum(snapshot, value) {
  return snapshot.candidates.find(cart => cart.id === value)?.label ?? 'the cart';
}
function actionText(action, snapshot) {
  const name = datum(snapshot, action.candidateId);
  switch (action.type) {
    case 'inspect':
      if (action.sense === 'sight' && action.view === 'side') return 'Look at ' + name + ' from the side.';
      if (action.sense === 'taste') return 'Check the taste sample for ' + name + '.';
      return 'Check ' + name + ' with ' + NAMES[action.sense].toLowerCase() + '.';
    case 'ask': return 'Ask about ' + name + '’s ' + NAMES[action.sense].toLowerCase() + ' clue.';
    case 'extend': return 'Add ' + action.points + ' clue points and keep the clues already found.';
    case 'abstain': return snapshot.task === 'delivery' ? 'Stop without choosing a bay.' : 'Stop without choosing a cart.';
    case 'choose': return 'Try to reach ' + name + '.';
    default: return 'Review the clues.';
  }
}
function resultText(step) {
  const {action,after} = step;
  if (action.type === 'inspect') {
    const added = after.observations.slice(step.before.observations.length);
    return added.map(o => o.value == null ? 'No clear reading.' : 'The reading was ' + o.value + flavorSignals(o) + '.').join(' ');
  }
  if (action.type === 'ask') {
    const answer = after.question;
    return answer?.value != null ? 'The visitor answered ' + answer.value + '.' : 'No extra clue was available.';
  }
  return '';
}
function state() { return stepIndex ? run.steps[stepIndex-1].after : run.initial; }
function markReference(snapshot) {
  const host = el('reference');
  host.replaceChildren();
  const delivery = el('task').value === 'delivery';
  const image = el('reference-picture');
  image.hidden = delivery;
  if (!delivery && ['amber','teal','purple','white'].includes(snapshot.reference.sight)) {
    image.src='./assets/sense-cart-'+snapshot.reference.sight+'.jpg';
    image.alt='Illustrated '+snapshot.reference.sight+' reference cart.';
  } else image.removeAttribute('src');
  el('ref-prompt').textContent=delivery ? 'Match the delivery clues and check the bay’s width.' : 'Look for these clues together.';
  for (const sense of (delivery ? snapshot.goal?.senses || ['hearing','taste'] : SENSES)) {
    const value = snapshot.reference[sense];
    const row = node('div');
    const word = node('dd',capitalize(value));
    if (sense === 'sight' && Object.hasOwn(COLOR,value)) {
      const swatch = node('i');
      swatch.className='swatch';
      swatch.style.backgroundColor=COLOR[value];
      word.prepend(swatch);
    }
    row.append(node('dt',NAMES[sense]),word);
    host.append(row);
  }
  if(delivery && Number.isFinite(snapshot.goal?.minWidth)) {
    const row=node('div');row.append(node('dt','Minimum width'),node('dd',snapshot.goal.minWidth.toFixed(2)+' m'));host.append(row);
  }
}
function flavorSignals(row) {
  if(!Number.isFinite(row.channels?.sweet) || !Number.isFinite(row.channels?.sour)) return '';
  return ' (sweet '+row.channels.sweet.toFixed(2)+', sour '+row.channels.sour.toFixed(2)+')';
}
function readCart(snapshot) {
  const picked = el('inspect-cart').value;
  const allowed = enabledSenses();
  const found = snapshot.observations.filter(row => row.candidateId === picked && allowed.includes(row.sense));
  const words = found.map(row => (row.source === 'visitor' ? 'Visitor’s answer, ' : '') + NAMES[row.sense] + (row.view === 'side' ? ' from the side' : '') + ' — ' + (row.value ?? 'no clear reading') + flavorSignals(row));
  const cart = snapshot.candidates.find(entry => entry.id === picked);
  if(Number.isFinite(cart?.dockWidth)) words.unshift('Bay width — '+cart.dockWidth.toFixed(2)+' m');
  el('observed').textContent = words.length ? words.join(' · ') : 'The robot has no reading for this cart yet.';
}
function drawMap(snapshot) {
  const svg = el('room-map');
  const room = snapshot.room;
  const pad = 22, w=640, h=370;
  const scale = Math.min((w-2*pad)/room.width,(h-2*pad)/room.depth);
  const rw=room.width*scale,rh=room.depth*scale,x0=(w-rw)/2,z0=(h-rh)/2;
  const x = xm => x0 + xm*scale;
  const z = zm => z0 + zm*scale;
  const group = tagSVG('g',{'aria-hidden':'true'});
  group.append(tagSVG('rect',{x:x0,y:z0,width:rw,height:rh,rx:4,fill:'#173139',stroke:'#78939b','stroke-width':2}));
  const renderWall = box => {
    group.append(tagSVG('rect',{x:x(box.x),y:z(box.z),width:box.w*scale,height:box.d*scale,fill:box.kind==='unknown'?'#495d6b':'#536d74',stroke:'#90a6aa','stroke-width':1}));
  };
  for (const wall of room.walls) renderWall(wall);
  const sample = room.station;
  if(sample) {
    const station=tagSVG('g',{});
    station.append(tagSVG('title',{},sample.label || 'Sealed sample station'),
      tagSVG('rect',{x:x(sample.x)-8,y:z(sample.z)-8,width:16,height:16,rx:3,fill:'#263034',stroke:'#fbd486','stroke-width':3,'stroke-dasharray':'4 2'}));
    group.append(station);
  }
  const route = snapshot.done && run.outcome?.route;
  if (route?.length) group.append(tagSVG('polyline',{points:route.map(p=>x(p.x)+','+z(p.z)).join(' '),fill:'none',stroke:'#a7f9d7','stroke-width':4,'stroke-linecap':'round','stroke-linejoin':'round','stroke-dasharray':'7 4'}));
  const current=el('inspect-cart').value;
  const recent = stepIndex ? run.steps[stepIndex-1].action.candidateId : null;
  for (const [i,cart] of snapshot.candidates.entries()) {
    const px=x(cart.position.x),py=z(cart.position.z);
    const knownColor=snapshot.observations.findLast(row=>row.candidateId===cart.id && row.sense==='sight' && row.value!=null)?.value;
    const cartColor=Object.hasOwn(COLOR,knownColor)?COLOR[knownColor]:null;
    const station=tagSVG('g',{transform:'translate('+px+' '+py+')',class:'map-target','data-cart':cart.id});
    station.append(tagSVG('title',{},'Inspect '+cart.label));
    station.append(tagSVG('rect',{x:-22,y:-22,width:44,height:44,fill:'transparent'}));
    if(cart.id===current) station.append(tagSVG('circle',{r:20,fill:'none',stroke:'#fbd486','stroke-width':2}));
    if(cart.id===recent) station.append(tagSVG('circle',{r:23,fill:'none',stroke:'#92ddcd','stroke-dasharray':'4 3'}));
    for (const dx of [-10,7]) for (const dy of [-9,4]) station.append(tagSVG('rect',{x:dx,y:dy,width:4,height:6,rx:1,fill:'#e4ece9'}));
    station.append(tagSVG('rect',{x:-9,y:-9,width:18,height:18,rx:4,class:'cart-frame',fill:cartColor||'#385661',stroke:'#b5ced3','stroke-width':1.6}));
    station.append(tagSVG('text',{x:0,y:0,fill:cartColor?'#12272b':'white','font-size':12,'font-weight':750,'text-anchor':'middle','dominant-baseline':'central'},String.fromCharCode(65+i)));
    group.append(station);
  }
  const pos = route?.length ? route.at(-1) : room.start;
  group.append(tagSVG('circle',{cx:x(pos.x),cy:z(pos.z),r:8,fill:'#a5f5d8',stroke:'#102c27','stroke-width':3}),tagSVG('circle',{cx:x(pos.x),cy:z(pos.z),r:2,fill:'#24443d'}));
  svg.querySelector('g')?.remove();
  svg.append(group);
  el('map-description').textContent = room.name + '. ' + snapshot.candidates.map(cart=>cart.label).join(', ') + '. Inspect any cart with the selector below the map.' + (route?.length ? ' The path shows the robot’s simulated trip.' : '');
}
function render() {
  const snapshot=state();
  const current=stepIndex ? run.steps[stepIndex-1] : null;
  const done = stepIndex === run.steps.length;
  el('room-name').textContent=snapshot.room.name;
  el('robot-type').textContent=el('robot').selectedOptions[0].text;
  el('step').disabled=done;
  el('play').disabled=done;
  el('restart').disabled=stepIndex===0;
  el('keep-checking').hidden=!(done && run.canContinue);
  el('new-room').disabled=false;
  el('compare').disabled=!!benchmarkWorker;
  el('budget').textContent = snapshot.remaining + ' of ' + snapshot.budget + ' clue points left.';
  el('decision').textContent = current?.reason || 'Ready to compare the reference with the carts in this room.';
  el('score').hidden=!done;
  const outcome=run.outcome;
  if(done) {
    let result=VERDICTS[outcome.outcome] || capitalize(String(outcome.outcome).replaceAll('_',' '));
    if (run.canContinue) {
      result = 'The robot needs more clues to decide.';
    } else if (outcome.outcome==='correct_abstention') {
      result = outcome.confirmedAbsent ? 'The robot checked every cart. None fit the request.'
        : outcome.confirmedAmbiguous ? 'Two carts match every clue. The robot cannot pick just one.'
        : 'The robot still needs more clues to tell which cart fits.';
    }
    if(el('task').value==='delivery') result=result.replaceAll('cart','bay');
    const distance=Number.isFinite(outcome.routeMeters)&&outcome.route?.length ? ' Route length ' + outcome.routeMeters.toFixed(2) + ' m.' : '';
    el('score').textContent = result+distance;
    el('trial-status').textContent = result + (run.canContinue ? ' Choose Keep checking to stay in this room.' : '');
  } else if (current?.action.type === 'extend') {
    el('trial-status').textContent = 'You added ' + current.action.points + ' clue points. Choose Next step to see what the robot checks.';
  } else el('trial-status').textContent = current ? 'Step ' + stepIndex + ' · ' + actionText(current.action,snapshot) + ' ' + resultText(current) : 'Choose Next step to follow one decision, or Play trial to watch the whole search.';
  el('journal').replaceChildren(...run.steps.slice(0,stepIndex).map(step=>{
    const li=node('li');
    const result=resultText(step);
    li.append(node('strong', actionText(step.action,step.after)),node('span',' '+[result,step.reason].filter(Boolean).join(' ')));
    return li;
  }));
  el('empty-journal').hidden=!!stepIndex;
  readCart(snapshot);
  drawMap(snapshot);
}
function advance() {
  if (!run || stepIndex>=run.steps.length) {stop();return;}
  stepIndex++;
  const id=run.steps[stepIndex-1].action.candidateId;
  if (id) el('inspect-cart').value=id;
  if(stepIndex===run.steps.length) stop();
  render();
}
function loadRoom() {
  stop();
  run = runSenseTrial(settings());
  stepIndex=0;
  const delivery=el('task').value==='delivery';
  el('task-title').textContent=delivery?'Choose a delivery bay':'Find the matching cart';
  el('intro-copy').textContent=delivery?'Use the same robot to match a delivery’s clues and find a bay wide enough for it.':'Follow a robot into a new room. Watch it compare clues, ask for help, or stop when it can’t tell two carts apart.';
  el('map-object').textContent=delivery?'Bay':'Cart';
  el('ref-title').textContent=delivery?'Delivery request':'Cart to find';
  el('inspect-label').textContent=delivery?'Inspect a bay':'Inspect a cart';
  markReference(run.initial);
  el('inspect-cart').replaceChildren(...run.initial.candidates.map(cart=>{
    const option=node('option',cart.label);option.value=cart.id;return option;
  }));
  render();
}
function invalidateBenchmark() {
  compareSequence++;
  benchmarkWorker?.terminate(); benchmarkWorker=null;
  el('compare').disabled=false;
  el('compare-results').hidden=true;el('download').hidden=true;reportToSave=null;
  el('compare-status').textContent='';
}
function tableFor(rows, caption) {
  const wrap=node('div');
  wrap.className='comparison-wrap';wrap.tabIndex=0;
  wrap.setAttribute('role','region');wrap.setAttribute('aria-label',caption);
  const table=node('table'),head=node('thead'),titles=node('tr'),body=node('tbody');
  for (const title of ['Strategy','Correct decisions','Targets reached','Wrong choices','Avg. clue cost']) {
    const th=node('th',title);th.scope='col';titles.append(th);
  }
  head.append(titles);
  for (const result of rows) {
    const tr=node('tr'),label=node('th',STRATEGIES[result.strategy]);label.scope='row';tr.append(label);
    for(const value of [result.correctDecisions+' / '+result.trials,result.reached+' / '+result.presentCases,result.wrongChoices,result.meanCost.toFixed(1)]) tr.append(node('td',String(value)));
    body.append(tr);
  }
  table.append(node('caption',caption),head,body);wrap.append(table);
  return wrap;
}
function more(label,child) {const detail=node('details');detail.append(node('summary',label),child);return detail;}
function statsTable(report) {
  const host=el('compare-results');
  host.hidden=false;
  const list=node('ul');
  for (const result of report.rows) {
    list.append(node('li',STRATEGIES[result.strategy] + ' — ' + result.confirmedAbsent + ' verified missing, ' + result.confirmedAmbiguous + ' verified ambiguous, ' + result.uncertainAbstentions+' uncertain stops, '+ result.missedTargets + ' missed targets, ' + result.blocked + ' blocked trips, ' + result.queries + ' questions, ' + result.collisions + ' contacts, ' + result.keepOutCrossings + ' keep-out crossings.'));
  }
  host.replaceChildren(tableFor(report.rows,'Find the matching cart'),more('See the decisions and stops',list));
  if(report.visualControl) host.append(more('Try carts with clear visual clues',tableFor(report.visualControl.rows,'Separate easy-to-see rooms')));
  if(report.transfer) host.append(more('Try a different task',tableFor(report.transfer.rows,'Choose a delivery bay with the same learned memory')));
  if(report.ablations?.length) {
    const ul=node('ul');for(const row of report.ablations) ul.append(node('li',NAMES[row.disabled]+' removed — '+row.correctDecisions+' / '+row.trials+' correct decisions, average cost '+row.meanCost.toFixed(1)+'.'));
    host.append(more('What if one sense is missing?',ul));
  }
  if(report.robotComparison) host.append(more('Try another robot size',tableFor(report.robotComparison.rows,'Cart search with the '+report.robotComparison.robot)));
  reportToSave=report;el('download').hidden=false;
}
function compare() {
  invalidateBenchmark();
  const key=compareSequence;
  el('compare').disabled=true;
  el('compare-status').textContent='Running the same rooms with all three strategies…';
  const {enabledSenses,budget,robot}=settings();
  const fail=()=>{
    if(key!==compareSequence)return;
    benchmarkWorker?.terminate();benchmarkWorker=null;el('compare').disabled=false;
    el('compare-status').textContent='This comparison could not finish. Try again.';
  };
  try {
    benchmarkWorker=new Worker(new URL('./sense-trial-worker.mjs',import.meta.url),{type:'module'});
    benchmarkWorker.onmessage=event=>{
      if(key!==compareSequence)return;
      if(!event.data.ok){fail();return;}
      const {report}=event.data;
      statsTable(report);
      el('compare-status').textContent=report.rows[0].trials + ' unseen cases per strategy. Each got ' + budget + ' clue points per case, using the ' + el('robot').selectedOptions[0].text.toLowerCase() + '. The memory strategy learned which clues help from '+report.trainingCases+' separate practice cases.';
      benchmarkWorker.terminate();benchmarkWorker=null;el('compare').disabled=false;
    };
    benchmarkWorker.onerror=fail;
    benchmarkWorker.postMessage({enabledSenses,budget,robot});
  } catch {fail();}
}
function setup() {
  for (const sense of SENSES) {
    const label=node('label'),input=node('input');
    input.type='checkbox';input.value=sense;input.checked=true;
    label.append(input,document.createTextNode(NAMES[sense]));el('sense-choices').append(label);
  }
  el('step').onclick=()=>{stop();advance();};
  const followUp = el('keep-checking');
  followUp.textContent = 'Keep checking (+' + SENSE_EXTRA_POINTS + ' points)';
  followUp.onclick=()=>{
    if(stepIndex!==run.steps.length || !run.canContinue) return;
    stop();
    const previousEnd = stepIndex;
    run = continueSenseTrial(run);
    stepIndex = previousEnd + 1;
    render();
    el('step').focus();
  };
  el('play').onclick=()=>{
    if(timer){stop();return;}
    el('play').textContent='Pause';
    timer=setInterval(advance,1100);
    advance();
  };
  el('restart').onclick=loadRoom;
  el('new-room').onclick=()=>{seed++;loadRoom();};
  el('options').addEventListener('change',e=>{
    el('settings-note').textContent='Changing a setting restarts this room. Each clue uses part of the budget.';
    invalidateBenchmark();loadRoom();
  });
  el('inspect-cart').onchange=()=>{readCart(state());drawMap(state());};
  el('room-map').addEventListener('click',event=>{
    const cart=event.target.closest?.('[data-cart]');
    if(cart) {el('inspect-cart').value=cart.dataset.cart;readCart(state());drawMap(state());}
  });
  el('compare').onclick=compare;
  el('download').onclick=()=>{
    if(!reportToSave)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(reportToSave,null,2)],{type:'application/json'}));
    const a=node('a');a.href=url;a.download='brainsnn-five-senses-trial.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',()=>{stop();invalidateBenchmark();});
  loadRoom();
}
try {setup();} catch(error) {el('trial-status').textContent='The room could not open. Reload to try again.';console.error(error);}
