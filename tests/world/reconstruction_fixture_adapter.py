"""Reconstruction transport fixture for browser tests: writes realtosim_browser_smoke's synthetic room as
sparse-preview.ply and reconstruction.json. No COLMAP runs, so it exercises the hand-off, never a reconstruction."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from realtosim_browser_smoke import K, fixture  # noqa: E402

parser = argparse.ArgumentParser(); parser.add_argument('--input-manifest', required=True)
request = json.loads(Path(parser.parse_args().input_manifest).read_text())
out = Path(request['output_dir']); out.mkdir(parents=True, exist_ok=True)
ply, evidence = fixture()
# The hand-off of an estimated scale, so the site's straight-to-map path runs. No depth model ran: the value is the
# fixture room's true scale read 8% high (as the real estimate read on ETH3D), and the model record says it is a stand-in.
evidence = json.loads(evidence)
evidence['scale_estimate'] = {'status': 'estimated', 'metres_per_unit': round(1.08 / K, 6), 'frames_used': 10,
                              'model': {'repo': 'transport-fixture', 'base_model': 'transport fixture, no model ran'},
                              'measured': False, 'metric_verified': False}
(out / 'sparse-preview.ply').write_bytes(ply)
(out / 'reconstruction.json').write_text(json.dumps(evidence))
(out / 'manifest.json').write_text(json.dumps({'artifacts': [
    {'name': 'sparse-preview.ply', 'kind': 'visual', 'representation': 'point-cloud', 'coordinate_frame': 'colmap', 'units': 'arbitrary'},
    {'name': 'reconstruction.json', 'kind': 'evidence'}]}))
