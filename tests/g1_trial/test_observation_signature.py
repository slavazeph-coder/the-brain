"""Exercise the actual nested wrapper signature without an Isaac/GPU runtime."""
import ast
import copy
from functools import wraps
import inspect
from pathlib import Path
import unittest

RUNNER = Path(__file__).resolve().parents[2] / 'robotics/g1_trial/isaac_runner.py'


def upstream_scan(env, sensor_cfg, scan_resolution=0.05, scan_size=(1.6, 1.0),
                  patch_size=7, xy_drift_range=(0.0, 0.0), z_drift_range=(0.0, 0.0),
                  bootstrap_footholds=((0.0, 0.1), (0.0, -0.1)), train_fpm=True,
                  force_model=False, fpm_kwargs=None):
    """Signature fixture from pinned ETH fpm/mdp/observations.py; not inference."""


def wrapper():
    parsed = ast.parse(RUNNER.read_text())
    functions = [n for n in ast.walk(parsed)
                 if isinstance(n, ast.FunctionDef) and n.name == 'guarded_scan']
    if len(functions) != 1:
        raise AssertionError('Expected exactly one production terrain wrapper')
    node = copy.deepcopy(functions[0])
    namespace = {'wraps': wraps, 'foothold_scan': upstream_scan}
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    exec(compile(module, str(RUNNER), 'exec'), namespace)
    return namespace['guarded_scan']


class ObservationSignatureTests(unittest.TestCase):
    def test_actual_production_wrapper_preserves_inspectable_parameters(self):
        guarded = wrapper()
        self.assertEqual(inspect.signature(guarded), inspect.signature(upstream_scan))
        self.assertIs(guarded.__wrapped__, upstream_scan)
        self.assertNotIn('kwargs', inspect.signature(guarded).parameters)

    def test_configured_scan_parameters_bind(self):
        bound = inspect.signature(wrapper()).bind(
            object(), sensor_cfg=object(), scan_resolution=.05, scan_size=(1.6, 1.0),
            patch_size=7, xy_drift_range=(0., 0.), z_drift_range=(0., 0.),
            train_fpm=False, force_model=True)
        self.assertIn('sensor_cfg', bound.arguments)
        self.assertEqual(bound.arguments['patch_size'], 7)

    def test_missing_or_unknown_configuration_cannot_be_hidden_by_kwargs(self):
        signature = inspect.signature(wrapper())
        with self.assertRaises(TypeError):
            signature.bind(object())
        with self.assertRaises(TypeError):
            signature.bind(object(), sensor_cfg=object(), accidental_parameter=1)


if __name__ == '__main__':
    unittest.main()
