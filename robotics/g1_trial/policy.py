"""Integrity-pinned checkpoint pair and CPU forward qualification, not dynamics."""
from __future__ import annotations
import hashlib
import io
from pathlib import Path
import subprocess
import urllib.request
from .contracts import LOCK, REPO, REVISION, verify_locked, write_json


def download_pair(directory, licenses_reviewed=False):
    if licenses_reviewed is not True:
        raise ValueError('Review upstream MIT and third-party robot asset licenses first')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    receipt = {'schema':'brainsnn.g1-pair.v1','repository':REPO,'revision':REVISION,'files':[]}
    for relative, (size, _) in LOCK.items():
        url = f'https://raw.githubusercontent.com/{REPO}/{REVISION}/{relative}'
        with urllib.request.urlopen(url, timeout=45) as response:
            if response.geturl() != url:
                raise ValueError('Unexpected download redirect')
            data = response.read(size+1)
        p = directory/Path(relative).name
        with p.open('xb') as stream:
            stream.write(data)
        verify_locked(p, relative)
        receipt['files'].append({'name':p.name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
    write_json(directory/'pair.json',receipt)
    return receipt


def verify_source(directory):
    root = Path(directory).resolve()
    def git(*args):
        return subprocess.check_output(['git','-C',str(root),*args], text=True, timeout=15).strip()
    if git('rev-parse','HEAD') != REVISION or git('status','--porcelain','--untracked-files=normal'):
        raise ValueError('Upstream checkout must be clean at the pinned revision')
    for key in LOCK:
        verify_locked(root/key,key)
    return root


def forward_pair(directory, state, previous_action, scan):
    """Run the actual pair on explicitly supplied data. Does not step physics."""
    import torch
    from rsl_rl.modules import ActorCritic
    from tensordict import TensorDict
    from robotics.world_worker.foothold_perception import sample_patches
    from .contracts import vector
    state = vector(state,70,10000); previous_action = vector(previous_action,29,10)
    directory = Path(directory)
    predictor_bytes = verify_locked(directory/'foot_model_10002.pt','demo/foot_model_10002.pt')
    actor_bytes = verify_locked(directory/'model_10000.pt','demo/model_10000.pt')
    verify_locked(directory/'LICENSE','LICENSE')
    predictor = torch.jit.load(io.BytesIO(predictor_bytes),map_location='cpu').eval()
    with torch.inference_mode():
        feet = predictor(torch.tensor([state],dtype=torch.float32)).reshape(2,2).tolist()
    patch = sample_patches(scan,feet)
    if not patch['sample_complete']:
        return {'status':'abstained','policy_forward_executed':False,'prediction_executed':True,
                'physics_executed':False,'robot_control_enabled':False,'patch':patch}
    s = torch.tensor([state],dtype=torch.float32)
    actor_obs = torch.cat([s[:,:3],.2*s[:,3:6],s[:,6:41],.05*s[:,41:70],
                          torch.tensor([previous_action]),torch.tensor([patch['observation_raw']]).clamp(-1,1)],dim=1)
    critic_obs = torch.cat([actor_obs[:,:99],torch.tensor([scan]).clamp(-1,1),actor_obs[:,99:]],dim=1)
    obs = TensorDict({'policy':actor_obs,'critic':critic_obs},batch_size=[1])
    actor = ActorCritic(obs,{'policy':['policy'],'critic':['critic']},29,
                       actor_hidden_dims=[512,256,128],critic_hidden_dims=[512,256,128],activation='elu')
    # Verification precedes loading; only tensors/basic containers are accepted.
    weights = torch.load(io.BytesIO(actor_bytes),map_location='cpu',weights_only=True)
    actor.load_state_dict(weights['model_state_dict'],strict=True); actor.eval()
    with torch.inference_mode():
        actions = actor.act_inference(obs)
    if tuple(actions.shape) != (1,29) or not torch.isfinite(actions).all():
        raise ValueError('Invalid matched-policy output')
    return {'status':'forward_passed','prediction_executed':True,'policy_forward_executed':True,
            'physics_executed':False,'robot_control_enabled':False,'input_basis':'caller-supplied-state-and-height-scan',
            'observation_shape':list(actor_obs.shape),'action_shape':list(actions.shape),
            'footholds_base_xy_m':feet,'actions':actions[0].tolist(),
            'policy_sha256':hashlib.sha256(actor_bytes).hexdigest(),
            'predictor_sha256':hashlib.sha256(predictor_bytes).hexdigest(),'upstream_revision':REVISION}
