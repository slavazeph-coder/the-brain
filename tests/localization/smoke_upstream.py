"""Real pinned NDT ROS2 smoke on authored asymmetric geometry, never a capture.

Runs inside robotics/localization/Dockerfile. Publishes moving simulated LiDAR
scans; tests recovered positions and yaw against known independent transforms.
It does not test map-wide initialization, physical accuracy or robot hardware.
"""
from __future__ import annotations
import argparse
import math
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from robotics.localization import contracts as c, map_bundle
from robotics.localization.ros2_runner import stop, verified_runtime


def geometry():
    rng = np.random.default_rng(1283)
    # Asymmetric room + two differently positioned pillars, with independent
    # coordinates on each face. These points are authored software fixtures.
    chunks = []
    for low, high in [([-4.,-3.,0.], [5.,4.,3.]), ([1.8,-1.,0.], [2.5,-.3,2.2]), ([-2.,1.2,0.], [-1.3,2.4,1.4])]:
        for axis in range(3):
            for side in (low[axis], high[axis]):
                p = rng.uniform(low, high, (650,3)); p[:,axis] = side
                chunks.append(p)
    return np.concatenate(chunks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/localization-smoke'))
    args = parser.parse_args(); verified_runtime()
    args.output.mkdir(parents=True, exist_ok=False)
    bundle = args.output/'map'; bundle.mkdir()
    points = geometry()
    raw = (f'ply\nformat ascii 1.0\ncomment AUTHORED TEST GEOMETRY\nelement vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\nend_header\n' +
           ''.join(' '.join(map(str,p))+'\n' for p in points)).encode()
    source_to_scene = [[1.,0.,0.,0.],[0.,0.,1.,0.],[0.,-1.,0.,0.],[0.,0.,0.,1.]]
    options = {'schema': c.REQUEST_SCHEMA, 'action': 'prepare-map', 'sceneSha256': None,
        'scanSha256': c.sha(raw), 'sourceFrame': 'right-handed-z-up', 'sourceToScene': source_to_scene,
        'declaration': {'kind':'registered-lidar','units':'m','registered':True}, 'baseFrame':'base_link','voxelMeters':.04}
    source = {'mode':'scan-local','scanSha256':c.sha(raw),'sceneSha256':None,'cloudPointsSha256':None,'componentRevision':None}
    manifest, files = map_bundle.prepare(raw, options, source)
    manifest['measurement']['basis'] = 'authored-test-geometry'
    manifest['revisionSha256'] = c.manifest_revision(manifest)
    files['localization-map.json'] = c.encode(manifest)
    for name, data in files.items():
        (bundle/name).write_bytes(data)
    # Start deliberately off truth: translation 0.28m and yaw 0.10rad. The
    # resulting trajectory must recover and follow later motion, not echo seed.
    initial_yaw = .38
    params = {'registration_method':'NDT_OMP','ndt_resolution':.5,'ndt_num_threads':2,
        'ndt_max_iterations':50,'score_threshold':6.,'transform_epsilon':.001,
        'scan_min_range':.1,'scan_max_range':40.,'voxel_leaf_size':.08,
        'enable_scan_voxel_filter':True,'use_pcd_map':True,'map_path':str(bundle/'localization-map.pcd'),
        'set_initial_pose':True,'initial_pose_x':1.45,'initial_pose_y':-.9,'initial_pose_z':.4,
        'initial_pose_qx':0.,'initial_pose_qy':0.,'initial_pose_qz':math.sin(initial_yaw/2),'initial_pose_qw':math.cos(initial_yaw/2),
        'use_imu_preintegration':False,'use_odom':False,'use_twist_prediction':False,
        'use_continuous_time_deskew':False,'enable_timer_publishing':False,
        'global_frame_id':'map','base_frame_id':'base_link','enable_map_odom_tf':False}
    import yaml
    params_file = args.output/'params.yaml'; params_file.write_text(yaml.safe_dump({'/**':{'ros__parameters':params}}))
    env = {**os.environ, 'ROS_DOMAIN_ID':'87'}
    log = (args.output/'upstream.log').open('wb')
    upstream = subprocess.Popen(['ros2','launch','lidar_localization_ros2','lidar_localization.launch.py',
        'localization_param_dir:='+str(params_file),'cloud_topic:=/cloud','base_frame_id:=base_link',
        'lidar_frame_id:=base_link','publish_lidar_tf:=false','publish_imu_tf:=false'], env=env,
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    bridge_log = (args.output/'bridge.log').open('wb')
    bridge = subprocess.Popen([sys.executable,'-m','robotics.localization.ros2_bridge','--bundle',str(bundle),
        '--output',str(args.output/'localization-recording.json'),'--duration','60','--origin','authored-ros2-test'], env=env,
        stdout=bridge_log, stderr=subprocess.STDOUT, start_new_session=True)
    os.environ['ROS_DOMAIN_ID']='87'
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import qos_profile_sensor_data
    from sensor_msgs.msg import PointCloud2, PointField
    from sensor_msgs_py import point_cloud2
    from std_msgs.msg import Header
    rclpy.init(); node = Node('brainsnn_authored_lidar'); pub = node.create_publisher(PointCloud2,'/cloud',qos_profile_sensor_data)
    fields = [PointField(name=n,offset=i*4,datatype=PointField.FLOAT32,count=1) for i,n in enumerate(('x','y','z','intensity'))]
    truth = {}
    try:
        deadline = time.monotonic()+15
        while pub.get_subscription_count() < 1 and time.monotonic() < deadline:
            rclpy.spin_once(node,timeout_sec=.1)
            if upstream.poll() is not None:
                raise RuntimeError('Actual upstream node exited; inspect upstream.log')
        if pub.get_subscription_count() < 1:
            raise RuntimeError('Upstream did not subscribe to the authored sensor')
        # 60 scans: initialization settling then a nonzero translated/yawed path.
        for i in range(60):
            amount = max(0, i-15)/44
            position = np.array([1.2+.5*amount, -.7+.25*amount, .3])
            yaw = .28 + .12*amount
            rotation = np.array([[math.cos(yaw),-math.sin(yaw),0],[math.sin(yaw),math.cos(yaw),0],[0,0,1]])
            scan = (points-position) @ rotation
            stamp = node.get_clock().now().to_msg(); stamp_ns = stamp.sec*1_000_000_000+stamp.nanosec
            truth[str(stamp_ns)] = {'position':position.tolist(),'yaw':yaw,'scan':i}
            cloud = point_cloud2.create_cloud(Header(stamp=stamp,frame_id='base_link'), fields,
                np.column_stack((scan,np.zeros(len(scan)))).astype(np.float32))
            pub.publish(cloud)
            until = time.monotonic()+.2
            while time.monotonic()<until:
                rclpy.spin_once(node,timeout_sec=.02)
        time.sleep(1)
    finally:
        stop(bridge); stop(upstream); log.close(); bridge_log.close(); node.destroy_node(); rclpy.shutdown()
    raw_record = c.read_file(args.output/'localization-recording.json')
    record = c.validate_recording(c.decode(raw_record),c.binding(manifest,files['localization-map.json']))
    errors, yaw_errors, indices = [], [], []
    for sample in record['samples']:
        actual = truth.get(sample['timestampNs'])
        if not actual or actual['scan']<15 or sample['state']!='tracking':
            continue
        errors.append(float(np.linalg.norm(np.array(sample['position'])-actual['position'])))
        q=sample['quaternion']; yaw=math.atan2(2*(q[3]*q[2]+q[0]*q[1]),1-2*(q[1]**2+q[2]**2))
        yaw_errors.append(abs(math.atan2(math.sin(yaw-actual['yaw']),math.cos(yaw-actual['yaw'])))); indices.append(actual['scan'])
    assert len(errors)>=20, f'Only {len(errors)} accepted moving scans (bridge/upstream logs retained)'
    assert max(indices)>=55, 'Localizer failed to follow the latter part of the authored path'
    assert float(np.percentile(errors,95))<.12, f'Authored translation p95 {np.percentile(errors,95):.3f}m'
    assert float(np.percentile(yaw_errors,95))<.06, f'Authored yaw p95 {np.percentile(yaw_errors,95):.3f}rad'
    result={'schema':'brainsnn.localization-software-smoke.v1','upstreamCommit':c.UPSTREAM_COMMIT,
        'origin':'authored-ros2-test','acceptedMovingScans':len(errors),'translationP95Meters':float(np.percentile(errors,95)),
        'yawP95Radians':float(np.percentile(yaw_errors,95)),'recordingSha256':c.sha(raw_record),
        'globalInitializationTested':False,'physicalRobotValidated':False,'passed':True}
    (args.output/'smoke-result.json').write_bytes(c.encode(result)); print(c.encode(result).decode())


if __name__=='__main__':
    main()
