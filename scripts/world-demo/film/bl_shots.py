"""Render the LinkedIn demo's 3D shots in Blender (Cycles, CPU) from one real run's exported files.

usage: python bl_shots.py -- <scene.glb> <arena-cloud.json> <scene.json> <route.json> <shot> <out_dir> [--test FRAME]
shots: points (reconstruction appears), scene (walls rise, objects pop, names), route (robot drives), bim (IFC classes)
Geometry comes only from the run: scene.glb (compiled walls, floor, objects, unknown space), the hand-off's points and
the route the site's planner produced. Styling, lighting and camera are the only things added.
"""
import bpy, json, math, os, random, sys
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

args = sys.argv[sys.argv.index('--') + 1:]
GLB, CLOUD, SCENE, ROUTE, SHOT, OUT = args[:6]
TEST = int(args[args.index('--test') + 1]) if '--test' in args else None
FPS, SIZE = 30, 1080
FRAMES = {'points': 105, 'scene': 120, 'route': 120, 'bim': 90}[SHOT]

def hexcol(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + .055) / 1.055) ** 2.4 for x in c] + [a]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.cycles.samples = 8; sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.05
sc.cycles.use_denoising = True; sc.cycles.denoiser = 'OPENIMAGEDENOISE'
sc.cycles.max_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 1; sc.cycles.transparent_max_bounces = 8
sc.render.use_persistent_data = True
sc.render.resolution_x = sc.render.resolution_y = SIZE; sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = hexcol('#06070c'); world.node_tree.nodes['Background'].inputs[1].default_value = 1.0

def material(name, colour, rough=.55, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = hexcol(colour); p.inputs['Roughness'].default_value = rough
    if emit: p.inputs['Emission Color'].default_value = hexcol(emit); p.inputs['Emission Strength'].default_value = strength
    p.inputs['Alpha'].default_value = alpha
    if alpha < 1: m.blend_method = 'BLEND'
    return m

# ---------- the run's compiled scene ----------
bpy.ops.import_scene.gltf(filepath=GLB)
scene_json = json.load(open(SCENE))
labels = {o['name']: o.get('label') for o in scene_json['objects']}
for o in list(sc.objects):
    if o.name == 'observed_points': bpy.data.objects.remove(o, do_unlink=True)
def to_bottom_origin(o):
    """Bake the object's transform into its mesh and put its origin at its bottom centre, so scale.z grows it from the floor."""
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    zs = [v.co.z for v in o.data.vertices]; xs = [v.co.x for v in o.data.vertices]; ys = [v.co.y for v in o.data.vertices]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    o.data.transform(Matrix.Translation(-c)); o.location = c
    return c, max(zs) - min(zs)
walls = sorted([o for o in sc.objects if o.name.startswith('wall_')], key=lambda o: o.name)
objects = sorted([o for o in sc.objects if o.name.startswith('object_')], key=lambda o: int(o.name.split('_')[1]))
floor = sc.objects['floor_observed']; unknown = sc.objects['unknown_space']
for o in walls + objects + [floor, unknown]: to_bottom_origin(o)
named = [o for o in objects if labels.get(o.name) not in (None, 'object')]

BIM = SHOT == 'bim'
m_floor = material('floor', '#d8cdb8' if BIM else '#141821', rough=.8)
m_wall = material('wall', '#9aa6b8' if BIM else '#dfe6f2', rough=.5, alpha=1.0 if BIM else .2)
m_obj = material('obj', '#f2b8c6' if BIM else '#8b7cf6', rough=.45, emit=None if BIM else '#8b7cf6', strength=0 if BIM else .15)
m_named = material('named', '#a855f7' if BIM else '#00e5f0', rough=.35, emit=None if BIM else '#00f5ff', strength=0 if BIM else .55)
m_unknown = material('unknown', '#5b3a6e', rough=.9, emit='#ff4f9a', strength=.04, alpha=.16)
floor.data.materials.clear(); floor.data.materials.append(m_floor)
for o in walls: o.data.materials.clear(); o.data.materials.append(m_wall)
for o in objects: o.data.materials.clear(); o.data.materials.append(m_named if o in named else m_obj)
unknown.data.materials.clear(); unknown.data.materials.append(m_unknown)
for o in walls + objects: bevel = o.modifiers.new('bevel', 'BEVEL'); bevel.width = .015; bevel.segments = 2

# ---------- the run's points (hand-off frame, y up -> Blender z up) ----------
cloud = json.load(open(CLOUD))['points']
random.seed(7); order = list(range(len(cloud))); random.shuffle(order)
batches = 8
pts_objs = []
for b in range(batches):
    idx = order[b::batches]
    me = bpy.data.meshes.new(f'pts{b}'); me.from_pydata([(cloud[i][0], -cloud[i][2], cloud[i][1]) for i in idx], [], [])
    col = me.attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for k, i in enumerate(idx):
        r, g, bb = (min(1.0, (cloud[i][3 + j] / 255) * 1.35 + .04) for j in range(3))
        col.data[k].color = [x ** 2.2 for x in (r, g, bb)] + [1]
    ob = bpy.data.objects.new(f'points{b}', me); sc.collection.objects.link(ob); pts_objs.append(ob)
gn = bpy.data.node_groups.new('to_points', 'GeometryNodeTree')
gn.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry'); gn.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
gi, go = gn.nodes.new('NodeGroupInput'), gn.nodes.new('NodeGroupOutput')
m2p = gn.nodes.new('GeometryNodeMeshToPoints'); m2p.inputs['Radius'].default_value = .02
setm = gn.nodes.new('GeometryNodeSetMaterial')
m_pts = bpy.data.materials.new('pts'); m_pts.use_nodes = True
nt = m_pts.node_tree; nt.nodes.clear()
attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'Col'
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 2.4
outm = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(attr.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs['Emission'], outm.inputs['Surface'])
setm.inputs['Material'].default_value = m_pts
gn.links.new(gi.outputs[0], m2p.inputs['Mesh']); gn.links.new(m2p.outputs['Points'], setm.inputs['Geometry']); gn.links.new(setm.outputs['Geometry'], go.inputs[0])
for ob in pts_objs: ob.modifiers.new('pts', 'NODES').node_group = gn

# ---------- the planner's route (world map frame -> hand-off frame) ----------
route = json.load(open(ROUTE)); ox, oz = route['origin']; fy = scene_json['floor_y'] + .035
path = [(p['x'] + ox, -(p['z'] + oz), fy) for p in route['route']]
cd = bpy.data.curves.new('route', 'CURVE'); cd.dimensions = '3D'; cd.bevel_depth = .022; cd.bevel_resolution = 2
spl = cd.splines.new('POLY'); spl.points.add(len(path) - 1)
for p, (x, y, z) in zip(spl.points, path): p.co = (x, y, z, 1)
cd.bevel_factor_mapping_end = 'SPLINE'
route_ob = bpy.data.objects.new('route', cd); sc.collection.objects.link(route_ob)
route_ob.data.materials.append(material('route', '#00f5ff', emit='#00f5ff', strength=6))
bpy.ops.mesh.primitive_cylinder_add(radius=.175, depth=.09, vertices=48)
puck = bpy.context.active_object; puck.data.materials.append(material('puck', '#f4f7fb', rough=.3, emit='#00f5ff', strength=.6))
seg = [0.0]
for a, b in zip(path, path[1:]): seg.append(seg[-1] + math.dist(a, b))
def along(f):
    d = f * seg[-1]
    for i in range(1, len(seg)):
        if seg[i] >= d:
            t = (d - seg[i - 1]) / max(seg[i] - seg[i - 1], 1e-9); a, b = path[i - 1], path[i]
            return Vector((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, fy + .045))
    return Vector(path[-1][:2] + (fy + .045,))

# ---------- lights ----------
def light(name, kind, energy, colour, loc, rot, size=None):
    l = bpy.data.lights.new(name, kind); l.energy = energy; l.color = hexcol(colour)[:3]
    if size: l.size = size
    ob = bpy.data.objects.new(name, l); sc.collection.objects.link(ob); ob.location = loc; ob.rotation_euler = rot
fc = floor.location.copy(); centre = Vector((fc.x, fc.y, fc.z + .6))
light('key', 'AREA', 900, '#fff4e8', (centre.x + 2, centre.y - 3, centre.z + 6), (math.radians(25), math.radians(12), 0), 6)
light('rim', 'AREA', 500, '#5fe8ff', (centre.x - 4, centre.y + 5, centre.z + 3), (math.radians(-60), 0, math.radians(200)), 4)
light('fill', 'SUN', 1.2, '#b8c4ff', (0, 0, 10), (math.radians(40), math.radians(-30), math.radians(60)))

# ---------- camera ----------
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 27; cam.data.dof.use_dof = False
target = bpy.data.objects.new('target', None); sc.collection.objects.link(target); target.location = centre
tr = cam.constraints.new('TRACK_TO'); tr.target = target; tr.track_axis = 'TRACK_NEGATIVE_Z'; tr.up_axis = 'UP_Y'
ease = lambda t: t * t * (3 - 2 * t)
def orbit(frame, az, el, dist):
    a, e = math.radians(az), math.radians(el)
    cam.location = centre + Vector((dist * math.cos(e) * math.cos(a), dist * math.cos(e) * math.sin(a), dist * math.sin(e)))
    cam.keyframe_insert('location', frame=frame)
def key_scale(o, frame, z=None, s=None):
    if z is not None: o.scale = (o.scale.x, o.scale.y, z)
    if s is not None: o.scale = (s, s, s)
    o.keyframe_insert('scale', frame=frame)
def hide(o, frame, hidden):
    o.hide_render = hidden; o.keyframe_insert('hide_render', frame=frame)
def strength(mat, frame, value, socket='Emission Strength'):
    node = mat.node_tree.nodes.get('Principled BSDF') or mat.node_tree.nodes.get('Emission')
    inp = node.inputs[socket] if socket in node.inputs else node.inputs['Strength']; inp.default_value = value; inp.keyframe_insert('default_value', frame=frame)

for f in range(1, FRAMES + 1, 2):  # smooth camera: a key every other frame
    t = (f - 1) / (FRAMES - 1)
    if SHOT == 'points': orbit(f, 205 + 40 * t, 36, 8.0 - .6 * t)
    elif SHOT == 'scene': orbit(f, 245 + 45 * t, 40 + 4 * t, 9.4 - .5 * t)
    elif SHOT == 'route': u = ease(min(1, t * 2.2)); orbit(f, 290 + 40 * u, 44 + 18 * u, 9.6 + .2 * u)
    else: orbit(f, 330 + 18 * t, 48 - 4 * t, 9.8 - .7 * t)

pts_mat = m_pts
if SHOT == 'points':
    for o in walls + objects + [floor, unknown, route_ob, puck]: o.hide_render = True
    for b, ob in enumerate(pts_objs):
        start = 1 + b * 4
        hide(ob, 1, True); hide(ob, start, True); hide(ob, start + 1, False)
elif SHOT == 'scene':
    for o in [route_ob, puck]: o.hide_render = True
    for n, o in enumerate(walls):
        key_scale(o, 1, z=0.001); key_scale(o, 8 + 3 * n, z=0.001); key_scale(o, 26 + 3 * n, z=1)
    for n, o in enumerate(sorted(objects, key=lambda o: -o.dimensions.x * o.dimensions.y)):
        key_scale(o, 1, s=0.001); key_scale(o, 30 + 2 * n, s=0.001); key_scale(o, 40 + 2 * n, s=1.08); key_scale(o, 45 + 2 * n, s=1)
    radius = m2p.inputs['Radius']  # the points shrink away once the scene stands, instead of lingering as dark specks
    for f, r in ((1, .02), (40, .02), (75, .0)): radius.default_value = r; radius.keyframe_insert('default_value', frame=f)
    m_unknown.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0; m_unknown.node_tree.nodes['Principled BSDF'].inputs['Alpha'].keyframe_insert('default_value', frame=55)
    m_unknown.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = .22; m_unknown.node_tree.nodes['Principled BSDF'].inputs['Alpha'].keyframe_insert('default_value', frame=80)
elif SHOT == 'route':
    for ob in pts_objs: ob.hide_render = True
    cd.bevel_factor_end = 0; cd.keyframe_insert('bevel_factor_end', frame=18)
    for f in range(18, FRAMES + 1):
        u = min(1, (f - 18) / (FRAMES - 26)); cd.bevel_factor_end = max(u, 1e-4); cd.keyframe_insert('bevel_factor_end', frame=f)
        puck.location = along(u); puck.keyframe_insert('location', frame=f)
    puck.location = along(0); puck.keyframe_insert('location', frame=1)
else:
    for o in pts_objs + [route_ob, puck, unknown]: o.hide_render = True
for fc_ in [a for o in bpy.data.objects if o.animation_data and o.animation_data.action for a in o.animation_data.action.fcurves]:
    for k in fc_.keyframe_points:
        if fc_.data_path == 'hide_render': k.interpolation = 'CONSTANT'
if bpy.data.curves['route'].animation_data:
    for fc_ in bpy.data.curves['route'].animation_data.action.fcurves:
        for k in fc_.keyframe_points: k.interpolation = 'LINEAR'

# ---------- labels for the edit: where each named object sits on screen ----------
marks = {}
for f in range(1, FRAMES + 1):
    sc.frame_set(f)
    for o in named:
        top = o.matrix_world @ Vector((0, 0, max(v.co.z for v in o.data.vertices) * o.scale.z))
        p = world_to_camera_view(sc, cam, top)
        marks.setdefault(o.name, {'label': labels[o.name], 'size': [round(o.dimensions.x, 2), round(o.dimensions.y, 2), round(o.dimensions.z, 2)], 'screen': []})
        marks[o.name]['screen'].append([round(p.x * SIZE, 1), round((1 - p.y) * SIZE, 1), round(p.z, 2)])
os.makedirs(OUT, exist_ok=True)
json.dump(marks, open(os.path.join(OUT, 'labels.json'), 'w'))

frames = [TEST] if TEST else range(1, FRAMES + 1)
for f in frames:
    target_png = os.path.join(OUT, f'{f:04d}.png')
    if os.path.exists(target_png) and not TEST: continue
    sc.frame_set(f); sc.render.filepath = target_png
    bpy.ops.render.render(write_still=True)
    print('frame', f, flush=True)
os._exit(0)
