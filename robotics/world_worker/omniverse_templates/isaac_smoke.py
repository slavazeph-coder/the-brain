"""Run with Isaac Sim's python.sh. Bounded CPU-physics smoke, not a robot trial."""
from pathlib import Path
import argparse,json,time
from verify_pack import verify
p=argparse.ArgumentParser();p.add_argument('--steps',type=int,default=120);p.add_argument('--out',type=Path,required=True)
a=p.parse_args()
if not 1<=a.steps<=600:p.error('steps must be between 1 and 600')
root=Path(__file__).parent.resolve()
if a.out.resolve().is_relative_to(root):p.error('Write the result outside the immutable package')
verify(root)
from isaacsim import SimulationApp
app=SimulationApp({'headless':True})
try:
    import omni.usd
    from isaacsim.core.api import SimulationContext
    from pxr import Usd,UsdGeom,UsdPhysics
    import numpy as np
    omni.usd.get_context().open_stage(str(root/'world.usda'))
    for _ in range(10):app.update()
    stage=omni.usd.get_context().get_stage()
    if stage is None:raise RuntimeError('Isaac Sim did not open world.usda')
    sim=SimulationContext(physics_dt=1/60,rendering_dt=1/60,backend='numpy',device='cpu')
    sim.get_physics_context().enable_gpu_dynamics(False)
    sim.initialize_physics();sim.play();start=time.monotonic()
    for _ in range(a.steps):sim.step(render=False)
    sim.stop()
    prims=list(Usd.PrimRange(stage.GetPseudoRoot(),Usd.TraverseInstanceProxies()))
    finite=all(np.isfinite(np.asarray(UsdGeom.Xformable(x).ComputeLocalToWorldTransform(Usd.TimeCode.Default()))).all() for x in prims if x.IsA(UsdGeom.Xformable))
    result={'schema':'brainsnn.isaac-smoke.v1','steps_executed':a.steps,'physics_device':'cpu',
            'finite_usd_transforms':bool(finite),'authored_colliders':sum(x.HasAPI(UsdPhysics.CollisionAPI) for x in prims),
            'elapsed_seconds':time.monotonic()-start,'rendering_tested':False,'metric_verified':False,
            'physics_ready':False,'policy_executed':False,
            'limitations':['Finite USD transforms are not a collision/contact or real-world dynamics validation.']}
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    if not finite:raise RuntimeError('Non-finite transforms after stepping')
finally:app.close()
