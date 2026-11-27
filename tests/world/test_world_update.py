"""One robot sees, another adapts: the world-update loop on a rendered room whose truth is authored.

Robot A's camera (a phone today) scans the as-is room, then walks it again after a crate was set down in the aisle.
The walk must be located in the as-is scan, the crate found as an added obstacle (seen empty before), the update
proposed for review and never applied, and robots of different sizes rerouted around it. A second walk of the
unchanged room must propose no change and leave every route alone.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest

from robotics.world_worker import world_update as wu

HERE = Path(__file__).resolve().parent
PLAN_FIXTURE = HERE / 'fixtures' / 'world-update-plan.json'
# world-update-plan.test.mjs retains these bytes as the as-is revision's source, standing in for reconstruction.json.
AS_IS_SCAN = b'As-is scan record (authored fixture).\n'
ROBOTS = [{'id': 'robot-a', 'model': 'Small AMR (0.45 m square)', 'width_m': .45, 'depth_m': .45, 'height_m': .6, 'margin_m': .05},
          {'id': 'robot-b', 'model': 'Cart AMR (0.7 x 0.8 m)', 'width_m': .7, 'depth_m': .8, 'height_m': .75, 'margin_m': .08}]
REQUEST = {'schema': wu.REQUEST_SCHEMA, 'observer': {'id': 'robot-a', 'model': 'Phone camera standing in for robot A'},
           'robots': ROBOTS, 'route': {'start': [0, .6], 'goal': [0, 3.2]}}


# ---------------------------------------------------------------- units (no reconstruction needed)

@pytest.mark.parametrize('mutate,message', [
    (lambda r: r.update(schema='other'), 'schema'),
    (lambda r: r.update(robots=[]), 'robots'),
    (lambda r: r['robots'].append(dict(r['robots'][0])), 'unique'),
    (lambda r: r['robots'][0].update(id='Robot A'), 'lower-case'),
    (lambda r: r['robots'][0].update(width_m=0), 'width_m'),
    (lambda r: r['robots'][0].update(height_m=float('nan')), 'height_m'),
    (lambda r: r['robots'][0].update(speed=1), 'unsupported'),
    (lambda r: r.update(route={'start': [0, 0]}), 'goal'),
    (lambda r: r.update(route={'start': [0, 0, 0], 'goal': [1, 1]}), 'route.start'),
    (lambda r: r.update(site_frame={'up': [0, 0, 0]}), 'zero'),
    (lambda r: r.update(extra=True), 'unsupported'),
    (lambda r: r.update(assumed_depth_m=-1), 'assumed_depth_m'),
    (lambda r: r.update(min_obstacle_height_m=.01), 'min_obstacle_height_m'),
])
def test_request_is_validated_before_any_work(mutate, message):
    request = json.loads(json.dumps(REQUEST))
    mutate(request)
    with pytest.raises(ValueError, match=message):
        wu.read_request(request)


def test_request_defaults_route_to_the_walk_and_keeps_robot_sizes():
    request = json.loads(json.dumps(REQUEST))
    del request['route'], request['observer']
    checked = wu.read_request(request)
    assert checked['route'] == {'from': 'walk'} and checked['observer']['id'] == 'robot-a'
    assert checked['robots'][1]['depth_m'] == .8 and checked['robots'][0]['margin_m'] == .05


@pytest.mark.parametrize('dim,radius', [(2, 12.), (3, .1)])
def test_neighbour_pairs_are_exact(dim, radius):
    rng = np.random.default_rng(dim)
    query, reference = rng.uniform(0, 10 * radius, (300, dim)), rng.uniform(0, 10 * radius, (500, dim))
    qi, ri, d = wu.pairs_within(query, reference, radius)
    brute = np.linalg.norm(query[:, None] - reference[None], axis=2)
    expected = set(zip(*np.nonzero(brute <= radius)))
    assert set(zip(qi.tolist(), ri.tolist())) == {(int(a), int(b)) for a, b in expected}
    assert np.allclose(d, brute[qi, ri])


def test_floor_is_the_lowest_populated_level_not_the_lowest_point():
    rng = np.random.default_rng(3)
    heights = np.concatenate([rng.normal(-1.5, .005, 400), rng.uniform(-1.4, 1.5, 2000), [-9., -8.5]])
    assert wu.floor_level(heights) == pytest.approx(-1.5, abs=.01)


def corridor(width=20, length=40):
    occupied = np.zeros((width, length), dtype=bool)
    occupied[0, :] = occupied[-1, :] = True
    return occupied


@pytest.mark.parametrize('block,radius,outcome', [
    (None, 2, 'unchanged'),
    ((slice(4, 12), slice(18, 22)), 2, 'rerouted'),   # a crate leaves a gap on one side
    ((slice(1, 19), slice(18, 22)), 2, 'blocked'),    # wall to wall
    ((slice(7, 12), slice(18, 22)), 2.5, 'unchanged'),  # beside the path, outside this footprint's reach
])
def test_routes_adapt_to_each_robot_footprint(block, radius, outcome):
    before = corridor()
    after = before.copy()
    if block:
        after[block] = True
    plan = wu.plan_routes(~wu.inflate(before, radius), ~wu.inflate(after, radius), (3, 2), (3, 37))
    assert plan['outcome'] == outcome
    if outcome == 'rerouted':
        assert all(not wu.inflate(after, radius)[cell] for cell in plan['after'])
        assert wu.route_length(plan['after']) > wu.route_length(plan['before'])


def test_a_removal_that_opens_a_shorter_way_is_reported_as_shortened():
    before = corridor()
    before[6:14, 18:22] = True  # a crate mid-corridor: the way round it hugs a wall
    after = corridor()
    plan = wu.plan_routes(~wu.inflate(before, 2), ~wu.inflate(after, 2), (10, 2), (10, 37))
    assert plan['outcome'] == 'shortened' and wu.route_length(plan['after']) < wu.route_length(plan['before'])
    same = wu.plan_routes(~wu.inflate(before, 2), ~wu.inflate(before, 2), (10, 2), (10, 37))
    assert same['outcome'] == 'unchanged'


def test_a_hidden_ray_that_crosses_a_known_change_is_explained_and_dropped():
    grid = wu.Grid(np.array([[0., 0.], [3., .8]]), .1)
    flat = lambda p: p[:, [0, 2]]
    everywhere = lambda p: np.ones(len(p), dtype=bool)
    origin, targets = np.array([.05, 0., .15]), np.array([[2.8, 0., .15], [2.8, 0., .65]])
    rays, cells = wu.ray_cells(grid, origin, targets, flat, everywhere, .05, .1)
    assert set(rays.tolist()) == {0, 1} and len(cells) > 40
    known = np.zeros(grid.shape, dtype=bool)
    known[tuple(grid.index(np.array([[1.25, .15]]))[0])] = True  # crossed by the first ray only
    rays, _ = wu.ray_cells(grid, origin, targets, flat, everywhere, .05, .1, known)
    assert set(rays.tolist()) == {1}


def test_a_robot_with_no_route_before_is_reported_as_such():
    before = corridor()
    before[:, 20] = True
    plan = wu.plan_routes(~before, ~before, (5, 2), (5, 37))
    assert plan == {'outcome': 'no-route-before', 'before': None, 'after': None}


def test_an_old_route_is_kept_only_if_its_diagonal_steps_still_clear_every_corner():
    free = np.ones((5, 5), bool)
    assert wu.astar(free, (1, 1), (3, 3)) == [(1, 1), (2, 2), (3, 3)]
    after = free.copy()
    after[2, 1] = False  # beside the first diagonal step; every cell of the old route stays free
    plan = wu.plan_routes(free, after, (1, 1), (3, 3))
    assert plan['outcome'] == 'rerouted' and plan['after'] != plan['before']
    assert wu.path_free(after, plan['after']) and not wu.path_free(after, plan['before'])
    # Both corners of the only diagonal blocked: the old cells are free, but nothing can pass.
    tight = np.ones((2, 2), bool)
    closed = tight.copy()
    closed[0, 1] = closed[1, 0] = False
    assert wu.plan_routes(tight, closed, (0, 0), (1, 1)) == {'outcome': 'blocked', 'before': [(0, 0), (1, 1)], 'after': None}


def test_simplified_route_keeps_clear_lines():
    free = ~wu.inflate(np.pad(np.ones((6, 4), dtype=bool), ((7, 7), (18, 18))), 1)
    path = wu.astar(free, (1, 1), (18, 38))
    waypoints = wu.simplify(path, free)
    assert waypoints[0] == path[0] and waypoints[-1] == path[-1] and len(waypoints) < len(path)
    assert all(wu.line_free(free, a, b) for a, b in zip(waypoints, waypoints[1:]))


def synthetic_result():
    """A small, authored world update: the shape world_update.py produces, without a reconstruction."""
    return {'schema': wu.SCHEMA, 'observer': REQUEST['observer'], 'observe': {'located': 4, 'submitted': 4},
            'thresholds': dict(wu.THRESHOLDS),
            'understand': {'candidates': [{'id': 'candidate-1', 'class': 'added', 'points': 1200, 'points_seen_empty_before': 400,
                                           'footprint_m': {'across': [-.9, .3], 'along': [1.9, 2.0]}, 'footprint_area_m2': .26,
                                           'height_m': [.09, .8], 'cells': [[10, 20], [11, 20]], 'assumed_depth_m': .5,
                                           'assumed_cells': [[10, 21], [11, 21]], 'assumed_area_m2': .02}]},
            'adapt': {'route': {'start_m': [0, .6], 'goal_m': [0, 3.2], 'from': 'request'},
                      'robots': [{'id': r['id'], 'model': r['model'], 'footprint_m': [r['width_m'], r['depth_m']], 'height_m': r['height_m'],
                                  'margin_m': r['margin_m'], 'outcome': 'rerouted', 'before': {'length_m': 2.6}, 'after': {'length_m': 3.1}}
                                 for r in ROBOTS]},
            'source': {'reconstruction': 'authored-job', 'reconstruction_sha256': hashlib.sha256(AS_IS_SCAN).hexdigest()},
            'authored_fixture': 'Software fixture: no capture, robot or measurement.'}


def test_request_plan_records_evidence_on_the_as_is_revision_and_one_change_per_robot():
    result = synthetic_result()
    text = json.dumps(result, indent=1)
    plan = wu.project_requests(result, text)
    actions = [step['action'] for step in plan['steps']]
    assert actions == ['addSource', 'addEvidence', 'createRevision', 'createChange', 'createRevision', 'createChange']
    source = plan['steps'][0]['body']
    assert source['content_text'] == text and source['sha256'] == plan['source_sha256']
    evidence = plan['steps'][1]['body']
    assert evidence['revision_id'] == '$as_is' and evidence['kind'] == 'observed' and evidence['source_id'] == '$source'
    assert 'seen empty in the as-is scan' in evidence['claim']
    for revision, change in zip(plan['steps'][2::2], plan['steps'][3::2]):
        assert revision['body']['kind'] == 'proposed' and revision['body']['parent_revision_id'] == '$as_is'
        assert change['body']['proposed_revision_id'] == '$' + revision['ref'] and change['body']['evidence_ids'] == ['$evidence-candidate-1']
        assert 'approve' in change['body']['reason']
    assert all('expected_version' not in step['body'] for step in plan['steps'])  # read when each step runs
    assert plan['as_is_scan'] == {'name': 'reconstruction.json', 'sha256': hashlib.sha256(AS_IS_SCAN).hexdigest()}
    # The Node test applies this exact plan to the World Project service; keep the committed copy in step.
    assert json.loads(PLAN_FIXTURE.read_text()) == plan, 'Regenerate tests/world/fixtures/world-update-plan.json'


def test_no_candidate_means_nothing_to_propose_and_oversized_updates_are_refused():
    result = synthetic_result()
    result['understand']['candidates'] = []
    plan = wu.project_requests(result, '{}')
    assert plan['steps'] == [] and 'nothing is proposed' in plan['note']
    with pytest.raises(ValueError, match='512 KiB'):
        wu.project_requests(synthetic_result(), 'x' * (wu.MAX_SOURCE_BYTES + 1))


# ---------------------------------------------------------------- the loop on rendered walks

@pytest.fixture(scope='module')
def room(tmp_path_factory):
    pytest.importorskip('pycolmap')
    from robotics.world_worker import sparse_colmap as sc
    from world_update_scene import Scene
    root = tmp_path_factory.mktemp('world-update')
    scene = Scene()
    request = scene.before_capture(root / 'as-is')
    reconstruction = sc.run(request)
    assert reconstruction['native_capture']['alignment']['applied']
    return scene, root, Path(request['output_dir']).parent


def distance_to_box(point, box):
    """Floor distance from (across, along) to the crate's rectangle."""
    dx = max(box['x'][0] - point[0], 0, point[0] - box['x'][1])
    dz = max(box['z'][0] - point[1], 0, point[1] - box['z'][1])
    return math.hypot(dx, dz)


def route_clearance(waypoints, box):
    samples = [np.add(a, np.multiply(np.subtract(b, a), t)) for a, b in zip(waypoints, waypoints[1:]) for t in np.linspace(0, 1, 50)]
    return min(distance_to_box(p, box) for p in samples)


def test_one_robot_sees_a_new_crate_and_robots_of_other_sizes_reroute(room):
    from world_update_scene import CRATE
    scene, root, source = room
    frames, centres = scene.after_walk(root / 'walk', crate=True)
    out = root / 'update'
    result = wu.run(source, frames, REQUEST, out)

    # Observe: every walk frame is placed in the as-is scan, within 5 cm of where it was taken.
    assert result['observe']['located'] == 4
    for record, truth in zip(result['observe']['frames'], centres):
        assert np.linalg.norm(np.array(record['camera_center_model']) - truth) < .05
    registration = result['understand']['registration']
    assert registration['median_distance_m'] < .02 and registration['on_as_is_model'] > 1000

    # Understand: the crate is one "added" candidate (seen empty before, occupied now) across its true width.
    added = [c for c in result['understand']['candidates'] if c['class'] == 'added']
    assert len(added) == 1, result['understand']['candidates']
    crate = added[0]
    assert crate['footprint_m']['across'][0] == pytest.approx(CRATE['x'][0], abs=.1)
    assert crate['footprint_m']['across'][1] == pytest.approx(CRATE['x'][1], abs=.1)
    assert CRATE['z'][0] - .1 <= crate['footprint_m']['along'][0] and crate['footprint_m']['along'][1] <= CRATE['z'][1] + .1
    assert crate['height_m'][1] > .6 and crate['points_seen_empty_before'] >= wu.THRESHOLDS['min_added_points']
    # The walk saw the crate's front; the unseen space behind it is assumed occupied, so its true footprint is covered.
    grid = result['understand']['grid']
    covered = {tuple(c) for c in crate['cells'] + crate['assumed_cells']}
    truth = {(i, j) for i in range(grid['shape'][0]) for j in range(grid['shape'][1])
             if CRATE['x'][0] + .05 < grid['origin_m'][0] + (i + .5) * grid['cell_m'] < CRATE['x'][1] - .05
             and CRATE['z'][0] + .05 < grid['origin_m'][1] + (j + .5) * grid['cell_m'] < CRATE['z'][1] - .05}
    assert len(truth & covered) >= .9 * len(truth), (len(truth & covered), len(truth))
    assert crate['assumed_area_m2'] <= 1.5 * crate['assumed_depth_m'] * (CRATE['x'][1] - CRATE['x'][0])
    for other in result['understand']['candidates']:
        if other is crate:
            continue
        if other['class'] == 'occluder':  # unseen space directly behind the crate may be flagged as hidden, never in front
            assert other['footprint_m']['along'][0] >= CRATE['z'][0] - .1
        else:  # whatever else the tilted walk saw first (wall strips) is coverage, away from the crate
            assert other['class'] == 'newly_observed'
            assert other['footprint_m']['across'][0] > CRATE['x'][1] + .5 or other['footprint_m']['across'][1] < CRATE['x'][0] - .5

    # Remember: proposed for review, never applied.
    assert result['status'] == 'change-detected'
    assert result['remember']['status'] == 'proposed' and result['remember']['applied'] is False and result['remember']['requires_review']
    assert result['policy_executed'] is False and result['physical_validated'] is False and result['metric_verified'] is False

    # Adapt: the straight route ran through the crate; each robot now passes it with its own clearance.
    box = {'x': CRATE['x'], 'z': CRATE['z']}
    for robot in result['adapt']['robots']:
        assert robot['outcome'] == 'rerouted' and robot['changed_by'] == [crate['id']]
        assert route_clearance(robot['before']['waypoints'], box) == 0
        assert route_clearance(robot['after']['waypoints'], box) >= robot['clearance_radius_m'] - wu.THRESHOLDS['cell_m']
        assert robot['after']['length_m'] > robot['before']['length_m']
        assert 0 <= robot['after']['unobserved_fraction'] <= 1
    small, large = result['adapt']['robots']
    assert large['clearance_radius_m'] > small['clearance_radius_m']

    # Share: each adapted route is a proposal that waits for its change to be approved.
    assert [s['robot_id'] for s in result['share']] == ['robot-a', 'robot-b']
    assert all(s['status'] == 'proposed' and s['requires_review'] and s['route'] for s in result['share'])

    # Files: the record, the World Project plan bound to its exact bytes, and the plan view.
    text = (out / 'world-update.json').read_text()
    plan = json.loads((out / 'project-requests.json').read_text())
    assert plan['steps'][0]['body']['content_text'] == text
    assert [s['action'] for s in plan['steps']].count('createChange') == 2
    svg = (out / 'world-update.svg').read_text()
    assert svg.startswith('<svg') and 'robot-b: rerouted' in svg
    assert {a['name'] for a in json.loads((out / 'manifest.json').read_text())['artifacts']} == {
        'world-update.json', 'project-requests.json', 'world-update.svg'}


def test_an_unchanged_room_proposes_no_change_and_keeps_every_route(room):
    scene, root, source = room
    frames, _ = scene.after_walk(root / 'control-walk', crate=False)
    result = wu.run(source, frames, REQUEST, root / 'control')
    assert result['observe']['located'] == 4
    assert not [c for c in result['understand']['candidates'] if c['class'] in ('added', 'removed', 'occluder')]
    assert result['status'] in ('no-change-detected', 'new-coverage-only')
    assert all(robot['outcome'] == 'unchanged' for robot in result['adapt']['robots'])


def test_a_frame_from_somewhere_else_is_reported_and_never_placed(room, tmp_path):
    from PIL import Image
    scene, root, source = room
    frames, _ = scene.after_walk(root / 'mixed-walk', crate=True, xs=(-.25, .25))
    stranger = tmp_path / 'elsewhere.png'
    Image.fromarray(np.random.default_rng(9).integers(0, 255, (600, 800, 3), dtype=np.uint8)).save(stranger)
    result = wu.run(source, [frames[0], stranger, frames[1]], REQUEST, tmp_path / 'out')
    placed = [frame['located'] for frame in result['observe']['frames']]
    assert placed == [True, False, True]
    assert 'reason' in result['observe']['frames'][1] and 'camera_center_model' not in result['observe']['frames'][1]


def test_an_unaligned_reconstruction_needs_a_declared_site_frame(room, tmp_path):
    import shutil
    _, root, source = room
    copy = tmp_path / 'job'
    shutil.copytree(source / 'colmap-work', copy / 'colmap-work')
    with pytest.raises(ValueError, match='up and scale are unknown'):
        wu.site_frame(copy, None)
    declared = wu.site_frame(copy, {'up': [0, -1, 0], 'metres_per_unit': 1.0})
    assert declared['basis'] == 'declared by the operator'
    with pytest.raises(ValueError, match='do not declare'):
        wu.site_frame(source, {'up': [0, 1, 0], 'metres_per_unit': 1.0})


def test_a_crate_walked_at_eye_level_still_blocks_a_shorter_robot(room):
    """Seen only from 1.5 m, the crate shows its upper strip (above the small robot). The space under that strip was
    never seen, so it is no gap to drive through: new geometry blocks every robot unless the floor beneath was seen."""
    from world_update_scene import CRATE
    scene, root, source = room
    frames, _ = scene.walk(root / 'level-walk', [{'centre': [x, 0., .2], 'pitch': 0.} for x in (-.75, -.25, .25, .75)], [CRATE])
    result = wu.run(source, frames, REQUEST, root / 'level-update')
    box = {'x': CRATE['x'], 'z': CRATE['z']}
    for robot in result['adapt']['robots']:
        assert robot['outcome'] in ('rerouted', 'blocked'), robot['outcome']
        if robot['after']:
            assert route_clearance(robot['after']['waypoints'], box) >= robot['clearance_radius_m'] - wu.THRESHOLDS['cell_m']


def test_a_plain_crate_without_features_is_found_by_what_it_hides(room):
    """A featureless crate gives the walk no points of its own; it is found because it hides the as-is scene behind it
    from every frame facing it. The whole hidden region is proposed as blocked until someone walks around it."""
    from world_update_scene import CRATE
    scene, root, source = room
    plain = {**CRATE, 'texture': None}
    frames, _ = scene.walk(root / 'plain-walk', [{'centre': [x, 0., .2], 'pitch': 15.} for x in (-.75, -.25, .25, .75)], [plain])
    result = wu.run(source, frames, REQUEST, root / 'plain-update')
    occluders = [c for c in result['understand']['candidates'] if c['class'] == 'occluder']
    assert occluders and result['status'] == 'change-detected'
    grid = result['understand']['grid']
    covered = {tuple(c) for c in occluders[0]['cells']}
    truth = {(i, j) for i in range(grid['shape'][0]) for j in range(grid['shape'][1])
             if CRATE['x'][0] + .05 < grid['origin_m'][0] + (i + .5) * grid['cell_m'] < CRATE['x'][1] - .05
             and CRATE['z'][0] + .05 < grid['origin_m'][1] + (j + .5) * grid['cell_m'] < CRATE['z'][1] - .05}
    assert len(truth & covered) >= .8 * len(truth), (len(truth & covered), len(truth))
    box = {'x': CRATE['x'], 'z': CRATE['z']}
    for robot in result['adapt']['robots']:
        assert robot['outcome'] in ('rerouted', 'blocked')
        if robot['after']:
            assert route_clearance(robot['after']['waypoints'], box) >= robot['clearance_radius_m'] - wu.THRESHOLDS['cell_m']
    plan = json.loads((root / 'plain-update' / 'project-requests.json').read_text())
    evidence = [s['body'] for s in plan['steps'] if s['action'] == 'addEvidence' and s['body']['component_id'] == occluders[0]['id']]
    assert evidence[0]['kind'] == 'inferred' and 'walk around it' in evidence[0]['claim']


@pytest.fixture(scope='module')
def crate_room(tmp_path_factory):
    """An as-is scan with a crate beside the aisle, taken with level and tilted frames."""
    pytest.importorskip('pycolmap')
    from robotics.world_worker import sparse_colmap as sc
    from world_update_scene import Scene, box
    left = box((-1.5, -.7), (2.0, 2.5), .8)
    root = tmp_path_factory.mktemp('world-update-crate')
    scene = Scene()
    request = scene.before_capture(root / 'as-is', objects=[left], rich=True)
    sc.run(request)
    return scene, root, Path(request['output_dir']).parent, left


def test_a_moved_crate_is_one_removal_and_one_addition(crate_room):
    from world_update_scene import CRATE
    scene, root, source, left = crate_room
    walk = [{'centre': [x, 0., .2], 'pitch': 15.} for x in (-.75, -.25, .25, .75)]
    frames, _ = scene.walk(root / 'moved-walk', walk, [CRATE])
    result = wu.run(source, frames, REQUEST, root / 'moved')
    by_class = {}
    for c in result['understand']['candidates']:
        by_class.setdefault(c['class'], []).append(c)
    removed, added = by_class.get('removed', []), by_class.get('added', [])
    assert len(removed) == 1 and len(added) == 1, {k: len(v) for k, v in by_class.items()}
    gone = removed[0]['footprint_m']
    assert left['x'][0] - .15 <= gone['across'][0] and gone['across'][1] <= left['x'][1] + .15
    assert left['z'][0] - .15 <= gone['along'][0] and gone['along'][1] <= left['z'][1] + .15
    assert added[0]['footprint_m']['across'][0] == pytest.approx(CRATE['x'][0], abs=.15)
    assert all(robot['outcome'] == 'rerouted' for robot in result['adapt']['robots'])
    plan = json.loads((root / 'moved' / 'project-requests.json').read_text())
    claims = [s['body']['claim'] for s in plan['steps'] if s['action'] == 'addEvidence']
    assert any('it is gone' in claim for claim in claims) and any('seen empty in the as-is scan' in claim for claim in claims)


def test_a_removed_crate_opens_a_shorter_route_and_an_unmoved_one_changes_nothing(crate_room):
    scene, root, source, left = crate_room
    # Tilted enough to see the floor where the crate stood: what the walk never looks past stays in the map.
    walk = [{'centre': [x, 0., .2], 'pitch': 25.} for x in (-.75, -.25, .25, .75)]
    request = {**REQUEST, 'route': {'start': [-1.1, .6], 'goal': [-1.1, 3.2]}}  # straight through where the crate stood
    frames, _ = scene.walk(root / 'removed-walk', walk, [])
    result = wu.run(source, frames, request, root / 'removed')
    assert [c['class'] for c in result['understand']['candidates'] if c['class'] in ('added', 'removed', 'occluder')] == ['removed']
    small, large = result['adapt']['robots']
    assert large['outcome'] == 'opened' and large['changed_by']  # it could not pass the crate at all before
    # The crate's base sits within 15 cm of the floor the walk now sees there, so it cannot be shown gone: it stays,
    # with its assumed depth, and the small robot keeps its way round (the safe side).
    assert small['outcome'] in ('shortened', 'unchanged')
    frames, _ = scene.walk(root / 'kept-walk', walk, [left])
    kept = wu.run(source, frames, request, root / 'kept')
    assert not [c for c in kept['understand']['candidates'] if c['class'] in ('added', 'removed', 'occluder')]
    assert all(robot['outcome'] in ('unchanged', 'no-route-before') for robot in kept['adapt']['robots'])
