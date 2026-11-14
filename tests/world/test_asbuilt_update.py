import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import pytest
import ifcopenshell
import ifcopenshell.util.element
import ifcopenshell.util.unit
from asbuilt_fixture import files,scenario
from robotics.scene_compiler import component_graph as cg
from robotics.scene_compiler.asbuilt_update import ifc_inventory,compare,update_ifc

@pytest.fixture
def case():
    f=files();prior=f['asbuilt-prior.ifc'];scene=f['asbuilt-current.scene.json'];inventory=ifc_inventory(prior)
    pairs=[{'priorGlobalId':e['globalId'],'currentComponentId':e['componentId'],'reviewed':True} for e in inventory['elements']]
    chair=next(e for e in inventory['elements'] if e['name']=='chair')
    request={'schema':'brainsnn.asbuilt-review.v1','source':{'priorIfcSha256':hashlib.sha256(prior).hexdigest(),'currentSceneSha256':hashlib.sha256(scene).hexdigest(),'componentRevision':0},
      'registration':{'method':'operator-reviewed-same-frame','translationMeters':[0,0,0],'yawDegrees':0,'reviewed':True,'note':'Authored fixture frame, not a measured registration.'},
      'toleranceMeters':.05,'maxTranslationMeters':2,'maxExtentDifferenceMeters':.05,'pairs':pairs,'selectedTranslations':[chair['globalId']],
      'brief':{'targets':'Reviewed furniture placement','intendedUse':'Coordination draft','accuracyTargetMeters':.05,'detail':'observed-component-proxies'},'metricVerified':False,'physicalRobotValidated':False}
    return prior,scene,request

def test_real_ifc_update_moves_only_approved_item_and_retains_guid_properties_and_geometry(case):
    prior,scene,request=case;source=bytes(prior);before={p['globalId']:p for p in ifc_inventory(prior)['elements']}
    output,report=update_ifc(prior,scene,request);after={p['globalId']:p for p in ifc_inventory(output)['elements']}
    assert source==prior and report['updatedCount']==1
    for guid,old in before.items():
        expected=[.7,0,0] if guid in request['selectedTranslations'] else [0,0,0]
        assert np.allclose(np.subtract(after[guid]['min'],old['min']),expected,atol=1e-6)
        assert np.allclose(np.subtract(after[guid]['max'],old['max']),expected,atol=1e-6)
        assert after[guid]['componentId']==old['componentId']
    model=ifcopenshell.file.from_string(output.decode());element=model.by_guid(request['selectedTranslations'][0])
    props=ifcopenshell.util.element.get_psets(element)
    assert props['Pset_BrainSNN_AsBuiltReview']['CaptureSceneSha256']==hashlib.sha256(scene).hexdigest()
    assert props['Pset_BrainSNN_AsBuiltReview']['MetricVerified'] is False
    assert props['Pset_BrainSNN']['ComponentId']==before[element.GlobalId]['componentId']
    assert report['metricVerified'] is report['physicalRobotValidated'] is False

def test_bad_prior_bounds_are_flagged_instead_of_propagated(case):
    prior,scene,request=case;report=compare(prior,scene,request)
    cabinet=next(row for row in report['rows'] if row['priorName']=='cabinet')
    assert cabinet['extentDifferenceMeters']==pytest.approx(.6) and not cabinet['eligible']
    request['selectedTranslations']=[cabinet['priorGlobalId']]
    with pytest.raises(ValueError,match='selected translation'):update_ifc(prior,scene,request)

@pytest.mark.parametrize('patch',[lambda r:r['source'].update(currentSceneSha256='0'*64),lambda r:r['source'].update(priorIfcSha256='0'*64),lambda r:r['source'].update(componentRevision=9),lambda r:r.update(metricVerified=True),lambda r:r['registration'].update(reviewed=False),lambda r:r['registration'].update(note=''),lambda r:r['registration'].update(translationMeters=[float('nan'),0,0]),lambda r:r.update(maxTranslationMeters=5),lambda r:r.update(selectedTranslations=[]),lambda r:r['pairs'].append(r['pairs'][0]),lambda r:r['brief'].update(detail='certified-LOD-300')])
def test_stale_unreviewed_nonfinite_and_unsupported_requests_fail(case,patch):
    prior,scene,r=case;patch(r)
    with pytest.raises((ValueError,TypeError)):update_ifc(prior,scene,r)

def test_metric_units_are_converted_not_assumed(case):
    prior,scene,r=case;model=ifcopenshell.file.from_string(prior.decode())
    model=ifcopenshell.util.unit.convert_file_length_units(model,target_units='MILLIMETRE')
    raw=model.to_string().encode();r['source']['priorIfcSha256']=hashlib.sha256(raw).hexdigest()
    assert ifc_inventory(raw)['nativeLengthScale']==.001
    output,report=update_ifc(raw,scene,r)
    chair=next(e for e in ifc_inventory(output)['elements'] if e['name']=='chair')
    assert (np.array(chair['min'])+chair['max'])[0]/2==pytest.approx(1,abs=1e-6)
    assert report['updatedCount']==1

def test_missing_ifc_units_are_refused(case):
    raw,_,_=case;model=ifcopenshell.file.from_string(raw.decode());model.by_type('IfcProject')[0].UnitsInContext=None
    with pytest.raises(ValueError,match='explicit units'):ifc_inventory(model.to_string().encode())

def test_nonzero_rigid_registration_preserves_original_ifc_frame(case):
    prior,scene_raw,r=case;scene=json.loads(scene_raw);a=np.deg2rad(30);rotation=np.array([[np.cos(a),0,-np.sin(a)],[0,1,0],[np.sin(a),0,np.cos(a)]]);t=np.array([7,1.2,-3])
    original_current={item['name']:copy.deepcopy(item) for item in scene['objects']+scene['walls']}
    scene.pop('componentGraph');scene.pop('cloudPointsSha256')
    for item in scene['objects']+scene['walls']:
        item.pop('componentId');item['centre']=(rotation@item['centre']+t).tolist();item['yaw_degrees']+=30;item.pop('min',None);item.pop('max',None)
    scene=cg.attach_component_ids(scene);scene_raw=(json.dumps(scene)+'\n').encode();r['source']['currentSceneSha256']=hashlib.sha256(scene_raw).hexdigest()
    new_by_name={item['name']:item for item in scene['objects']+scene['walls']}
    prior_by_guid={p['globalId']:p for p in ifc_inventory(prior)['elements']}
    old_by_id={item['componentId']:item for item in original_current.values()}
    for pair in r['pairs']:
        name=old_by_id[pair['currentComponentId']]['name'];pair['currentComponentId']=new_by_name[name]['componentId']
    r['registration']={'method':'operator-entered-rigid','translationMeters':t.tolist(),'yawDegrees':30,'reviewed':True,'note':'Authored rigid frame change, no scale fitting.'}
    output,report=update_ifc(prior,scene_raw,r)
    chair=next(e for e in ifc_inventory(output)['elements'] if e['name']=='chair')
    assert np.allclose((np.array(chair['min'])+chair['max'])/2,[1,.45,1],atol=1e-6)
    assert report['updatedCount']==1

def test_nonzero_parent_placement_is_handled_in_world_si_units(case):
    prior,scene,r=case;model=ifcopenshell.file.from_string(prior.decode());storey=model.by_type('IfcBuildingStorey')[0]
    storey.ObjectPlacement.RelativePlacement=model.create_entity('IfcAxis2Placement3D',Location=model.create_entity('IfcCartesianPoint',Coordinates=(12.,-3.,.5)))
    raw=model.to_string().encode();r['source']['priorIfcSha256']=hashlib.sha256(raw).hexdigest()
    r['registration']={'method':'operator-entered-rigid','translationMeters':[-12,-.5,-3],'yawDegrees':0,'reviewed':True,'note':'Authored parent offset, not a physical registration.'}
    output,_report=update_ifc(raw,scene,r);chair=next(e for e in ifc_inventory(output)['elements'] if e['name']=='chair')
    assert np.allclose((np.array(chair['min'])+chair['max'])/2,[13,.95,4],atol=1e-6)

def test_connected_element_update_is_refused(case):
    prior,scene,r=case;model=ifcopenshell.file.from_string(prior.decode());chair=model.by_guid(r['selectedTranslations'][0]);table=next(e for e in model.by_type('IfcFurniture') if e.Name=='table')
    model.create_entity('IfcRelConnectsElements',GlobalId=ifcopenshell.guid.new(),RelatingElement=chair,RelatedElement=table)
    raw=model.to_string().encode();r['source']['priorIfcSha256']=hashlib.sha256(raw).hexdigest()
    with pytest.raises(ValueError,match='connected elements'):update_ifc(raw,scene,r)

@pytest.mark.parametrize('relationship',['IfcRelNests','IfcRelAggregates'])
def test_assembly_child_cannot_move_independently_even_with_its_own_placement(case,relationship):
    prior,scene,r=case;model=ifcopenshell.file.from_string(prior.decode())
    chair=model.by_guid(r['selectedTranslations'][0])
    parent=model.create_entity('IfcElementAssembly',GlobalId=ifcopenshell.guid.new(),Name='Authored assembly')
    model.create_entity(relationship,GlobalId=ifcopenshell.guid.new(),RelatingObject=parent,RelatedObjects=[chair])
    raw=model.to_string().encode();r['source']['priorIfcSha256']=hashlib.sha256(raw).hexdigest()
    with pytest.raises(ValueError,match='nested or connected elements'):update_ifc(raw,scene,r)

def test_cli_writes_fresh_readback_checked_bundle_and_never_overwrites_sources(case,tmp_path):
    prior,scene,r=case
    for name,raw in [('prior.ifc',prior),('scene.json',scene),('review.json',json.dumps(r).encode())]:(tmp_path/name).write_bytes(raw)
    out=tmp_path/'new-bim';command=[sys.executable,'-m','robotics.scene_compiler.asbuilt_update','apply','--ifc',str(tmp_path/'prior.ifc'),'--scene',str(tmp_path/'scene.json'),'--review',str(tmp_path/'review.json'),'--output-dir',str(out)]
    result=subprocess.run(command,capture_output=True,text=True);assert result.returncode==0,result.stderr
    assert (tmp_path/'prior.ifc').read_bytes()==prior
    assert len(ifcopenshell.open(out/'updated.ifc').by_type('IfcElement'))==6
    first=(out/'updated.ifc').read_bytes();again=subprocess.run(command,capture_output=True,text=True)
    assert again.returncode!=0 and (out/'updated.ifc').read_bytes()==first
