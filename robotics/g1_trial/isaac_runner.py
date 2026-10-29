"""Run one bounded G1 episode on prepared static geometry, never on a robot.

Must be launched in the pinned Isaac Lab environment by runtime.run. No training,
automatic episode resets, robot networking, asset substitution or infinite floor.
"""
from __future__ import annotations
import argparse
from functools import wraps
import json
import math
from pathlib import Path
import sys
import time


def main():
    from .contracts import REVISION, outcome, sha256, write_json, y_to_z
    from .policy import verify_source
    from .prepare import verify_prepared
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--upstream',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--video',action='store_true')
    from isaaclab.app import AppLauncher
    AppLauncher.add_app_launcher_args(parser)
    args = parser.parse_args()
    spec, prepared = verify_prepared(args.bundle)
    upstream = verify_source(args.upstream)
    if args.out.resolve().is_relative_to(args.bundle.resolve()) or args.out.resolve().is_relative_to(upstream):
        raise ValueError('Results cannot modify source data')
    if (args.out/'result.json').exists():
        raise ValueError('Refusing a stale result')
    args.enable_cameras = args.video
    simulation_app = AppLauncher(args).app
    env = None; u = None; start_counter = 0
    result = {'schema':'brainsnn.g1-result.v1','status':'failed','stop_reason':'initialization',
              'upstream_revision':REVISION,'terrain_sha256':sha256(args.bundle/'terrain.usda'),
              'scenario_sha256':sha256(args.bundle/'scenario.json'),'source_kind':spec['source_kind'],
              'physics_executed':False,'policy_forward_steps':0,'physics_step_calls':0,'goal_reached':False,
              'physical_accuracy_verified':False,'robot_control_enabled':False,'automatic_resets_enabled':False}
    try:
        import gymnasium as gym
        import torch
        from rsl_rl.runners import OnPolicyRunner
        from isaaclab_rl.rsl_rl import RslRlVecEnvWrapper
        from isaaclab.envs import ManagerBasedRLEnv
        import isaaclab.sim as sim_utils
        from isaaclab.utils.math import quat_apply, quat_apply_inverse
        sys.path.insert(0,str(upstream))
        import fpm
        if Path(fpm.__file__).resolve().parent != upstream/'fpm':
            raise ValueError('Unexpected imported FPM package')
        from fpm.env_cfg import FpmEnvCfg_PLAY
        from fpm.agents.rsl_rl_ppo_cfg import FpmPPORunnerCfg
        from fpm.mdp.observations import foothold_scan
        cfg = FpmEnvCfg_PLAY(); cfg.seed = 1
        cfg.scene.num_envs = 1; cfg.scene.env_spacing = 2.
        cfg.scene.terrain.terrain_type = 'usd'
        cfg.scene.terrain.usd_path = str((args.bundle/'terrain.usda').resolve())
        cfg.scene.terrain.terrain_generator = None
        cfg.scene.terrain.env_spacing = 2.
        cfg.scene.terrain.max_init_terrain_level = None
        cfg.scene.height_scanner.mesh_prim_paths = [cfg.scene.terrain.prim_path+'/terrain/Mesh']
        cfg.curriculum.terrain_levels = None; cfg.curriculum.gravity_offset_level = None
        reset_base, reset_joints = cfg.events.reset_base, cfg.events.reset_robot_joints
        for key in vars(cfg.events):
            if not key.startswith('_'):
                setattr(cfg.events,key,None)
        reset_base.params['pose_range'] = {k:(0.,0.) for k in ('x','y','z','roll','pitch','yaw')}
        reset_base.params['velocity_range'] = {k:(0.,0.) for k in ('x','y','z','roll','pitch','yaw')}
        reset_joints.params.update(position_range=(1.,1.),velocity_range=(0.,0.))
        cfg.events.reset_base, cfg.events.reset_robot_joints = reset_base, reset_joints
        cfg.terminations.time_out = None; cfg.terminations.bad_orientation = None; cfg.terminations.nan_state = None
        cfg.episode_length_s = spec['duration_s']+1
        start = y_to_z(spec['start_ground_y_up_m']); nominal_height = cfg.scene.robot.init_state.pos[2]
        cfg.scene.robot.init_state.pos = (start[0],start[1],start[2]+nominal_height)
        cfg.scene.robot.init_state.rot = (math.cos(spec['yaw_rad']/2),0,0,math.sin(spec['yaw_rad']/2))
        cmd = cfg.commands.base_velocity
        cmd.rel_standing_envs = 0.; cmd.rel_turning_envs = 0.; cmd.rel_heading_envs = 0.; cmd.heading_command = False
        cmd.resampling_time_range = (1e9,1e9)
        cmd.ranges.lin_vel_x = (spec['speed_m_s'],spec['speed_m_s'])
        cmd.ranges.lin_vel_y = (0.,0.); cmd.ranges.ang_vel_z = (0.,0.)
        cfg.scene.terrain.physics_material = sim_utils.RigidBodyMaterialCfg(
            static_friction=spec['friction']['static'],dynamic_friction=spec['friction']['dynamic'],restitution=0.)
        cfg.sim.physics_material = cfg.scene.terrain.physics_material
        cfg.sim.device = 'cuda:0'
        cfg.log_dir = str(upstream/'demo'); cfg.load_run_dir = str(upstream/'demo')
        if sorted(p.name for p in (upstream/'demo').glob('foot_model_*.pt')) != ['foot_model_10002.pt']:
            raise ValueError('Ambiguous matched predictor directory')
        diagnostics = {'samples':0,'all_samples_finite':True}

        @wraps(foothold_scan)
        def guarded_scan(environment, **kwargs):
            """Keep exact upstream arithmetic; reject the samples it would otherwise fill/clamp."""
            observed = foothold_scan(environment,**kwargs)
            robot = environment.scene['robot']; sensor = environment.scene['height_scanner']
            feet = torch.stack([observed[:,0:2],observed[:,51:53]],dim=1)
            feet3 = torch.cat([feet,torch.zeros_like(feet[:,:,:1])],dim=-1)
            world = robot.data.root_pos_w[:,None,:]+quat_apply(robot.data.root_quat_w[:,None,:].expand(-1,2,-1),feet3)
            local = quat_apply_inverse(sensor.data.quat_w[:,None,:].expand(-1,2,-1),world-sensor.data.pos_w[:,None,:])
            anchors = torch.round((local[:,:,:2]+torch.tensor([.8,.5],device=environment.device))/.05).long()
            ox,oy = torch.meshgrid(torch.arange(-3,4,device=environment.device),torch.arange(-3,4,device=environment.device),indexing='ij')
            ix = anchors[:,:,0,None]+ox.flatten(); iy = anchors[:,:,1,None]+oy.flatten()
            if ((ix<0)|(ix>=33)|(iy<0)|(iy>=21)).any():
                raise ValueError('Predicted foot patch leaves scanner grid')
            hits = sensor.data.ray_hits_w
            if hits.shape != (1,693,3) or not torch.isfinite(observed).all():
                raise ValueError('Unexpected scanner layout or observation')
            picked = hits[0,(iy*33+ix).reshape(-1)]
            if not torch.isfinite(picked).all():
                diagnostics['all_samples_finite'] = False
                raise ValueError('Required terrain ray missed: no fabricated ground')
            diagnostics['samples'] += 1
            return observed

        for group in (cfg.observations.policy,cfg.observations.critic):
            group.enable_corruption = False
            group.foothold_scan.func = guarded_scan
            group.foothold_scan.params.update(train_fpm=False,force_model=True,xy_drift_range=(0.,0.),z_drift_range=(0.,0.))
        raw = ManagerBasedRLEnv(cfg=cfg,render_mode='rgb_array' if args.video else None)
        u = raw
        if args.video:
            raw = gym.wrappers.RecordVideo(raw,video_folder=str(args.out/'video'),step_trigger=lambda step: step==0,
                                         video_length=math.ceil(spec['duration_s']/u.step_dt),disable_logger=True)
        env = RslRlVecEnvWrapper(raw,clip_actions=10.)
        agent = FpmPPORunnerCfg(); agent.device='cuda:0'
        runner = OnPolicyRunner(env,agent.to_dict(),log_dir=None,device='cuda:0')
        runner.load(str(upstream/'demo/model_10000.pt'),load_optimizer=False)
        policy = runner.get_inference_policy(device='cuda:0')
        result['joint_names'] = list(u.scene['robot'].joint_names)
        if len(result['joint_names']) != 29:
            raise ValueError('Robot joint layout changed')
        obs = env.get_observations()
        if obs['policy'].shape != (1,201) or obs['system_state'].shape != (1,70):
            raise ValueError('Matched policy observation dimensions changed')
        start_counter = u._sim_step_counter
        max_steps = math.ceil(spec['duration_s']/u.step_dt)
        result.update(status='in_progress',stop_reason='time_limit',step_dt=float(u.step_dt),max_steps=max_steps)
        foot_ids = [i for i,n in enumerate(u.scene['contact_forces'].body_names) if 'ankle' in n]
        other_ids = [i for i in range(len(u.scene['contact_forces'].body_names)) if i not in foot_ids]
        if not foot_ids:
            raise ValueError('Foot-contact identities unavailable')
        with (args.out/'trace.jsonl').open('x') as trace:
            for step in range(max_steps):
                if not simulation_app.is_running():
                    result['stop_reason']='application_closed';break
                robot = u.scene['robot']
                if not all(torch.isfinite(x).all() for x in (robot.data.root_state_w,robot.data.joint_pos,robot.data.joint_vel,obs['policy'])):
                    result['stop_reason']='nonfinite_state';break
                with torch.inference_mode():
                    actions = policy(obs)
                    if actions.shape != (1,29) or not torch.isfinite(actions).all():
                        raise ValueError('Policy returned invalid actions')
                    result['policy_forward_steps'] += 1
                    obs, _, dones, _ = env.step(actions)
                result['physics_step_calls'] += 1
                if not all(torch.isfinite(x).all() for x in (robot.data.root_state_w,robot.data.projected_gravity_b,u.scene['contact_forces'].data.net_forces_w)):
                    raise ValueError('Nonfinite post-step state or contact evidence')
                pos = robot.data.root_pos_w[0].tolist(); p_y = [pos[0],pos[2],-pos[1]]
                gravity_z = float(robot.data.projected_gravity_b[0,2])
                tilt = math.acos(max(-1.,min(1.,-gravity_z)))
                forces = u.scene['contact_forces'].data.net_forces_w[0]
                bad_contact = bool((torch.linalg.vector_norm(forces[other_ids],dim=-1)>10).any())
                trace.write(json.dumps({'step':step+1,'time_s':(step+1)*u.step_dt,'base_y_up_m':p_y,
                    'base_quaternion_wxyz':robot.data.root_quat_w[0].tolist(),'tilt_rad':tilt,
                    'undesired_contact':bad_contact,'action':actions[0].tolist(),
                    'foothold_observation':obs['policy'][0,-102:].tolist()},allow_nan=False)+'\n');trace.flush()
                stop = outcome(p_y,tilt,bad_contact,spec)
                if dones.any():
                    stop='unexpected_reset_or_termination'
                if stop:
                    result['stop_reason']=stop;break
        result.update(status='completed',goal_reached=result['stop_reason']=='goal_reached',terrain_guard=diagnostics)
    except Exception as error:
        result.update(status='failed',error_type=type(error).__name__,error=str(error)[:500])
        raise
    finally:
        if u is not None:
            result['physics_substeps_observed']=max(0,int(u._sim_step_counter)-start_counter)
            result['physics_executed']=result['physics_substeps_observed']>0
        if (args.out/'trace.jsonl').exists():
            result['trace_sha256']=sha256(args.out/'trace.jsonl')
        write_json(args.out/'result.json',result)
        if env is not None:
            env.close()
        elif u is not None:
            u.close()
        simulation_app.close()


if __name__ == '__main__':
    main()
