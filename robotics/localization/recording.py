"""ROS-independent bounded collector; the ROS subscriber supplies actual messages."""
from __future__ import annotations
import copy
import threading
import time
from . import contracts as c


class Collector:
    def __init__(self, binding, *, origin='recorded-ros2', max_age_seconds=2.):
        c.validate_binding(binding)
        if origin not in ('recorded-ros2', 'authored-ros2-test'):
            raise ValueError('Unknown recording origin')
        self.binding = copy.deepcopy(binding)
        self.runtime = {'engine': 'lidar_localization_ros2', 'upstreamCommit': c.UPSTREAM_COMMIT, 'origin': origin}
        self.max_age_ns = int(c.number(max_age_seconds, 'maximum age', .05, 5.) * 1e9)
        self.samples, self.statuses, self.pending = [], {}, {}
        self.reinitialization = False
        self.stopped_reason = None
        self.rejected = 0
        self.last_received = None
        self.latest_failure = None
        self.lock = threading.RLock()

    def stop(self, reason):
        with self.lock:
            self.stopped_reason = str(reason)[:160]
            self.pending.clear()

    def fresh(self, timestamp_ns, now_ns):
        return timestamp_ns > 0 and -50_000_000 <= now_ns-timestamp_ns <= self.max_age_ns

    def status(self, timestamp_ns, level, category, *, now_ns, reinitialization_requested=False):
        with self.lock:
            if self.stopped_reason or not self.fresh(timestamp_ns, now_ns) or level not in (0, 1, 2, 3):
                self.rejected += 1; return False
            self.statuses[timestamp_ns] = {'level': level, 'failureCategory': str(category)[:80],
                'reinitializationRequested': self.reinitialization or reinitialization_requested, 'statusTimestampNs': str(timestamp_ns)}
            status = self.statuses[timestamp_ns]
            if (status['level'] != 0 or status['reinitializationRequested'] or status['failureCategory'] not in ('', 'healthy', 'none')) and (self.latest_failure is None or timestamp_ns >= int(self.latest_failure['statusTimestampNs'])):
                self.latest_failure = status
            for old in sorted(self.statuses)[:-64]:
                del self.statuses[old]
            return True

    def reinit(self, requested):
        with self.lock:
            self.reinitialization = bool(requested)
            if requested and self.samples:
                self.latest_failure = {**self.samples[-1]['diagnostics'], 'reinitializationRequested': True}

    def pose(self, timestamp_ns, frame_id, position, quaternion, covariance, *, now_ns, source='pcl_pose'):
        with self.lock:
            if (self.stopped_reason or frame_id != self.binding['mapFrame'] or not self.fresh(timestamp_ns, now_ns)
                    or source not in ('pcl_pose', 'odom_bridge_pose')):
                self.rejected += 1; return False
            try:
                p = c.vector(position, 3, 'pose', -100_000, 100_000)
                q = c.vector(quaternion, 4, 'quaternion', -1.001, 1.001)
                cov = c.vector(covariance, 36, 'covariance')
                if abs(sum(v*v for v in q)-1) > 1e-3 or any(cov[i] < 0 for i in (0, 7, 14, 21, 28, 35)):
                    raise ValueError('Invalid pose')
            except ValueError:
                self.rejected += 1; return False
            # A bridge estimate wins over pcl_pose for the same timestamp so an
            # odometry-only output can never masquerade as a measured map fix.
            if source == 'odom_bridge_pose' or timestamp_ns not in self.pending:
                self.pending[timestamp_ns] = {'position': p, 'quaternion': q, 'covariance': cov,
                    'source': source, 'received': time.monotonic()}
            for old in sorted(self.pending)[:-64]:
                del self.pending[old]; self.rejected += 1
            return True

    def flush(self, *, now_ns, tf_check=None, force=False):
        with self.lock:
            for timestamp in sorted(list(self.pending)):
                item = self.pending[timestamp]
                if not force and time.monotonic()-item['received'] < .15:
                    continue
                if not self.fresh(timestamp, now_ns):
                    del self.pending[timestamp]; self.rejected += 1; continue
                # Upstream diagnostic arrays carry the exact scan stamp. Never
                # borrow a nearby healthy status from a different scan.
                diag = self.statuses.get(timestamp)
                if diag is None:
                    continue
                if tf_check is not None and not tf_check(timestamp, item):
                    continue
                del self.pending[timestamp]
                if self.samples and timestamp <= int(self.samples[-1]['timestampNs']):
                    self.rejected += 1; continue
                if len(self.samples) >= c.MAX_SAMPLES:
                    self.stop('sample limit reached'); break
                state = ('odometry-only' if item['source'] == 'odom_bridge_pose' else
                         'lost' if diag['level'] >= 2 or diag['reinitializationRequested'] else
                         'weak' if diag['level'] != 0 or diag['failureCategory'] not in ('', 'healthy', 'none') else 'tracking')
                first = int(self.samples[0]['timestampNs']) if self.samples else timestamp
                sample = {k: item[k] for k in ('position', 'quaternion', 'covariance')}
                sample.update(timestampNs=str(timestamp), t=(timestamp-first)/1e9, state=state,
                              diagnostics={**diag, 'poseSource': item['source']})
                self.samples.append(sample); self.last_received = time.monotonic()

    def document(self):
        with self.lock:
            value = {'schema': c.RECORDING_SCHEMA, 'binding': self.binding, 'runtime': self.runtime,
                     'validation': {'physicalRobotValidated': False, 'accuracyVerified': False, 'producerAttested': False},
                     'samples': copy.deepcopy(self.samples), 'rejectedMessages': self.rejected,
                     'stoppedReason': self.stopped_reason}
            return c.validate_recording(value)

    def snapshot(self):
        with self.lock:
            stale = self.last_received is None or time.monotonic()-self.last_received > self.max_age_ns/1e9
            state = 'stopped' if self.stopped_reason else 'stale' if stale else self.samples[-1]['state']
            reason = self.stopped_reason
            status = self.latest_failure
            # A rejected scan often publishes diagnostics without a new pose.
            # Stop presenting the previous green pose immediately, rather than
            # waiting for its age deadline after tracking has already failed.
            prediction_only = bool(self.samples and self.samples[-1]['state'] == 'odometry-only')
            if not self.stopped_reason and not prediction_only and self.samples and status and int(status['statusTimestampNs']) >= int(self.samples[-1]['timestampNs']):
                if self.reinitialization or status['reinitializationRequested'] or status['level'] >= 2:
                    state, reason = 'lost', 'latest alignment requires recovery'
                elif int(status['statusTimestampNs']) > int(self.samples[-1]['timestampNs']) and (status['level'] != 0 or status['failureCategory'] not in ('', 'healthy', 'none')):
                    state, reason = 'stale', 'latest alignment has no accepted pose'
            if not self.stopped_reason and not prediction_only and self.reinitialization:
                state, reason = 'lost', 'reinitialization requested'
            unavailable = state in ('stopped', 'stale') or state == 'lost' and (stale or reason is not None)
            return {'schema': 'brainsnn.localization-telemetry.v1', 'binding': self.binding, 'runtime': self.runtime,
                    'state': state, 'reason': reason, 'sample': None if unavailable else copy.deepcopy(self.samples[-1])}
