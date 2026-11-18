"""Launch the pinned upstream localizer and actual ROS recorder; optionally replay a bag.

Run inside the supplied Linux/ROS container. No velocity, goal or hardware command
publisher exists here. Map startup/recovery occurs inside the upstream localizer.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from . import contracts as c


def verified_runtime():
    root = Path(os.environ.get('BRAINSNN_LOCALIZER_SOURCE', '/opt/localizer/src/lidar_localization_ros2'))
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if head != c.UPSTREAM_COMMIT or subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Localizer source differs from the pinned clean build')
    return head


def stop(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGINT)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bag', type=Path)
    parser.add_argument('--duration', type=float, default=300.)
    parser.add_argument('--cloud-topic', default='/cloud')
    parser.add_argument('--imu-topic', default='/imu')
    parser.add_argument('--lidar-frame')
    parser.add_argument('--profile', choices=['standalone', 'mid360'], default='standalone')
    parser.add_argument('--initial-pose', nargs=7, type=float)
    parser.add_argument('--telemetry-port', type=int)
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--allowed-origin')
    args = parser.parse_args()
    c.number(args.duration, 'duration', 5, 3600)
    manifest, raw = c.load_bundle(args.bundle)
    verified_runtime()
    for topic in (args.cloud_topic, args.imu_topic):
        c.frame(topic.lstrip('/'))
    lidar_frame = c.frame(args.lidar_frame or manifest['frames']['baseFrame'])
    if args.initial_pose:
        c.vector(args.initial_pose, 7, 'initial pose')
        if abs(sum(x*x for x in args.initial_pose[3:])-1) > 1e-3:
            raise ValueError('Initial quaternion must be normalized')
    if args.bag and (args.bag.is_symlink() or not args.bag.is_dir() or not (args.bag/'metadata.yaml').is_file()):
        raise ValueError('Use a local rosbag2 directory with metadata.yaml')
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Run output must be a new directory')
    args.output.mkdir(parents=True)
    bundle = args.bundle.resolve(); output = args.output.resolve()
    localizer = ['ros2', 'run', 'lidar_localization_ros2', 'quickstart.py', '--map', str(bundle/'localization-map.pcd'),
        '--profile', args.profile, '--cloud-topic', args.cloud_topic, '--imu-topic', args.imu_topic,
        '--base-frame', manifest['frames']['baseFrame'], '--lidar-frame', lidar_frame,
        '--global-frame', 'map', '--no-rviz', '--no-restore-saved-pose', '--no-publish-lidar-tf',
        '--output', str(output/'upstream-config.yaml'), '--state-file', str(output/'upstream-state.json')]
    bridge = [sys.executable, '-m', 'robotics.localization.ros2_bridge', '--bundle', str(bundle),
              '--output', str(output/'localization-recording.json'), '--duration', str(args.duration)]
    if args.bag:
        localizer += ['--use-sim-time']; bridge += ['--use-sim-time']
    if args.initial_pose:
        localizer += ['--initial-pose', *map(str, args.initial_pose)]
    if args.telemetry_port is not None:
        if args.token_file is None:
            raise ValueError('Telemetry requires a separate token file')
        bridge += ['--telemetry-port', str(args.telemetry_port), '--token-file', str(args.token_file.resolve())]
        if args.allowed_origin:
            bridge += ['--allowed-origin', args.allowed_origin]
    commands = [('bridge', bridge), ('localizer', localizer)]
    if args.bag:
        commands.append(('bag', ['ros2', 'bag', 'play', str(args.bag.resolve()), '--clock', '--rate', '1', '--delay', '5',
                                '--topics', args.cloud_topic, args.imu_topic, '/odom', '/twist', '/tf', '/tf_static']))
    processes, logs = {}, []
    started = time.monotonic(); failure = None
    try:
        for name, command in commands:
            log = (output/(name+'.log')).open('xb'); logs.append(log)
            processes[name] = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        while time.monotonic()-started < args.duration:
            time.sleep(.2)
            if processes['bridge'].poll() is not None:
                failure = 'recorder ended before the requested duration'; break
            if processes['localizer'].poll() is not None:
                failure = 'upstream localizer exited'; break
            if 'bag' in processes and processes['bag'].poll() is not None:
                if processes['bag'].returncode != 0:
                    failure = 'ROS bag playback failed'
                break
    finally:
        # SIGINT lets the bridge persist its real messages before the localizer
        # disappears. Every process group is bounded, including quickstart children.
        for process in processes.values():
            stop(process)
        for log in logs:
            log.close()
    record_path = output/'localization-recording.json'
    recording = c.validate_recording(c.decode(c.read_file(record_path)), c.binding(manifest, raw))
    receipt = {'schema': 'brainsnn.localization-run.v1', 'binding': recording['binding'],
        'upstreamCommit': c.UPSTREAM_COMMIT, 'mode': 'rosbag-replay' if args.bag else 'edge-subscription',
        'initialization': 'explicit-pose' if args.initial_pose else 'upstream-global-search',
        'recordingSha256': c.sha(c.read_file(record_path)), 'samples': len(recording['samples']),
        'exitCodes': {name: process.returncode for name, process in processes.items()},
        'elapsedSeconds': round(time.monotonic()-started, 3), 'failure': failure,
        'physicalRobotValidated': False, 'accuracyVerified': False}
    (output/'localization-run.json').write_bytes(c.encode(receipt))
    if failure or not recording['samples']:
        raise SystemExit(failure or 'No bound localization samples were recorded')


if __name__ == '__main__':
    main()
