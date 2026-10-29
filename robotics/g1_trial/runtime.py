"""GPU admission, bounded process supervision and truthful terminal receipts."""
from __future__ import annotations
import importlib.metadata as metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
from .contracts import read_json, sha256, write_json


def preflight():
    blockers = []; versions = {}
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64','AMD64'):
        blockers.append('Matched stack is restricted to a Linux x86-64 GPU host')
    # The Isaac Lab v2.3.0 release installs extension package isaaclab==0.47.2.
    for package, expected in [('isaaclab','0.47.2'),('rsl-rl-lib','3.3.0')]:
        try:
            value = metadata.version(package); versions[package] = value
            if value.split('+')[0] != expected:
                blockers.append(package+' must be '+expected)
        except metadata.PackageNotFoundError:
            blockers.append(package+' is not installed')
    try:
        value = metadata.version('isaacsim'); versions['isaacsim'] = value
        if not value.startswith('5.1.'):
            blockers.append('Isaac Sim must be from the upstream 5.1 release line')
    except metadata.PackageNotFoundError:
        blockers.append('Isaac Sim 5.1 package metadata unavailable in this interpreter')
    gpu = None
    try:
        lines = subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.free,utilization.gpu',
                '--format=csv,noheader,nounits'],text=True,timeout=10).strip().splitlines()
        if len(lines) != 1:
            blockers.append('This first runner requires one explicitly isolated visible GPU')
        else:
            name, free, util = [s.strip() for s in lines[0].split(',')]
            gpu = {'name':name,'free_mib':int(free),'utilization_percent':int(util)}
            if int(free) < 12000 or int(util) > 20:
                blockers.append('GPU does not meet conservative free-memory/idle admission; no other workloads will be stopped')
    except (OSError,subprocess.SubprocessError,ValueError):
        blockers.append('A queryable NVIDIA GPU is not available')
    return {'schema':'brainsnn.g1-preflight.v1','status':'blocked' if blockers else 'admitted',
            'blockers':blockers,'versions':versions,'gpu':gpu,'physics_executed':False,'robot_control_enabled':False}


def run(bundle, upstream, out, video=False, wall_seconds=600):
    from .prepare import verify_prepared
    from .policy import verify_source
    root, source, output = Path(bundle).resolve(), Path(upstream).resolve(), Path(out).resolve()
    if output.is_relative_to(root) or output.is_relative_to(source):
        raise ValueError('Write results outside both source directories')
    if type(wall_seconds) is not int or not 30 <= wall_seconds <= 900:
        raise ValueError('Wall-clock limit must be 30–900 seconds')
    output.mkdir(parents=True,exist_ok=False)
    report = {'schema':'brainsnn.g1-run.v1','status':'started','physics_executed':False,
              'policy_forward_steps':0,'physics_step_calls':0,'goal_reached':False,
              'physical_accuracy_verified':False,'robot_control_enabled':False}
    def save():
        temp = output/'receipt.tmp'; temp.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        temp.replace(output/'receipt.json')
    save()
    child = None
    try:
        spec, prepared = verify_prepared(root)
        report.update(source_kind=spec['source_kind'],terrain_sha256=sha256(root/'terrain.usda'),
                      scenario_sha256=sha256(root/'scenario.json'))
        admission = preflight(); write_json(output/'preflight.json',admission)
        if admission['status'] != 'admitted':
            report.update(status='blocked',blockers=admission['blockers']); save(); return report
        verify_source(source)
        command = [sys.executable,'-m','robotics.g1_trial.isaac_runner','--bundle',str(root),
                   '--upstream',str(source),'--out',str(output),'--headless']
        if video:
            command.append('--video')
        environment = {**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHONHASHSEED':'0'}
        started = time.monotonic()
        with (output/'runtime.log').open('xb') as log:
            child = subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,env=environment)
            try:
                code = child.wait(timeout=wall_seconds)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL); child.wait(timeout=10)
                report.update(status='timed_out',physics_executed=None,execution_state='interrupted; inspect trace; no success claim')
                save(); return report
        report['elapsed_wall_seconds'] = round(time.monotonic()-started,3)
        result = read_json(output/'result.json')
        if result.get('schema') != 'brainsnn.g1-result.v1' or result.get('terrain_sha256') != report['terrain_sha256'] or result.get('scenario_sha256') != report['scenario_sha256'] or result.get('source_kind') != report['source_kind']:
            raise ValueError('Simulator receipt is missing or not bound to the requested terrain')
        if result.get('robot_control_enabled') is not False or result.get('physical_accuracy_verified') is not False:
            raise ValueError('Unsupported qualification in simulator result')
        if result.get('status') == 'completed' and any(type(result.get(k)) is not int or result[k] < 1 for k in ('policy_forward_steps','physics_step_calls','physics_substeps_observed')):
            raise ValueError('Completed trial has no executed policy/physics evidence')
        if result.get('goal_reached') and (result.get('status') != 'completed' or result.get('stop_reason') != 'goal_reached'):
            raise ValueError('Goal claim lacks a completed goal outcome')
        report.update(result)
        report['schema'] = 'brainsnn.g1-run.v1'
        if code != 0:
            report['status'] = 'failed'
        save(); return report
    except Exception as error:
        report.update(status='failed',error_type=type(error).__name__)
        if child is not None:
            report['physics_executed'] = None  # A missing child receipt cannot prove non-execution.
        save(); raise
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
        save()
