"""Validate saved-job evidence before deriving demonstration captions.

This checks local consistency, not the honesty of operator descriptions or the
physical accuracy of a capture. It never changes geometry, scale or reports.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics/world_worker'))
import measurement_check  # noqa: E402

CAPTURE_KINDS = ('phone-video', 'photo-sequence-fixture', 'unknown')


def capture_metadata(kind, credit):
    if kind not in CAPTURE_KINDS:
        raise ValueError('Capture kind must be phone-video, photo-sequence-fixture or unknown.')
    if not isinstance(credit, str) or not 1 <= len(credit.strip()) <= 240 \
            or any(unicodedata.category(char).startswith('C') for char in credit):
        raise ValueError('Capture credit needs 1 to 240 plain characters without control characters.')
    return {'kind': kind, 'credit': credit.strip(), 'authority': 'operator-declared'}


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def _read(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 32 * 1024 * 1024:
        raise ValueError(f'Evidence must be a nonempty regular file within 32 MiB: {path}')
    raw = path.read_bytes()
    try:
        parsed = json.loads(raw)
        _canonical(parsed)  # Reject non-finite JSON before comparing calculated fields.
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ValueError(f'Invalid finite evidence JSON: {path}') from error
    if not isinstance(parsed, dict):
        raise ValueError(f'Evidence must be a JSON object: {path}')
    return parsed, hashlib.sha256(raw).hexdigest()


def measurement_evidence(job, *, require_report=False, minimum_held_out=0):
    """Return a recomputed/bound worker report, or None for an explicitly unchecked legacy job.

    The optional minimum counts supplied held-out pairs, not successful pairs.
    Failed results stay admissible and must remain visible in the film.
    """
    if type(require_report) is not bool or type(minimum_held_out) is not int or not 0 <= minimum_held_out <= 64:
        raise ValueError('Minimum held-out count must be an integer from 0 to 64.')
    job = Path(job)
    scene, scene_sha = _read(job / 'scene.json')
    cloud, cloud_sha = _read(job / 'arena-cloud.json')
    worker, _worker_sha = _read(job / 'scene-usd.json')
    report_path = job / 'scene-measurements.json'
    if not report_path.exists() and not report_path.is_symlink():
        if require_report or minimum_held_out or cloud.get('measurementChecks') is not None \
                or 'measurements' in worker:
            raise ValueError('Missing scene-measurements.json for this capture or declared measurement evidence.')
        return None
    report, _report_sha = _read(report_path)
    expected = measurement_check.build_report(scene, cloud)
    expected['sourceFiles'] = {'scene': {'sha256': scene_sha}, 'cloud': {'sha256': cloud_sha}}
    if _canonical(report) != _canonical(expected):
        raise ValueError('Dimensional report does not match the exact scene/cloud bytes and recomputed measurements.')
    summary = {'written': True, 'status': expected['status'], 'metric_verified': False}
    if _canonical(worker.get('measurements')) != _canonical(summary):
        raise ValueError('Worker measurement summary is missing or disagrees with the bound report.')
    if expected['summary']['heldOutCount'] < minimum_held_out:
        raise ValueError(f'At least {minimum_held_out} held-out checks are required; '
                         f'this job contains {expected["summary"]["heldOutCount"]}.')
    return report
