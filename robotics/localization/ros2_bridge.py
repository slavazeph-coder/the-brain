"""Actual ROS2 subscriptions -> bound recording / optional read-only telemetry."""
from __future__ import annotations
import argparse
from pathlib import Path
import time
from . import contracts as c
from .recording import Collector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--duration', type=float, default=300.)
    parser.add_argument('--use-sim-time', action='store_true')
    parser.add_argument('--origin', choices=['recorded-ros2', 'authored-ros2-test'], default='recorded-ros2')
    parser.add_argument('--telemetry-port', type=int)
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--allowed-origin')
    args = parser.parse_args()
    c.number(args.duration, 'recording duration', 1, 3600)
    manifest, raw = c.load_bundle(args.bundle)
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Recording output must be a new file')
    collector = Collector(c.binding(manifest, raw), origin=args.origin)
    # Imported only on the ROS host. Pure contracts and worker tests need no ROS.
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
    from rclpy.parameter import Parameter
    from rclpy.time import Time
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from nav_msgs.msg import Path as PosePath
    from diagnostic_msgs.msg import DiagnosticArray
    from std_msgs.msg import Bool, String
    from tf2_ros import Buffer, TransformListener

    def ns(stamp):
        return int(stamp.sec)*1_000_000_000 + int(stamp.nanosec)

    class Bridge(Node):
        def __init__(self):
            super().__init__('brainsnn_localization_recorder', parameter_overrides=[Parameter('use_sim_time', value=args.use_sim_time)])
            self.buffer = Buffer(); self.listener = TransformListener(self.buffer, self)
            self.last_bundle_check = 0.
            qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
            self.create_subscription(PoseWithCovarianceStamped, '/pcl_pose', lambda m: self.pose(m, 'pcl_pose'), qos)
            self.create_subscription(PoseWithCovarianceStamped, '/odom_bridge_pose', lambda m: self.pose(m, 'odom_bridge_pose'), qos)
            self.create_subscription(DiagnosticArray, '/alignment_status', self.status, qos)
            self.create_subscription(PosePath, '/path', self.path, qos)
            self.create_subscription(Bool, '/reinitialization_requested', self.reinit, qos)
            self.create_subscription(String, '/map_switch', lambda _m: collector.stop('map switch requires a new bound recorder'), 1)
            self.create_timer(.05, self.tick)

        def pose(self, msg, source):
            p, q = msg.pose.pose.position, msg.pose.pose.orientation
            collector.pose(ns(msg.header.stamp), msg.header.frame_id, [p.x,p.y,p.z], [q.x,q.y,q.z,q.w],
                           list(msg.pose.covariance), now_ns=self.get_clock().now().nanoseconds, source=source)

        def status(self, msg):
            if len(msg.status) != 1:
                collector.stop('ambiguous localization diagnostics'); return
            status = msg.status[0]
            values = {item.key: item.value for item in status.values}
            collector.status(ns(msg.header.stamp), int(status.level), values.get('failure_category', ''), now_ns=self.get_clock().now().nanoseconds)

        def reinit(self, msg):
            collector.reinitialization = bool(msg.data)

        def path(self, msg):
            if msg.header.frame_id != manifest['frames']['mapFrame'] or len(msg.poses) > 2000:
                collector.stop('path frame or history exceeds the bound')
            # The actual pose stream is authoritative; never replace it with a
            # stale retained /path dump or pretend a CSV is localization.

        def tf_check(self, timestamp, item):
            try:
                t = self.buffer.lookup_transform('map', manifest['frames']['baseFrame'], Time(nanoseconds=timestamp))
            except Exception:
                return False
            p, q = t.transform.translation, t.transform.rotation
            if sum((a-b)**2 for a,b in zip(item['position'], [p.x,p.y,p.z])) > .05**2:
                collector.stop('pose and bound map-to-base transform disagree'); return False
            dot = abs(sum(a*b for a,b in zip(item['quaternion'], [q.x,q.y,q.z,q.w])))
            if dot < .999:
                collector.stop('pose orientation and map-to-base transform disagree'); return False
            return True

        def tick(self):
            if time.monotonic()-self.last_bundle_check > 1:
                self.last_bundle_check = time.monotonic()
                try:
                    _, current = c.load_bundle(args.bundle)
                    if current != raw:
                        raise ValueError('bundle revision changed')
                except (OSError, ValueError) as exc:
                    collector.stop(str(exc))
                if any(self.count_publishers(topic) > 1 for topic in ('/pcl_pose', '/alignment_status')):
                    collector.stop('multiple localization publishers in this ROS domain')
            collector.flush(now_ns=self.get_clock().now().nanoseconds, tf_check=self.tf_check)

    server = None
    if args.telemetry_port is not None:
        if args.token_file is None:
            raise ValueError('An explicit private token file is required for telemetry')
        from .telemetry import serve
        server = serve(collector, args.token_file, args.telemetry_port, args.allowed_origin)
    rclpy.init(); node = Bridge(); deadline = time.monotonic()+args.duration
    try:
        while rclpy.ok() and time.monotonic() < deadline and not collector.stopped_reason:
            rclpy.spin_once(node, timeout_sec=.1)
    except KeyboardInterrupt:
        pass
    finally:
        node.tick(); node.destroy_node(); rclpy.shutdown()
        if server:
            server.shutdown(); server.server_close()
    document = collector.document()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create: a previous run cannot be overwritten by this recorder.
    with args.output.open('xb') as stream:
        stream.write(c.encode(document))
    if collector.stopped_reason:
        raise SystemExit('Recorder stopped: ' + collector.stopped_reason)


if __name__ == '__main__':
    main()
