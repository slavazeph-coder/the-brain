"""Stress the world-update loop on rendered rooms whose truth is authored, and score it against that truth.

    python tests/world/world_update_sweep.py --out <folder> [--only name ...]

For each scenario: an as-is scan (reconstructed once per as-is room), a later walk, the loop, then a check against the
authored geometry: were the frames placed, was each real change found (and nothing else called a change), did each
robot get the outcome a planner on the true room gives, and does every adapted route keep the robot's clearance from
the true obstacles. Writes sweep.json and sweep.md. Slow (minutes); CI runs the decisive cases in test_world_update.py.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

from robotics.world_worker import world_update as wu  # noqa: E402
import world_update_scene as ws  # noqa: E402

ROBOTS = [{'id': 'robot-a', 'model': 'Small AMR (0.45 m square)', 'width_m': .45, 'depth_m': .45, 'height_m': .6, 'margin_m': .05},
          {'id': 'robot-b', 'model': 'Cart AMR (0.7 x 0.8 m)', 'width_m': .7, 'depth_m': .8, 'height_m': .75, 'margin_m': .08}]
ROUTE = {'start': [0, .6], 'goal': [0, 3.2]}
WALK = [{'centre': [x, 0., .2], 'pitch': 15.} for x in (-.75, -.25, .25, .75)]
LEVEL_WALK = [{'centre': [x, 0., .2], 'pitch': 0.} for x in (-.75, -.25, .25, .75)]
LEFT_CRATE = ws.box((-1.5, -.7), (2.0, 2.5), .8)
CLUTTER = [ws.box((-1.2, -.6), (1.6, 2.0), .5, texture=751), ws.box((.4, .9), (2.2, 2.6), .7, texture=752),
           ws.box((-.2, .2), (2.9, 3.1), .4, texture=753)]

SCENARIOS = [
    {'name': 'crate in the aisle', 'after': [ws.CRATE]},
    {'name': 'unchanged room', 'after': []},
    {'name': 'crate beside the route', 'after': [LEFT_CRATE]},
    {'name': 'crate near the walker', 'after': [ws.box((-.4, .6), (1.2, 1.6), .6)]},
    {'name': 'small box 0.3 m', 'after': [ws.box((-.15, .15), (2.0, 2.3), .3)]},
    {'name': 'thin pole 0.12 m', 'after': [ws.box((-.06, .06), (2.0, 2.12), 1.2)]},
    {'name': 'low step 5 cm', 'after': [ws.box((-.6, .6), (2.0, 2.4), .05)]},
    {'name': 'overhang 0.70-0.80 m', 'after': [ws.box((-.6, .6), (1.9, 2.5), .1, lift=.7)]},
    {'name': 'plain grey crate', 'after': [{**ws.CRATE, 'texture': None}]},
    {'name': 'dim, noisy, JPEG 70', 'after': [ws.CRATE], 'degrade': {'gain': .7, 'noise': 4, 'jpeg': 70}},
    {'name': 'blurred walk', 'after': [ws.CRATE], 'degrade': {'blur': 1.2}},
    {'name': 'wider lens (f 520)', 'after': [ws.CRATE], 'degrade': {'focal': 520.}},
    {'name': 'longer lens (f 800)', 'after': [ws.CRATE], 'degrade': {'focal': 800.}},
    {'name': 'level walk', 'after': [ws.CRATE], 'walk': LEVEL_WALK},
    {'name': 'two frames', 'after': [ws.CRATE], 'walk': WALK[1:3]},
    {'name': 'unchanged, dim and noisy', 'after': [], 'degrade': {'gain': .7, 'noise': 4, 'jpeg': 70}},
    {'name': 'clutter: three boxes', 'after': CLUTTER},
    {'name': 'crate, richer as-is scan', 'asis': 'rich', 'after': [ws.CRATE]},
    {'name': 'crate removed', 'asis': 'rich', 'before': [ws.CRATE], 'after': []},
    {'name': 'crate moved', 'asis': 'rich', 'before': [LEFT_CRATE], 'after': [ws.CRATE]},
    {'name': 'crate unchanged', 'asis': 'rich', 'before': [ws.CRATE], 'after': [ws.CRATE]},
]


def key(item):
    return (item['x'], item['z'], item['y'], item['texture'])


def matters(item, height=.75, floor=wu.THRESHOLDS['min_obstacle_height_m']):
    bottom, top = ws.heights(item)
    return bottom < height + .05 and top >= floor


def cells_of(candidate, grid, field):
    origin, cell = np.array(grid['origin_m']), grid['cell_m']
    return [origin + (np.array(c) + .5) * cell for c in candidate.get(field, [])]


def overlap(points, item, pad):
    return [p for p in points if item['x'][0] - pad <= p[0] <= item['x'][1] + pad and item['z'][0] - pad <= p[1] <= item['z'][1] + pad]


def coverage(candidates, grid, item):
    """Share of an object's true footprint cells (cell centres inside it) that candidates cover, observed or assumed."""
    covered = set()
    for c in candidates:
        covered |= {tuple(x) for x in c['cells'] + c.get('assumed_cells', [])}
    origin, cell = np.array(grid['origin_m']), grid['cell_m']
    truth = [(i, j) for i in range(grid['shape'][0]) for j in range(grid['shape'][1])
             if item['x'][0] < origin[0] + (i + .5) * cell < item['x'][1] and item['z'][0] < origin[1] + (j + .5) * cell < item['z'][1]]
    return (len(set(truth) & covered) / len(truth)) if truth else None


def truth_outcome(robot, before_objects, after_objects):
    """The outcome a planner on the true room gives, with the same grid, inflation and planner."""
    cell, origin, shape = .1, np.array([-2.5, -.6]), (50, 51)

    def occupied(objects):
        grid = np.zeros(shape, dtype=bool)
        for (x0, x1), (z0, z1) in ws.solids(objects, robot['height_m']):
            i0, i1 = int(np.floor((x0 - origin[0]) / cell)), int(np.ceil((x1 - origin[0]) / cell))
            j0, j1 = int(np.floor((z0 - origin[1]) / cell)), int(np.ceil((z1 - origin[1]) / cell))
            grid[max(i0, 0):min(i1, shape[0]), max(j0, 0):min(j1, shape[1])] = True
        return grid

    radius = np.hypot(robot['width_m'], robot['depth_m']) / 2 + robot['margin_m']
    index = lambda p: tuple(int(v) for v in np.floor((np.array(p) - origin) / cell))
    plan = wu.plan_routes(~wu.inflate(occupied(before_objects), radius / cell), ~wu.inflate(occupied(after_objects), radius / cell),
                          index(ROUTE['start']), index(ROUTE['goal']))
    return plan['outcome']


def score(scenario, result):
    before, after = scenario.get('before', []), scenario['after']
    added = [o for o in after if key(o) not in {key(b) for b in before} and matters(o)]
    removed = [o for o in before if key(o) not in {key(a) for a in after} and matters(o)]
    grid = result['understand']['grid']
    candidates = result['understand']['candidates']
    out = {'scenario': scenario['name'], 'located': f"{result['observe']['located']}/{result['observe']['submitted']}",
           'registration_median_cm': round(100 * result['understand']['registration'].get('median_distance_m', np.nan), 1),
           'status': result['status'], 'elapsed_s': result['elapsed_seconds']}
    by_class = {}
    for c in candidates:
        by_class.setdefault(c['class'], []).append(c)
    found, false_added = [], []
    changes = [c for c in candidates if c['class'] != 'removed']  # anything proposed as an obstacle
    for c in changes:
        points = cells_of(c, grid, 'cells')
        hits = [o for o in added if overlap(points, o, .15)]
        if hits:
            found.append(c['id'])
        elif c['class'] in ('added', 'occluder'):  # a newly observed wall strip is coverage, not a false change
            false_added.append(c['id'])
    out['added_true'] = len(added)
    out['added_found'] = sum(1 for o in added if any(overlap(cells_of(c, grid, 'cells'), o, .15) for c in changes))
    out['added_false'] = len(false_added)
    out['added_coverage'] = [None if (v := coverage(changes, grid, o)) is None else round(v, 2) for o in added]
    out['occluders'] = len(by_class.get('occluder', []))
    out['found_as'] = sorted({c['class'] for c in changes if any(overlap(cells_of(c, grid, 'cells'), o, .15) for o in added)})
    out['removed_true'] = len(removed)
    out['removed_found'] = sum(1 for o in removed if any(overlap(cells_of(c, grid, 'cells'), o, .15) for c in by_class.get('removed', [])))
    out['removed_false'] = sum(1 for c in by_class.get('removed', []) if not any(overlap(cells_of(c, grid, 'cells'), o, .15) for o in removed))
    out['newly_observed'] = len(by_class.get('newly_observed', []))
    robots = []
    for plan, robot in zip(result['adapt']['robots'], ROBOTS):
        expected = truth_outcome(robot, before, after)
        route = plan['after'] or plan['before']
        margin = None
        if route and plan['after']:
            margin = round(ws.clearance(plan['after']['waypoints'], ws.solids(after, robot['height_m'])) - plan['clearance_radius_m'], 3)
        robots.append({'id': robot['id'], 'outcome': plan['outcome'], 'truth': expected,
                       'clearance_margin_m': margin, 'safe': margin is None or margin >= -.1})
    out['robots'] = robots
    return out


def asis_room(root, kind, before, cache):
    name = f"{kind}-{'-'.join(str(abs(hash(key(o)))) for o in before) or 'empty'}"
    if name not in cache:
        from robotics.world_worker import sparse_colmap as sc
        request = ws.Scene().before_capture(root / 'asis' / name, objects=before, rich=kind == 'rich')
        sc.run(request)
        cache[name] = Path(request['output_dir']).parent
    return cache[name]


def run(out, only=None):
    out.mkdir(parents=True, exist_ok=True)
    scene, cache, rows = ws.Scene(), {}, []
    request = {'schema': wu.REQUEST_SCHEMA, 'robots': ROBOTS, 'route': ROUTE}
    for number, scenario in enumerate(SCENARIOS):
        if only and scenario['name'] not in only:
            continue
        started = time.monotonic()
        source = asis_room(out, scenario.get('asis', 'level'), scenario.get('before', []), cache)
        degrade = dict(scenario.get('degrade', {}))
        frames, centres = scene.walk(out / f'walk-{number:02d}', scenario.get('walk', WALK), scenario['after'], **degrade)
        result = wu.run(source, frames, request, out / f'update-{number:02d}')
        row = score(scenario, result)
        errors = [np.linalg.norm(np.array(f['camera_center_model']) - c) for f, c in zip(result['observe']['frames'], centres)
                  if f.get('camera_center_model')]
        row['max_location_error_cm'] = round(100 * max(errors), 2) if errors else None
        row['total_s'] = round(time.monotonic() - started, 1)
        rows.append(row)
        print(json.dumps(row), flush=True)
    (out / 'sweep.json').write_text(json.dumps(rows, indent=1))
    (out / 'sweep.md').write_text(table(rows))
    return rows


def table(rows):
    lines = ['| Scenario | Placed | Change found (as) | False change | Removal found | Coverage | robot-a | robot-b | Safe |',
             '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for r in rows:
        robots = {x['id']: x for x in r['robots']}
        show = lambda x: x['outcome'] + ('' if x['outcome'] == x['truth'] else f" (truth: {x['truth']})")
        found_as = f" ({', '.join(r['found_as'])})" if r.get('found_as') else ''
        lines.append(f"| {r['scenario']} | {r['located']} | {r['added_found']}/{r['added_true']}{found_as} | {r['added_false']} | "
                     f"{r['removed_found']}/{r['removed_true']} | {', '.join(str(c) for c in r['added_coverage']) or '-'} | "
                     f"{show(robots['robot-a'])} | {show(robots['robot-b'])} | "
                     f"{'yes' if all(x['safe'] for x in r['robots']) else 'NO'} |")
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()
    run(args.out, args.only)
