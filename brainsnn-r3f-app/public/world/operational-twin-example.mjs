/** Authored software fixture. No crane scan, manufacturer manual or measured motion. */
import {createTwin,makeDocument,validateTwin} from './operational-twin.mjs';
export async function trainingCraneTwin(scene,sceneSha){
  const twin=createTwin(scene,sceneSha),byName=Object.fromEntries(scene.objects.map(p=>[p.name,p.componentId])),asset=name=>twin.assets.find(a=>a.componentId===byName[name]);
  const manual=await makeDocument({id:'training-notes-v1',title:'Authored training crane notes',revision:'Fixture revision 1',body:[
    'SOFTWARE TRAINING FIXTURE ONLY. This is not a real crane or an approved maintenance manual.',
    'Slew bearing inspection: the authored example asks a reviewer to inspect the bearing label and its linked source revision. No service interval is specified.',
    'Slew bearing spare: TRAIN-BRG-01, one demonstration bearing. This is an invented training part number, not an orderable manufacturer part.',
    'Trolley: translates along the authored boom X axis. Limits are entered for visualization, not measured mechanical stops.',
    'Hoist block: translates along the authored Y axis. The training load follows the block through the assembly hierarchy.',
    'Motion: slew, trolley and hoist controls are kinematic previews. No motors, mass, inertia, load rating or contact simulation are included.',
    'Maintenance: consult an actual approved machine manual and a qualified owner. This fixture supplies no operating or repair procedure.',
    'Issue log: the example observation is synthetic test data. Its resolution checkbox records a user action, not physical verification.',
  ].join('\n'),sourceUrl:''});
  twin.documents.push(manual);
  for(const a of twin.assets){a.assetCode=partsCode(a.componentId);a.location='Authored training bay';a.documentIds=[manual.id];}
  function partsCode(id){const name=Object.keys(byName).find(n=>byName[n]===id);return 'TRAIN-'+name.toUpperCase();}
  for(const [child,parent] of [['slew','gantry'],['boom','slew'],['counterweight','slew'],['trolley','boom'],['hoist','trolley'],['load','hoist']])asset(child).parentComponentId=byName[parent];
  asset('slew').spares=[{partNumber:'TRAIN-BRG-01',description:'Invented training bearing, not orderable',quantity:1,documentId:manual.id,locator:'line 3'}];
  asset('hoist').dependsOn=[byName.trolley];asset('trolley').dependsOn=[byName.slew];
  twin.issues=[{id:'training-observation-1',componentId:byName.hoist,symptom:'Synthetic training observation: unusual hoist noise',status:'open',documentId:manual.id,locator:'line 8',note:'Example data only. No physical fault has been detected or diagnosed.'}];
  twin.joints=[
    {id:'training-slew',componentId:byName.slew,type:'revolute',axis:[0,1,0],originMeters:[0,3.35,0],min:-110,max:110,home:0,unit:'degrees',authorship:'operator-authored'},
    {id:'training-trolley',componentId:byName.trolley,type:'prismatic',axis:[1,0,0],originMeters:[3.3,3.45,0],min:-2.5,max:1.5,home:0,unit:'m',authorship:'operator-authored'},
    {id:'training-hoist',componentId:byName.hoist,type:'prismatic',axis:[0,1,0],originMeters:[3.3,2.5,0],min:-.9,max:.1,home:0,unit:'m',authorship:'operator-authored'},
  ];
  return validateTwin(twin,scene,sceneSha);
}
