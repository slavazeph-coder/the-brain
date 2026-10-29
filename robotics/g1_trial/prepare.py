"""Flatten explicitly selected source geometry into ONE static, Z-up triangle mesh."""
from __future__ import annotations
import math
from pathlib import Path
from .contracts import read_json, sha256, validate, write_json, y_to_z

# Outward-wound unit cube faces; selected USD Cube size and complete world matrix are applied.
CUBE_POINTS = [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]
CUBE_FACES = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(3,7,6),(3,6,2),(0,4,7),(0,7,3),(1,2,6),(1,6,5)]


def prepare(pack_root, spec_path, output):
    from pxr import Gf, Usd, UsdGeom, UsdPhysics, UsdShade
    from robotics.world_worker.omniverse_templates.verify_pack import verify
    from robotics.world_worker.omniverse_pack import audit_dependencies
    root, out = Path(pack_root).resolve(), Path(output).resolve()
    if out.is_relative_to(root) or out.exists():
        raise ValueError('Choose a new output directory outside the immutable pack')
    spec = read_json(Path(spec_path)); validate(spec)
    verify(root)  # Executes our repository verifier, never scripts supplied by a pack.
    source = root/'source'
    for name, expected in spec['source_sha256'].items():
        if sha256(source/name) != expected:
            raise ValueError('Source artifact changed since review')
    cloud = read_json(source/'arena-cloud.json', 64*1024**2); validate(spec, cloud)
    scene = read_json(source/'scene.json', 16*1024**2)
    if scene.get('schema') != 'brainsnn.scene.v1' or scene.get('units') != 'm':
        raise ValueError('An existing metric BrainSNN scene is required')
    audit_dependencies(source/'scene.usda', source)
    stage = Usd.Stage.Open(str(source/'scene.usda'))
    if not stage or stage.GetCompositionErrors() or not stage.HasAuthoredMetadata('metersPerUnit') or UsdGeom.GetStageMetersPerUnit(stage) != 1 or not stage.HasAuthoredMetadata('upAxis') or UsdGeom.GetStageUpAxis(stage) != 'Y':
        raise ValueError('Explicit metre Y-up USD source required')
    cache = UsdGeom.XformCache(); vertices = []; faces = []; counts = []
    for path in spec['collision_prims']:
        prim = stage.GetPrimAtPath(path)
        if not prim or not prim.IsActive() or not prim.IsDefined():
            raise ValueError('Selected collision primitive is absent')
        parent = prim
        while parent and not parent.IsPseudoRoot():
            if parent.HasAPI(UsdPhysics.RigidBodyAPI) or any(a.GetNumTimeSamples() for a in parent.GetAttributes()):
                raise ValueError('Animated or rigid-body geometry is not static terrain')
            parent = parent.GetParent()
        if prim.IsA(UsdGeom.Cube):
            size = UsdGeom.Cube(prim).GetSizeAttr().Get()
            if not math.isfinite(size) or not 0 < size <= 100:
                raise ValueError('Invalid cube size')
            points = [[c*size/2 for c in p] for p in CUBE_POINTS]; triangles = list(CUBE_FACES)
        elif prim.IsA(UsdGeom.Mesh):
            mesh = UsdGeom.Mesh(prim)
            points = mesh.GetPointsAttr().Get(); indices = mesh.GetFaceVertexIndicesAttr().Get()
            face_counts = mesh.GetFaceVertexCountsAttr().Get()
            if not points or not indices or not face_counts or any(n != 3 for n in face_counts) or len(indices) != 3*len(face_counts) or mesh.GetHoleIndicesAttr().Get():
                raise ValueError('Only explicit triangle meshes without hidden hole indices are supported')
            if mesh.GetSubdivisionSchemeAttr().Get() != 'none':
                raise ValueError('Apply subdivision before reviewing collision geometry')
            triangles = [tuple(indices[i:i+3]) for i in range(0,len(indices),3)]
            if mesh.GetOrientationAttr().Get() == 'leftHanded':
                triangles = [(a,c,b) for a,b,c in triangles]
        else:
            raise ValueError('Select concrete Cube or triangle Mesh prims, not a parent or point cloud')
        transform = cache.GetLocalToWorldTransform(prim)
        if not math.isfinite(transform.GetDeterminant()) or abs(transform.GetDeterminant()) < 1e-10:
            raise ValueError('Singular geometry transform')
        if transform.GetDeterminant() < 0:
            triangles = [(a,c,b) for a,b,c in triangles]
        if any(min(t) < 0 or max(t) >= len(points) for t in triangles):
            raise ValueError('Mesh index outside point array')
        offset = len(vertices)
        vertices.extend(y_to_z(transform.Transform(Gf.Vec3d(*p))) for p in points)
        faces.extend([[a+offset,b+offset,c+offset] for a,b,c in triangles])
        counts.append({'prim':path,'vertices':len(points),'triangles':len(triangles)})
        if len(vertices) > 500000 or len(faces) > 1000000:
            raise ValueError('Trial geometry budget exceeded')
    # No ground plane is added. Missing regions are neither filled nor meshed over.
    out.mkdir(parents=True)
    target = Usd.Stage.CreateNew(str(out/'terrain.usda'))
    UsdGeom.SetStageMetersPerUnit(target,1); UsdGeom.SetStageUpAxis(target,'Z')
    target.SetDefaultPrim(UsdGeom.Xform.Define(target,'/Terrain').GetPrim())
    mesh = UsdGeom.Mesh.Define(target,'/Terrain/Mesh'); mesh.CreatePointsAttr(vertices)
    mesh.CreateFaceVertexCountsAttr([3]*len(faces)); mesh.CreateFaceVertexIndicesAttr([i for f in faces for i in f])
    mesh.CreateSubdivisionSchemeAttr('none'); mesh.CreateDoubleSidedAttr(True)
    UsdPhysics.CollisionAPI.Apply(mesh.GetPrim())
    UsdPhysics.MeshCollisionAPI.Apply(mesh.GetPrim()).CreateApproximationAttr('none')
    material = UsdShade.Material.Define(target, '/Terrain/PhysicsMaterial')
    physics_material = UsdPhysics.MaterialAPI.Apply(material.GetPrim())
    physics_material.CreateStaticFrictionAttr(spec['friction']['static'])
    physics_material.CreateDynamicFrictionAttr(spec['friction']['dynamic'])
    physics_material.CreateRestitutionAttr(0.)
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(
        material, UsdShade.Tokens.weakerThanDescendants, 'physics')
    target.GetRootLayer().Save()
    reopened = Usd.Stage.Open(str(out/'terrain.usda'))
    if not reopened or reopened.GetCompositionErrors():
        raise ValueError('Prepared terrain did not reopen')
    write_json(out/'scenario.json', spec)
    receipt = {'schema':'brainsnn.g1-preparation.v1','source_pack_manifest_sha256':sha256(root/'pack-files.json'),
               'source_sha256':spec['source_sha256'],'source_kind':spec['source_kind'],'selected_geometry':counts,
               'vertices':len(vertices),'triangles':len(faces),'up_axis':'Z','units':'m','transform':'(x,y,z)->(x,-z,y)',
               'friction':spec['friction'], 'ground_fill_added':False,'library_additions_included':False,'physics_executed':False,
               'physical_accuracy_verified':False,'geometry_basis':'explicitly-reviewed-compiled-static-geometry',
               'terrain_sha256':sha256(out/'terrain.usda'),'scenario_sha256':sha256(out/'scenario.json')}
    write_json(out/'preparation.json',receipt)
    return receipt


def verify_prepared(root):
    root = Path(root).resolve()
    if {p.name for p in root.iterdir()} != {'terrain.usda','scenario.json','preparation.json'}:
        raise ValueError('Unexpected prepared trial files')
    receipt = read_json(root/'preparation.json'); spec = read_json(root/'scenario.json'); validate(spec)
    if receipt.get('schema') != 'brainsnn.g1-preparation.v1' or receipt.get('source_sha256') != spec['source_sha256'] or receipt.get('source_kind') != spec['source_kind']:
        raise ValueError('Preparation binding mismatch')
    for name, key in [('terrain.usda','terrain_sha256'),('scenario.json','scenario_sha256')]:
        if (root/name).is_symlink() or sha256(root/name) != receipt.get(key):
            raise ValueError('Prepared trial bytes changed')
    return spec, receipt
