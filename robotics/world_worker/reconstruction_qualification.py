"""Frozen, repeated reconstruction experiments. No automatic production promotion.

The plan snapshots shared images and references before execution, rotates engine
order, and retains every requested trial, including failures and unstarted work.
Only camera-landmark distances are tested, never BIM surfaces or robot physics.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
from pathlib import Path
import re
import shutil
import statistics
import sys
import time

from . import comparison_measurements as measurements
from . import reconstruction_comparison as rc

PLAN_SCHEMA = 'brainsnn.reconstruction-qualification-plan.v1'
JOURNAL_SCHEMA = 'brainsnn.reconstruction-qualification-run.v1'
CONDITIONS = ('ordinary-interior', 'low-texture', 'reflective')
ID = re.compile(r'^[a-z][a-z0-9-]{0,47}$')
SOURCES = ('reconstruction_qualification.py', 'reconstruction_comparison.py',
           'comparison_measurements.py', 'comparison_vggt.py', 'sparse_colmap.py',
           'geometry.py', 'requirements-comparison.txt', 'requirements-colmap.txt')
SCREEN = {'minimumRepeats': 3, 'requiredConditions': list(CONDITIONS),
          'minimumHeldOutSpans': 7, 'medianErrorReduction': .20, 'speedup': 2.,
          'maximumErrorMustNotIncrease': True,
          'absoluteToleranceMetres': .05, 'relativeTolerance': .02}


def digest(value):
    return hashlib.sha256(rc.canonical(value)).hexdigest()


def code_signature():
    root = Path(__file__).parent
    return {name: rc.sha(root / name) for name in SOURCES}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save_journal(root, journal):
    # An interrupted write must not erase the last complete trial denominator.
    temporary = root / 'execution.pending.json'
    rc.write_json(temporary, journal)
    temporary.replace(root / 'execution.json')


def bounded_int(value, lo, hi, name):
    if type(value) is not int or not lo <= value <= hi:
        raise ValueError(f'{name} must be an integer from {lo} to {hi}.')


def snapshot_case(root, entry):
    case = root / 'cases' / entry['id']
    receipt = rc.validate_capture(case)
    marked = measurements.validate_annotations(rc.read_json(case / 'annotations.json'), receipt)
    if receipt['captureSha256'] != entry['captureSha256'] or digest(marked) != entry['annotationSha256']:
        raise ValueError('Frozen capture or references changed. Create a new plan.')
    return case, receipt, marked


def validate_plan(path):
    path = Path(path)
    plan = rc.read_json(path)
    if not isinstance(plan, dict) or plan.get('schema') != PLAN_SCHEMA \
            or digest({k: v for k, v in plan.items() if k != 'planSha256'}) != plan.get('planSha256'):
        raise ValueError('Plan canonical SHA-256 does not match its contents.')
    if plan.get('codeSignature') != code_signature():
        raise ValueError('Experiment implementation changed after planning. Create a fresh plan.')
    if plan.get('screen') != SCREEN or type(plan.get('syntheticOnly')) is not bool:
        raise ValueError('Unexpected experiment screen or synthetic label.')
    bounded_int(plan.get('repeats'), 1, 6, 'Repeats')
    engines = plan.get('engines')
    if not isinstance(engines, list) or not 1 <= len(engines) <= len(rc.ENGINES) \
            or len(set(engines)) != len(engines) or any(e not in rc.ENGINES for e in engines) or 'colmap' not in engines:
        raise ValueError('A plan requires the COLMAP baseline and unique supported engines.')
    cases = plan.get('cases')
    if not isinstance(cases, list) or not 1 <= len(cases) <= 6:
        raise ValueError('A plan needs one to six captures.')
    ids, hashes = set(), set()
    for entry in cases:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not ID.fullmatch(entry['id']) \
                or entry['id'] in ids or entry.get('condition') not in CONDITIONS:
            raise ValueError('Use unique case IDs and explicit capture conditions.')
        ids.add(entry['id'])
        _, receipt, marked = snapshot_case(path.resolve().parent, entry)
        # A duplicate copy cannot count as a second independent capture.
        input_hash = digest(sorted([r['kind'], r['sha256']] for r in receipt['sources']))
        if input_hash in hashes:
            raise ValueError('Cases must use different original captures, not renamed copies.')
        hashes.add(input_hash)
        if sum(s['role'] == 'held-out' for s in marked['spans']) < 7:
            raise ValueError('Every case needs one calibration and at least seven withheld spans.')
        if marked['referenceBasis'] != 'physical-readings' and not plan.get('syntheticOnly'):
            raise ValueError('Physical plans require physical readings for every case.')
    return plan


def create_plan(*, inputs, out, repeats=3, engines=rc.ENGINES, allow_synthetic=False):
    """Copy immutable inputs before any inference. No generated reference values."""
    bounded_int(repeats, 1, 6, 'Repeats')
    source = rc.read_json(inputs)
    if not isinstance(source, dict) or set(source) != {'schema', 'cases'} \
            or source['schema'] != 'brainsnn.qualification-inputs.v1' \
            or not isinstance(source['cases'], list) or not 1 <= len(source['cases']) <= 6:
        raise ValueError('Expected qualification-inputs.v1 with one to six cases.')
    selected = list(engines)
    if not selected or len(set(selected)) != len(selected) or 'colmap' not in selected or any(e not in rc.ENGINES for e in selected):
        raise ValueError('Include colmap and unique supported engines.')
    prepared, ids = [], set()
    for entry in source['cases']:
        if not isinstance(entry, dict) or set(entry) != {'id', 'condition', 'case', 'annotations'} \
                or not isinstance(entry['id'], str) or not ID.fullmatch(entry['id']) or entry['id'] in ids \
                or entry['condition'] not in CONDITIONS:
            raise ValueError('Each case needs a unique bounded id, condition, case path and annotations path.')
        ids.add(entry['id'])
        case = Path(entry['case'])
        if not case.is_absolute() or not Path(entry['annotations']).is_absolute():
            raise ValueError('Input paths must be absolute.')
        receipt = rc.validate_capture(case)
        marked = measurements.validate_annotations(rc.read_json(entry['annotations']), receipt)
        if sum(s['role'] == 'held-out' for s in marked['spans']) < 7:
            raise ValueError('At least seven withheld spans are required per case.')
        if marked['referenceBasis'] != 'physical-readings' and not allow_synthetic:
            raise ValueError('Synthetic fixtures need --allow-synthetic and can never pass the physical screen.')
        prepared.append((entry, case, receipt, marked))
    root = Path(out)
    root.mkdir(parents=True, exist_ok=False)
    cases = []
    try:
        for entry, case, receipt, marked in prepared:
            target = root / 'cases' / entry['id']
            target.mkdir(parents=True)
            shutil.copytree(case / 'frames', target / 'frames', symlinks=True)
            rc.write_json(target / 'capture.json', receipt)
            rc.write_json(target / 'annotations.json', marked)
            cases.append({'id': entry['id'], 'condition': entry['condition'],
                          'captureSha256': receipt['captureSha256'], 'annotationSha256': digest(marked)})
        plan = {'schema': PLAN_SCHEMA, 'createdAt': now(), 'repeats': repeats, 'engines': selected,
                'cases': cases, 'codeSignature': code_signature(), 'syntheticOnly': allow_synthetic,
                'screen': SCREEN.copy(),
                'scope': 'Self-reported physical readings versus camera-derived triangulated landmarks only.',
                'productionPromotionApproved': False}
        plan['planSha256'] = digest(plan)
        # Do not publish a plan for an invalid snapshot or duplicate capture.
        rc.write_json(root / 'pending-plan.json', plan)
        validate_plan(root / 'pending-plan.json')
        (root / 'pending-plan.json').rename(root / 'plan.json')
    except BaseException:
        (root / 'pending-plan.json').unlink(missing_ok=True)
        raise
    return plan


def schedule(plan):
    """Rotate starts over repetitions and conditions; execute sequentially."""
    cells = []
    engines = plan['engines']
    for repeat in range(plan['repeats']):
        for index, case in enumerate(plan['cases']):
            shift = (repeat + index) % len(engines)
            cells.append({'id': f'{case["id"]}-r{repeat + 1}', 'caseId': case['id'],
                          'repeat': repeat + 1, 'engines': engines[shift:] + engines[:shift]})
    return cells


def execute_plan(*, plan_path, timeout=1800, max_seconds=3600, vggt_source=None, vggt_checkpoint=None,
                 python=sys.executable, allow_synthetic=False):
    """One attempt only. Retain aborted cells; never rerun a lucky subset."""
    plan = validate_plan(plan_path)
    bounded_int(timeout, 1, 7200, 'Engine timeout')
    bounded_int(max_seconds, 1, 86400, 'Total execution budget')
    if plan['syntheticOnly'] and not allow_synthetic:
        raise ValueError('Synthetic plan execution requires --allow-synthetic.')
    root = Path(plan_path).resolve().parent
    runs = root / 'runs'
    runs.mkdir(exist_ok=False)
    journal = {'schema': JOURNAL_SCHEMA, 'planSha256': plan['planSha256'], 'startedAt': now(),
               'hardware': rc.hardware_record(), 'maxSeconds': max_seconds,
               'trials': [{**cell, 'status': 'not-started'} for cell in schedule(plan)]}
    save_journal(root, journal)
    started = time.monotonic()
    cases = {c['id']: c for c in plan['cases']}
    try:
        for trial in journal['trials']:
            remaining = max_seconds - (time.monotonic() - started)
            if remaining < len(plan['engines']):
                trial.update(status='budget-exhausted')
                continue
            case, _, _ = snapshot_case(root, cases[trial['caseId']])
            trial.update(status='running', startedAt=now())
            save_journal(root, journal)
            target = runs / trial['id']
            print(f'Trial {trial["id"]}: {", ".join(trial["engines"])}', flush=True)
            try:
                rc.execute(case=case, out=target, engines=trial['engines'], annotations=case / 'annotations.json',
                           vggt_source=vggt_source, vggt_checkpoint=vggt_checkpoint, python=python,
                           timeout=min(timeout, max(1, int(remaining / len(plan['engines'])))))
                trial.update(status='recorded', runSha256=rc.sha(target / 'run.json'))
            except (ValueError, RuntimeError, OSError, ImportError) as error:
                trial.update(status='failed', reason=str(error)[:1000])
            trial['finishedAt'] = now()
            save_journal(root, journal)
    finally:
        journal.update(finishedAt=now(), elapsedSeconds=time.monotonic() - started)
        save_journal(root, journal)
    return build_report(plan_path)


def trial_report(root, plan, cell, recorded):
    """Recompute from hashed cameras; don't trust a saved score or omit failures."""
    result = {**cell, 'status': recorded.get('status', 'not-started'), 'arms': []}
    if result['status'] != 'recorded':
        result['reason'] = recorded.get('reason', 'Trial did not finish; retained in the denominator.')
        return result
    try:
        directory = root / 'runs' / cell['id']
        if rc.sha(directory / 'run.json') != recorded.get('runSha256'):
            raise ValueError('Run receipt changed after execution.')
        run = rc.read_json(directory / 'run.json')
        entry = next(c for c in plan['cases'] if c['id'] == cell['caseId'])
        if run.get('requestedEngines') != cell['engines'] or [r.get('engine') for r in run.get('runs', [])] != cell['engines'] \
                or not run.get('annotationsPredeclared') or run.get('annotationSha256') != entry['annotationSha256']:
            raise ValueError('Run order, engine denominator or frozen references do not match the plan.')
        if run.get('hardware') != rc.read_json(root / 'execution.json')['hardware']:
            raise ValueError('Hardware/runtime identity changed during the experiment.')
        case, _, marked = snapshot_case(root, entry)
        comparison = rc.score_run(case=case, run=directory, annotations=case / 'annotations.json')
        for arm in comparison['runs']:
            summary = arm.get('measurementReport', {}).get('summary', {})
            spans = [s for s in arm.get('measurementReport', {}).get('spans', []) if s['role'] == 'held-out']
            by_id = {s['id']: s for s in spans}
            failures = []
            for span in marked['spans']:
                if span['role'] == 'held-out':
                    measured = by_id.get(span['id'], {})
                    if measured.get('status') != 'available' or measured['absoluteErrorMeters'] > max(
                            plan['screen']['absoluteToleranceMetres'], plan['screen']['relativeTolerance'] * span['distanceMeters']):
                        failures.append(span['id'])
            result['arms'].append({**arm, 'requestedHeldOutCount': sum(s['role'] == 'held-out' for s in marked['spans']),
                                  'availableHeldOutCount': summary.get('validHeldOutCount', 0),
                                  'outsideToleranceOrMissingSpanIds': failures,
                                  'allHeldOutWithinTolerance': bool(spans) and not failures})
        result['status'] = 'scored'
    except (OSError, ValueError, TypeError, KeyError) as error:
        result.update(status='invalid-evidence', reason=str(error)[:1000], arms=[])
    return result


def build_report(plan_path):
    plan = validate_plan(plan_path)
    root = Path(plan_path).resolve().parent
    execution = rc.read_json(root / 'execution.json')
    if execution.get('schema') != JOURNAL_SCHEMA or execution.get('planSha256') != plan['planSha256']:
        raise ValueError('Execution journal is not bound to this plan.')
    expected = schedule(plan)
    recorded = execution.get('trials')
    if not isinstance(recorded, list) or len(recorded) != len(expected) or any(
            not isinstance(a, dict) or any(a.get(k) != b[k] for k in ('id', 'caseId', 'repeat', 'engines'))
            for a, b in zip(recorded, expected)):
        raise ValueError('Execution journal dropped, duplicated or reordered requested trials.')
    trials = [trial_report(root, plan, cell, row) for cell, row in zip(expected, recorded)]
    full_design = plan['repeats'] >= 3 and set(CONDITIONS) <= {c['condition'] for c in plan['cases']} \
        and len(plan['engines']) >= 2 and not plan['syntheticOnly']
    candidates = []
    for engine in plan['engines']:
        if engine == 'colmap':
            continue
        passing, failed, unavailable, timings = [], [], [], []
        for trial in trials:
            arms = {a['engine']: a for a in trial['arms']}
            a, b = arms.get('colmap', {}), arms.get(engine, {})
            gate = b.get('dimensionAndTimingGate', {})
            complete = trial['status'] == 'scored' and a.get('status') == b.get('status') == 'completed'
            if not complete or gate.get('status') == 'unavailable':
                unavailable.append(trial['id'])
            elif gate.get('passed') and a.get('allHeldOutWithinTolerance') and b.get('allHeldOutWithinTolerance'):
                passing.append(trial['id'])
            else:
                failed.append(trial['id'])
            if complete and isinstance(b.get('endToEndSeconds'), (int, float)):
                timings.append(b['endToEndSeconds'])
        candidates.append({'engine': engine, 'expectedTrials': len(expected), 'passedTrials': passing,
                           'failedTrials': failed, 'unavailableTrials': unavailable,
                           'medianEndToEndSecondsCompletedOnly': statistics.median(timings) if timings else None,
                           'completedTimingCount': len(timings),
                           'readyForGeometryReview': full_design and len(passing) == len(expected)})
    report = {'schema': 'brainsnn.reconstruction-qualification.v1', 'planSha256': plan['planSha256'],
              'executionSha256': rc.sha(root / 'execution.json'), 'createdAt': now(),
              'syntheticOnly': plan['syntheticOnly'], 'completeExperimentDesign': full_design,
              'requestedTrials': len(expected), 'requestedEngineRuns': len(expected) * len(plan['engines']),
              'trials': trials, 'candidates': candidates,
              'productionPromotionApproved': False, 'surveyAccuracyValidated': False,
              'bimSurfacesValidated': False, 'gravityValidated': False, 'physicalRobotValidated': False,
              'limitations': ['Readings and case conditions are operator-reported, not independently attested.',
                              'One measured calibration span fits scale; seven or more withheld spans test camera landmarks.',
                              'Every trial must pass the relative comparison and max(5 cm, 2% of reference) tolerance.',
                              'Dense surfaces, openings, collision coverage, BIM/Rhino edits and physics need separate evidence.',
                              'Fresh processes do not flush OS caches. CPU COLMAP versus CUDA VGGT is not equal-hardware speed.',
                              'Repeated engine trials on one capture are not independent physical captures.',
                              'Actual GPU inference and physical dimensions are qualified only by their retained run evidence.']}
    rc.write_json(root / 'qualification.json', report)
    lines = ['# Measured reconstruction experiment', '',
             '**Synthetic fixture only.**' if plan['syntheticOnly'] else 'Physical reading provenance is self-reported.', '',
             f'Planned trials: {len(expected)}. Planned engine runs: {report["requestedEngineRuns"]}.', '',
             '| Trial | Execution | Engine | Available / requested spans | Dimension/timing screen | Absolute tolerance |',
             '|---|---|---|---:|---|---|']
    for trial in trials:
        for engine in trial['engines']:
            arm = next((a for a in trial['arms'] if a['engine'] == engine), {})
            lines.append(f'| {trial["id"]} | {arm.get("status", trial["status"])} | {engine} | '
                         f'{arm.get("availableHeldOutCount", 0)} / '
                         f'{sum(s["role"] == "held-out" for s in rc.read_json(root / "cases" / trial["caseId"] / "annotations.json")["spans"])} | '
                         f'{arm.get("dimensionAndTimingGate", {}).get("status", "unavailable")} | '
                         f'{"pass" if arm.get("allHeldOutWithinTolerance") else "unavailable or failed"} |')
    lines += ['', '## Candidates for further geometry review', '']
    for candidate in candidates:
        lines.append(f'- {candidate["engine"]}: {len(candidate["passedTrials"])}/{candidate["expectedTrials"]} passing trials; '
                     f'{len(candidate["failedTrials"])} failed; {len(candidate["unavailableTrials"])} unavailable. '
                     f'Ready for geometry review: {candidate["readyForGeometryReview"]}.')
    lines += ['', '**Production promotion: not approved.**', ''] + [f'- {s}' for s in report['limitations']]
    (root / 'qualification.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan', help='Snapshot all captures, references, code and the complete trial matrix')
    plan.add_argument('--inputs', type=Path, required=True)
    plan.add_argument('--out', type=Path, required=True)
    plan.add_argument('--repeats', type=int, default=3)
    plan.add_argument('--engines', choices=rc.ENGINES, nargs='+', default=list(rc.ENGINES))
    plan.add_argument('--allow-synthetic', action='store_true')
    run = sub.add_parser('run', help='Run the frozen matrix once within time budgets')
    run.add_argument('--plan', type=Path, required=True)
    run.add_argument('--timeout', type=int, default=1800)
    run.add_argument('--max-seconds', type=int, default=3600)
    run.add_argument('--vggt-source', type=Path)
    run.add_argument('--vggt-checkpoint', type=Path)
    run.add_argument('--python', default=sys.executable)
    run.add_argument('--allow-synthetic', action='store_true')
    report = sub.add_parser('report', help='Recheck bound evidence; retain missing/interrupted trials')
    report.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'plan':
            result = create_plan(inputs=args.inputs, out=args.out, repeats=args.repeats,
                                 engines=args.engines, allow_synthetic=args.allow_synthetic)
            print(f'Frozen plan: {args.out / "plan.json"} ({result["planSha256"]})')
        else:
            result = build_report(args.plan) if args.command == 'report' else execute_plan(
                plan_path=args.plan, timeout=args.timeout, max_seconds=args.max_seconds,
                vggt_source=args.vggt_source, vggt_checkpoint=args.vggt_checkpoint,
                python=args.python, allow_synthetic=args.allow_synthetic)
            print(f'Report: {args.plan.parent / "qualification.md"}. Production promotion: not approved.')
            if any(t['status'] != 'scored' or any(a['status'] != 'completed' for a in t['arms']) for t in result['trials']):
                return 2
        return 0
    except (ValueError, RuntimeError, OSError, ImportError) as error:
        print(f'Qualification error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
