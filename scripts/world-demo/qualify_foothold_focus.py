"""Actual pinned CPU FPM inference, synthetic states/terrain, no locomotion."""
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from robotics.world_worker import fpm_bridge as fpm
from robotics.world_worker.foothold_perception import sample_patches,scan_anchor
from tests.world.test_foothold_focus import cloud_fixture,query

out=ROOT/'qualification/footholds';out.mkdir(parents=True,exist_ok=True)
models=out/'model'
if not models.exists():fpm.download(models,license_reviewed=True)
state=[0.]*70;state[8]=-1.
payload={'layout':fpm.LAYOUT,'joint_order_reviewed':True,'states':[state]}
(out/'synthetic-state.json').write_text(json.dumps(payload,indent=2)+'\n')
q=query();(out/'query.json').write_text(json.dumps(q,indent=2)+'\n')
cloud=cloud_fixture();(out/'synthetic-cloud.json').write_text(json.dumps(cloud)+'\n')
pred=fpm.predict(models,payload)
assert pred['prediction_executed'] and len(pred['footholds_base_xy_m'][0])==2
report=fpm.observe(models,payload,cloud,q)
assert report['foothold_basis']=='pinned-pretrained-fpm'
assert not report['robot_control_enabled'] and not report['checkpoint_compatible']
(out/'real-model-synthetic-terrain.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
# Independent torch reference of the upstream noiseless gather on in-bounds cells.
import torch
scan=torch.arange(693,dtype=torch.float32).reshape(1,-1)/1000
feet=torch.tensor([[[0.,.1],[.1,-.1]]],dtype=torch.float32)
ox,oy=torch.meshgrid(torch.arange(-3,4),torch.arange(-3,4),indexing='ij');parts=[]
for i in range(2):
    ax=torch.round((feet[:,i,0]+.8)/.05).long();ay=torch.round((feet[:,i,1]+.5)/.05).long()
    ix=torch.clamp(ax[:,None]+ox.flatten(),0,32);iy=torch.clamp(ay[:,None]+oy.flatten(),0,20)
    parts.append(torch.cat([feet[:,i],torch.gather(scan,1,iy*33+ix)],dim=1))
expected=torch.cat(parts,dim=1)[0]
actual=sample_patches(scan[0].tolist(),feet[0].tolist())['observation_raw']
error=float((expected-torch.tensor(actual)).abs().max());assert error<1e-6,error
for origin in (-.8,-.5):
    for i in range(-40,41):
        value=i*.025
        expected_anchor=int(torch.round((torch.tensor(value,dtype=torch.float32)-origin)/.05))
        assert scan_anchor(value,origin)==expected_anchor,(value,origin)
receipt={'status':'passed','source_revision':fpm.REVISION,'model_sha256':pred['model_sha256'],
         'actual_pretrained_predictor_executed':True,'inputs':'one explicitly synthetic upright G1 state',
         'prediction_values':pred['footholds_base_xy_m'],'height_observation_length':102,
         'torch_reference_max_abs_error':error,'terrain_observation_complete':report['sample_complete'],
         'physics_executed':False,'locomotion_policy_executed':False,'hardware_tested':False}
(out/'qualification.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
