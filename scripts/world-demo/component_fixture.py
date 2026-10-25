"""Authored software fixture, never a physical capture or measured result.

Usage: component_fixture.py cloud NEW_DIRECTORY
       component_fixture.py review INITIAL_SCENE CLOUD NEW_REVIEWED_CLOUD
       component_fixture.py edits REVIEWED_SCENE NEW_EDIT_CONTRACT
Compile with the existing explicit --allow-unverified experiment flag. No
reconstruction receipt, camera poses, multi-view evidence or measurements arise.
"""
import argparse
import copy
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.scene_compiler.component_graph import ensure_component_ids, scene_sha256
from robotics.world_worker.measurement_check import points_sha256
from robotics.world_worker.bim_review import validate_review


def room_cloud():
    points = []
    for ix in range(41):
        for iz in range(61): points.append([-2 + ix * .1, 0, -3 + iz * .1, 120, 110, 100])
    for iy in range(1, 28):
        for iz in range(61):
            for x in (-2, 2): points.append([x, iy * .1, -3 + iz * .1, 160, 170, 180])
        for ix in range(41):
            for z in (-3, 3): points.append([-2 + ix * .1, iy * .1, z, 160, 170, 180])
    return {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'coordinateFrame': 'right-handed-y-up',
        'sourceFrame': 'right-handed-y-up',
        'source': 'AUTHORED synthetic room fixture; not captured or measured; execution qualification only',
        'units': 'm', 'scale': {'source': 'user-measured', 'metresPerUnit': 1, 'distance': 4,
        'spanUnits': 4, 'selfReported': True, 'verified': False}, 'provenance': {'metricVerified': False},
        'floorEstimate': {'y': 0, 'units': 'm'}, 'points': points}

def read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024**2:
        raise ValueError('Inputs must be bounded regular JSON files.')
    value = json.loads(path.read_text()); scene_sha256(value)
    return value

def write(path, value):
    with path.open('x', encoding='utf-8') as stream: stream.write(json.dumps(value, allow_nan=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=('cloud', 'review', 'edits'))
    parser.add_argument('paths', nargs='+', type=Path)
    args = parser.parse_args()
    try:
        if len(args.paths) != {'cloud': 1, 'review': 3, 'edits': 2}[args.mode]:
            raise ValueError('Use the exact positional paths shown in --help.')
        cloud = room_cloud(); fingerprint = points_sha256(cloud)
        if args.mode == 'cloud':
            root = args.paths[0]; root.mkdir(parents=True, exist_ok=False)
            write(root / 'cloud.json', cloud)
            write(root / 'arbitrary-cloud.json', {**cloud, 'units': 'arbitrary', 'scale': None,
                                                 'floorEstimate': {'y': 0, 'units': 'arbitrary'}})
            print(f'{len(cloud["points"])} AUTHORED points; no physical capture or measurement.')
            return
        scene = ensure_component_ids(read(args.paths[0]))
        if scene.get('cloudPointsSha256') != fingerprint:
            raise ValueError('Use a compiled scene from this exact authored fixture.')
        if args.mode == 'review':
            if json.dumps(read(args.paths[1]), sort_keys=True) != json.dumps(cloud, sort_keys=True):
                raise ValueError('Use the original authored fixture cloud.')
            wall = max(scene['walls'], key=lambda item: item['size'][0])
            opening = {'id': 'authored-entry', 'hostWall': wall['name'], 'offsetMeters': 1, 'widthMeters': 1,
                'heightMeters': 2.1, 'sillMeters': 0, 'kind': 'opening', 'reviewed': True,
                'host': {key: copy.deepcopy(wall[key]) for key in ('centre', 'size', 'yaw_degrees')}}
            cloud['bimReview'] = validate_review({'schema': 'brainsnn.bim-review.v1',
                'cloudPointsSha256': fingerprint, 'openings': [opening]}, cloud)
            write(args.paths[2], cloud)
        else:
            write(args.paths[1], {'schema': 'brainsnn.component-edits.v1', 'sourceSha256': fingerprint,
                'sceneSha256': scene_sha256(scene), 'revision': scene['componentGraph']['revision'], 'edits': [
                {'op': 'wall', 'componentId': scene['walls'][0]['componentId'], 'translationMeters': [.1, 0, 0]},
                {'op': 'opening', 'componentId': scene['openings'][0]['componentId'], 'widthMeters': 1.1}]})
    except (ValueError, OSError, KeyError, IndexError, TypeError) as error: parser.exit(2, f'REFUSED: {error}\n')
if __name__ == '__main__': main()
