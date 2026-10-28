"""Qualify actual checkpoint-pair inference and USD preparation, NOT locomotion."""
from pathlib import Path
import json
import sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from robotics.g1_trial.contracts import write_json
from robotics.g1_trial.policy import download_pair,forward_pair
from robotics.g1_trial.prepare import prepare
from robotics.g1_trial.runtime import preflight
from tests.g1_trial.test_prepare import fixture

out=ROOT/'qualification/g1-trial';out.mkdir(parents=True,exist_ok=False)
pack,spec=fixture(out)
prepared=prepare(pack,spec,out/'prepared')
models=out/'models';download_pair(models,licenses_reviewed=True)
state=[0.]*70;state[8]=-1.;state[9]=.3
result=forward_pair(models,state,[0.]*29,[.22]*693)
assert result['policy_forward_executed'] and result['action_shape']==[1,29]
assert not result['physics_executed'] and not result['robot_control_enabled']
write_json(out/'paired-policy-forward.json',result)
missing=forward_pair(models,state,[0.]*29,[None]*693)
assert missing['status']=='abstained' and not missing['policy_forward_executed']
write_json(out/'missing-terrain.json',missing)
write_json(out/'preflight.json',preflight())
write_json(out/'qualification.json',{'status':'cpu-contracts-passed',
    'actual_pretrained_pair_forward_executed':True,'usd_preparation_and_reopen_executed':True,
    'source':'explicitly synthetic 6 x 4 metre floor plus 8 cm threshold',
    'physics_executed':False,'goal_reached':False,'real_capture_used':False,
    'physical_accuracy_verified':False,'robot_control_enabled':False})
print('G1_CPU_CONTRACTS_PASSED: dynamics not executed')
