"""Original mechanical example: two segments, one hinge and one muscle path.

This is an authored educational mechanism, not a measured person or anatomy.
No third-party motion/model dataset is bundled or copied.
"""
from __future__ import annotations
import json
from pathlib import Path


def write_example(directory: Path):
    import opensim as osim
    osim.Logger.removeFileSink()
    directory.mkdir(parents=True, exist_ok=True)
    model = osim.Model()
    model.setName('authored_hinge_and_muscle')
    model.setGravity(osim.Vec3(0, -9.80665, 0))
    upper = osim.Body('upper_segment', 1, osim.Vec3(0, -.25, 0), osim.Inertia(.02, .02, .02))
    lower = osim.Body('lower_segment', 2, osim.Vec3(0, -.5, 0), osim.Inertia(1 / 6, 1 / 6, 1 / 6))
    fixed = osim.WeldJoint('fixed_anchor', model.getGround(), osim.Vec3(0, 1, 0), osim.Vec3(0),
                           upper, osim.Vec3(0), osim.Vec3(0))
    knee = osim.PinJoint('hinge', upper, osim.Vec3(0, -.5, 0), osim.Vec3(0),
                        lower, osim.Vec3(0), osim.Vec3(0))
    coordinate = knee.updCoordinate()
    coordinate.setName('knee_angle_r')
    coordinate.setRangeMin(-1.5); coordinate.setRangeMax(1.5)
    coordinate.setDefaultValue(.35)
    for body in (upper, lower): model.addBody(body)
    for joint in (fixed, knee): model.addJoint(joint)
    muscle = osim.Millard2012EquilibriumMuscle('authored_flexor', 500, .6, .2, 0)
    muscle.addNewPathPoint('origin', upper, osim.Vec3(-.2, -.1, 0))
    muscle.addNewPathPoint('insertion', lower, osim.Vec3(.1, -.8, 0))
    model.addForce(muscle)
    model.finalizeConnections()
    model.printToXML(str(directory / 'authored-pendulum.osim'))
    times = [i / 30 for i in range(31)]
    rows = ['authored_hinge', 'nRows=31', 'nColumns=2', 'inDegrees=no', 'endheader', 'time\tknee_angle_r']
    rows.extend(f'{time:.12g}\t{.35 + .2 * time + .1 * time**2:.12g}' for time in times)
    (directory / 'authored-motion.mot').write_text('\n'.join(rows) + '\n')
    options = {'schema': 'brainsnn.biomechanics-options.v1', 'analysis': 'kinematics',
               'model_up_axis': 'Y', 'length_units': 'm', 'moment_arm_coordinates': ['knee_angle_r']}
    (directory / 'kinematics-options.json').write_text(json.dumps(options, indent=2) + '\n')
    options.update(analysis='inverse-dynamics', external_loads='none-declared',
                   no_external_loads_reason='Authored anchored pendulum; no floor contact or applied load. Gravity is included.')
    (directory / 'inverse-dynamics-options.json').write_text(json.dumps(options, indent=2) + '\n')
    loads = {'schema': 'brainsnn.biomechanics-loads.v1', 'coordinate_frame': 'ground', 'time_s': times,
             'loads': [{'body': 'lower_segment', 'force_N': [[2, 3, 0] for _ in times],
                        'point_m': [[0, -.4, 0] for _ in times], 'torque_Nm': [[0, 0, .4] for _ in times]}]}
    (directory / 'authored-loads.json').write_text(json.dumps(loads, indent=2) + '\n')
    return directory


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    write_example(parser.parse_args().out)
