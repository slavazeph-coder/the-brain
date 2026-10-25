"""A meeting room with exactly known dimensions, rendered as a handheld walkthrough, for testing World Builder against truth.

usage: python build_office.py -- <out_dir> [--frames 120] [--width 1280] [--height 720] [--samples 24] [--test FRAME]
Writes out_dir/frames/frame_NNNN.png, out_dir/truth.json and out_dir/walkthrough.mp4 (2 fps, so the worker samples one
frame a second). truth.json is in scene.json's own convention (right-handed, y up, metres): the room, every wall and
object as centre / size [length, height, thickness] / yaw, named landmarks, the reference spans (one calibration, the
rest withheld), and every camera's position, look direction and field of view.

It is a synthetic test scene: the dimensions are exact by construction, the pictures are renders. Say so wherever
its results are shown. Materials are procedural (no image files), patterned enough for structure from motion.
"""
import bpy, json, math, os, random, subprocess, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
def opt(name, default, kind=int):
    return kind(args[args.index(name) + 1]) if name in args else default
FRAMES, WIDTH, HEIGHT, SAMPLES = opt('--frames', 120), opt('--width', 1280), opt('--height', 720), opt('--samples', 24)
TEST = opt('--test', None)
W, D, H, T = 6.0, 4.8, 2.7, 0.12  # interior width (x), depth (z), height, wall thickness
random.seed(11)

def B(x, y, z):  # scene frame (y up, z toward the viewer) -> Blender (z up)
    return Vector((x, -z, y))

# ---------- materials (procedural, patterned for feature matching) ----------
def material(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']; build(nt, bsdf); return m
def coord(nt, scale=1.0):
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale,) * 3
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); return mp.outputs['Vector']
def ramp(nt, src, stops):
    r = nt.nodes.new('ShaderNodeValToRGB'); cr = r.color_ramp; cr.elements[0].position, cr.elements[0].color = stops[0]
    cr.elements[1].position, cr.elements[1].color = stops[1]
    for p, c in stops[2:]: e = cr.elements.new(p); e.color = c
    nt.links.new(src, r.inputs['Fac']); return r.outputs['Color']
def paint(colour, grain):  # textured plaster: mottle at two scales and a bump, as real walls have under raking light
    def build(nt, bsdf):
        v = coord(nt)
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = grain; n.inputs['Detail'].default_value = 12
        n.inputs['Roughness'].default_value = .65; nt.links.new(v, n.inputs['Vector'])
        c = ramp(nt, n.outputs['Fac'], [(0.3, (*[x * .62 for x in colour], 1)), (0.7, (*colour, 1))])
        nt.links.new(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .8
        fine = nt.nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = grain * 12; nt.links.new(v, fine.inputs['Vector'])
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .35
        nt.links.new(fine.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return build
def carpet(nt, bsdf):  # 0.5 m carpet tiles, each a slightly different tone, with fibre noise
    v = nt.nodes.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = 2.0; v.feature = 'F1'
    tc = nt.nodes.new('ShaderNodeTexCoord'); sn = nt.nodes.new('ShaderNodeVectorMath'); sn.operation = 'SNAP'
    sn.inputs[1].default_value = (0.5, 0.5, 0.5); nt.links.new(tc.outputs['Object'], sn.inputs[0])
    w = nt.nodes.new('ShaderNodeTexWhiteNoise'); nt.links.new(sn.outputs['Vector'], w.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 60; nt.links.new(coord(nt), n.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'FLOAT'; mix.inputs['Factor'].default_value = .5
    nt.links.new(w.outputs['Value'], mix.inputs['A']); nt.links.new(n.outputs['Fac'], mix.inputs['B'])
    c = ramp(nt, mix.outputs['Result'], [(0.2, (.10, .13, .19, 1)), (0.8, (.30, .34, .42, 1))])
    nt.links.new(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .95
def wood(tone):
    def build(nt, bsdf):
        wv = nt.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 3; wv.inputs['Distortion'].default_value = 6
        wv.inputs['Detail'].default_value = 4; nt.links.new(coord(nt), wv.inputs['Vector'])
        c = ramp(nt, wv.outputs['Fac'], [(0.1, (*[v * .55 for v in tone], 1)), (0.9, (*tone, 1))])
        nt.links.new(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .5
    return build
def art(seed):  # a poster: bold Voronoi colour fields with a fine noise overlay
    def build(nt, bsdf):
        v = nt.nodes.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = 4 + seed % 5; v.inputs['Randomness'].default_value = 1
        mp = coord(nt, 1.0); add = nt.nodes.new('ShaderNodeVectorMath'); add.inputs[1].default_value = (seed * 3.1, seed * 1.7, seed * 2.3)
        nt.links.new(mp, add.inputs[0]); nt.links.new(add.outputs['Vector'], v.inputs['Vector'])
        hue = nt.nodes.new('ShaderNodeHueSaturation'); hue.inputs['Hue'].default_value = (seed * .137) % 1
        nt.links.new(v.outputs['Color'], hue.inputs['Color']); nt.links.new(hue.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = .4
    return build
def whiteboard(nt, bsdf):  # white with marker scribbles: thresholded noise lines
    n = nt.nodes.new('ShaderNodeTexWave'); n.wave_type = 'RINGS'; n.inputs['Scale'].default_value = 6; n.inputs['Distortion'].default_value = 12
    n.inputs['Detail'].default_value = 3; nt.links.new(coord(nt), n.inputs['Vector'])
    c = ramp(nt, n.outputs['Fac'], [(0.47, (.95, .96, .97, 1)), (0.5, (.08, .2, .65, 1)), (0.53, (.95, .96, .97, 1))])
    nt.links.new(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .15
def fabric(colour):
    def build(nt, bsdf):
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 40; nt.links.new(coord(nt), n.inputs['Vector'])
        c = ramp(nt, n.outputs['Fac'], [(0.3, (*[v * .6 for v in colour], 1)), (0.7, (*colour, 1))])
        nt.links.new(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .9
    return build
def tiles(nt, bsdf):  # 0.6 m acoustic ceiling grid with speckle
    b = nt.nodes.new('ShaderNodeTexBrick'); b.inputs['Scale'].default_value = 1 / .6; b.offset = 0; b.inputs['Mortar Size'].default_value = .02
    b.inputs['Color1'].default_value = (.82, .82, .80, 1); b.inputs['Color2'].default_value = (.78, .78, .76, 1)
    b.inputs['Mortar'].default_value = (.35, .35, .36, 1); nt.links.new(coord(nt), b.inputs['Vector'])
    nt.links.new(b.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .95
def emissive(colour, strength):
    def build(nt, bsdf):
        bsdf.inputs['Base Color'].default_value = (*colour, 1); bsdf.inputs['Emission Color'].default_value = (*colour, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return build
def plain(colour, rough=.5, metal=0.0):
    def build(nt, bsdf):
        bsdf.inputs['Base Color'].default_value = (*colour, 1); bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    return build

# ---------- geometry ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
truth = {'schema': 'brainsnn.benchmark-truth.v1', 'synthetic': True, 'units': 'm', 'coordinateFrame': 'right-handed-y-up',
         'note': 'Exact by construction: a rendered test scene, not a capture of a real room.',
         'room': {'width': W, 'depth': D, 'height': H, 'wallThickness': T, 'floorArea': W * D}, 'walls': [], 'objects': [], 'landmarks': {}}

def box(name, centre, size, yaw, mat, record=None, label=None):
    """A box in the scene frame: centre (x, y, z), size [length, height, thickness], length along (cos yaw, sin yaw) in x-z."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(*centre)); ob = bpy.context.active_object; ob.name = name
    ob.scale = (size[0], size[2], size[1]); ob.rotation_euler = (0, 0, -math.radians(yaw)); ob.data.materials.append(mat)
    if record is not None:
        record.append({'name': name, 'label': label or name, 'centre': list(centre), 'size': list(size), 'yaw_degrees': yaw})
    return ob

m_wall = material('wall', paint((.86, .84, .78), 9)); m_feature = material('feature wall', paint((.36, .52, .58), 14))
m_floor = material('carpet', carpet); m_ceiling = material('ceiling', tiles); m_white = material('whiteboard', whiteboard)
m_oak, m_walnut = material('oak', wood((.62, .45, .28))), material('walnut', wood((.36, .23, .14)))
m_frame, m_steel = material('frame', plain((.08, .08, .09), .4)), material('steel', plain((.55, .57, .6), .3, .8))
m_door = material('door', wood((.5, .33, .2))); m_glass_sky = material('outside', emissive((.75, .85, 1.0), 2.5))
m_panel = material('light panel', emissive((1.0, .97, .92), 9)); m_screen = material('screen', art(7))
m_leaf = material('leaves', fabric((.16, .42, .16))); m_pot = material('pot', plain((.7, .32, .2), .7))

# Floor and ceiling (the floor's top is y = 0).
box('floor', (W / 2, -.05, D / 2), [W + 2 * T, .1, D + 2 * T], 0, m_floor)
box('ceiling', (W / 2, H + .05, D / 2), [W + 2 * T, .1, D + 2 * T], 0, m_ceiling)
for i, x in enumerate((1.5, 4.5)):
    for j, z in enumerate((1.2, 3.6)): box(f'light_{i}{j}', (x, H - .005, z), [1.2, .01, .6], 0, m_panel)
truth['objects'].append({'name': 'floor', 'label': 'floor', 'centre': [W / 2, -.01, D / 2], 'size': [W, .02, D], 'yaw_degrees': 0})

# Walls: north (z = 0) has the window, south (z = D) the door, east is the feature wall. Each wall's inner face is the
# room's boundary; its centre sits half a thickness outside it.
def wall(name, start, end, mat, openings=()):
    """A wall from start to end (x, z) on the inner face, outside the room by T, with rectangular openings
    (u0, u1, y0, y1) in metres along it. Built from solid pieces around each opening."""
    (x0, z0), (x1, z1) = start, end; L = math.hypot(x1 - x0, z1 - z0); yaw = math.degrees(math.atan2(z1 - z0, x1 - x0))
    d = ((x1 - x0) / L, (z1 - z0) / L); n = (-d[1], d[0])
    if n[0] * (W / 2 - (x0 + x1) / 2) + n[1] * (D / 2 - (z0 + z1) / 2) < 0: n = (-n[0], -n[1])  # n points into the room
    out = (-n[0] * T / 2, -n[1] * T / 2)  # the wall's centre sits half a thickness outside its inner face
    def piece(u0, u1, y0, y1, k):
        if u1 - u0 < 1e-6 or y1 - y0 < 1e-6: return
        cu = (u0 + u1) / 2
        box(f'{name}_{k}', (x0 + d[0] * cu + out[0], (y0 + y1) / 2, z0 + d[1] * cu + out[1]), [u1 - u0, y1 - y0, T], yaw, mat)
    cuts = sorted(openings); u = 0.0; k = 0
    for u0, u1, y0, y1 in cuts:
        piece(u, u0, 0, H, k); piece(u0, u1, 0, y0, k + 1); piece(u0, u1, y1, H, k + 2); u = u1; k += 3
    piece(u, L, 0, H, k)
    truth['walls'].append({'name': name, 'label': 'wall', 'centre': [(x0 + x1) / 2 + out[0], H / 2, (z0 + z1) / 2 + out[1]],
                           'size': [L, H, T], 'yaw_degrees': yaw, 'openings': [{'from': a, 'to': b, 'bottom': c, 'top': e} for a, b, c, e in cuts]})
    return d, n
wall('wall_north', (W, 0), (0, 0), m_wall, openings=[(2.4, 4.2, .9, 2.1)])  # along -x; u runs from x = 6
wall('wall_west', (0, 0), (0, D), m_wall)
wall('wall_south', (0, D), (W, D), m_wall, openings=[(4.2, 5.1, 0, 2.1)])
wall('wall_east', (W, D), (W, 0), m_feature)
box('outside', (W / 2, 1.5, -1.5), [8, 4, .02], 0, m_glass_sky)  # bright sky beyond the window
box('door_leaf', (5.1 + .02, 1.05, D + .45), [.9, 2.1, .04], 90, m_door)  # open door, swung outward
for x in (1.8, 4.2):  # window frame mullions on the inner face
    box(f'window_jamb_{x}', (W - x, 1.5, -.02), [.05, 1.2, .05], 0, m_frame)

def lm(name, x, y, z): truth['landmarks'][name] = [round(x, 6), round(y, 6), round(z, 6)]
# Window opening corners (north wall inner face, x from 3.6 to 1.8) and door opening corners (south wall).
lm('window_top_left', 3.6, 2.1, 0); lm('window_top_right', 1.8, 2.1, 0); lm('window_sill_left', 3.6, .9, 0); lm('window_sill_right', 1.8, .9, 0)
lm('door_top_left', 4.2, 2.1, D); lm('door_top_right', 5.1, 2.1, D)

# Wall-mounted items: whiteboard on the south wall, posters on the west wall, a screen on the east wall.
def on_wall(name, mat, face, u, y, w, h, depth=.02, landmarks=True):
    """A flat panel on a wall's inner face: face is 'north' | 'south' | 'west' | 'east'; u is the distance along that
    face from its west or north end; y is the panel's centre height."""
    if face == 'south': c, yaw = (u, y, D - depth / 2), 0
    elif face == 'north': c, yaw = (u, y, depth / 2), 0
    elif face == 'west': c, yaw = (depth / 2, y, u), 90
    else: c, yaw = (W - depth / 2, y, u), 90
    box(name, c, [w, h, depth], yaw, mat)
    if landmarks:
        for tag, du, dy in (('top_left', -w / 2, h / 2), ('top_right', w / 2, h / 2), ('bottom_left', -w / 2, -h / 2), ('bottom_right', w / 2, -h / 2)):
            if yaw == 0: lm(f'{name}_{tag}', c[0] + du, c[1] + dy, c[2] + (-depth / 2 if face == 'south' else depth / 2))
            else: lm(f'{name}_{tag}', c[0] + (depth / 2 if face == 'west' else -depth / 2), c[1] + dy, c[2] + du)
on_wall('whiteboard', m_white, 'south', 2.0, 1.45, 1.8, 1.1)
box('whiteboard_tray', (2.0, .87, D - .05), [1.8, .03, .06], 0, m_steel)
for k, (u, y, w, h) in enumerate([(1.0, 1.6, .7, .9), (2.4, 1.7, .9, .6), (3.8, 1.6, .7, .9)]):
    on_wall(f'poster_west_{k}', material(f'poster_w{k}', art(k + 1)), 'west', u, y, w, h)
on_wall('screen', m_screen, 'east', 2.4, 1.45, 1.4, .8, depth=.05)
on_wall('poster_north', material('poster_n', art(9)), 'north', 1.0, 1.55, .6, .8)
on_wall('cork_board', material('cork', fabric((.55, .4, .25))), 'south', 0.7, 1.5, .6, .9)
# Fixtures a real room has: a clock, sockets and switches, an acoustic panel, a second poster on the north wall.
on_wall('clock', material('clock', art(13)), 'north', 4.9, 2.05, .35, .35, landmarks=False)
on_wall('acoustic_panel', material('felt', fabric((.25, .3, .38))), 'east', 4.0, 1.4, 1.0, 1.0, depth=.04, landmarks=False)
on_wall('poster_north_2', material('poster_n2', art(11)), 'north', 5.2, 1.4, .5, .7)
for k, (face, u) in enumerate([('north', .5), ('south', 3.2), ('west', 1.9), ('east', 1.2), ('south', 5.6), ('west', 4.4)]):
    on_wall(f'socket_{k}', m_frame if k % 2 else material(f'plate_{k}', plain((.92, .92, .9), .4)), face, u, .3 if k % 3 else 1.1, .09, .09, depth=.01, landmarks=False)
for name, c, s, y in [('base_north', (W / 2, .05, .01), [W, .1, .02], 0), ('base_south', (W / 2, .05, D - .01), [W, .1, .02], 0),
                      ('rail_west', (.01, .9, D / 2), [D, .04, .02], 90)]:
    box(name, c, s, y, m_walnut)

# Furniture, recorded as truth objects (their bounding boxes, the way the compiler measures objects).
table_c, table_len, table_w, table_h = (W / 2, 0, D / 2 + .1), 2.4, 1.1, .74
box('table_top', (table_c[0], table_h - .02, table_c[2]), [table_len, .04, table_w], 0, m_oak)
for dx in (-.7, .7): box(f'table_leg_{dx}', (table_c[0] + dx, (table_h - .04) / 2, table_c[2]), [.12, table_h - .04, .7], 0, m_steel)
truth['objects'].append({'name': 'table', 'label': 'table', 'centre': [table_c[0], table_h / 2, table_c[2]], 'size': [table_len, table_h, table_w], 'yaw_degrees': 0})
for sx, sz, tag in ((-1, -1, 'nw'), (1, -1, 'ne'), (-1, 1, 'sw'), (1, 1, 'se')):
    lm(f'table_{tag}', table_c[0] + sx * table_len / 2, table_h, table_c[2] + sz * table_w / 2)
chair_colours = [(.75, .2, .15), (.15, .35, .7), (.2, .55, .3), (.8, .6, .1), (.45, .2, .55), (.25, .25, .28)]
k = 0
for side in (-1, 1):
    for dx in (-.75, 0, .75):
        cx, cz = table_c[0] + dx, table_c[2] + side * (table_w / 2 + .38); mc = material(f'chair_{k}', fabric(chair_colours[k]))
        box(f'chair_{k}_seat', (cx, .46, cz), [.5, .06, .5], 0, mc)
        box(f'chair_{k}_back', (cx, .78, cz + side * .23), [.48, .55, .05], 0, mc)
        box(f'chair_{k}_post', (cx, .22, cz), [.06, .44, .06], 0, m_steel)
        box(f'chair_{k}_foot', (cx, .02, cz), [.55, .04, .55], 0, m_steel)
        truth['objects'].append({'name': f'chair_{k}', 'label': 'chair', 'centre': [cx, (1.055) / 2, cz + side * .0], 'size': [.55, 1.055, .55], 'yaw_degrees': 0})
        k += 1
box('credenza', (.24, .4, 2.4), [1.6, .8, .45], 90, m_walnut, truth['objects'], 'cabinet')
for tag, dz in (('north', -.8), ('south', .8)): lm(f'credenza_top_{tag}', .465, .8, 2.4 + dz)
box('filing_cabinet', (W - .3, .65, D - .35), [.5, 1.3, .6], 0, m_steel, truth['objects'], 'cabinet')
bpy.ops.mesh.primitive_cylinder_add(radius=.18, depth=.4, location=B(.45, .2, .45)); pot = bpy.context.active_object; pot.data.materials.append(m_pot)
bpy.ops.mesh.primitive_ico_sphere_add(radius=.38, subdivisions=3, location=B(.45, .75, .45)); leaves = bpy.context.active_object
leaves.data.materials.append(m_leaf); tex = bpy.data.textures.new('leafy', 'CLOUDS'); disp = leaves.modifiers.new('d', 'DISPLACE'); disp.texture = tex; disp.strength = .12
truth['objects'].append({'name': 'plant', 'label': 'potted plant', 'centre': [.45, .565, .45], 'size': [.76, 1.13, .76], 'yaw_degrees': 0})

# Reference spans: one calibration (what a person would tape and type), the rest withheld, in different directions.
truth['spans'] = [
    {'id': 'table-length', 'role': 'calibration', 'from': 'table_nw', 'to': 'table_ne', 'label': 'Table top, long edge'},
    {'id': 'whiteboard-width', 'role': 'held-out', 'from': 'whiteboard_top_left', 'to': 'whiteboard_top_right', 'label': 'Whiteboard, top edge'},
    {'id': 'window-height', 'role': 'held-out', 'from': 'window_top_left', 'to': 'window_sill_left', 'label': 'Window opening, height'},
    {'id': 'credenza-length', 'role': 'held-out', 'from': 'credenza_top_north', 'to': 'credenza_top_south', 'label': 'Credenza top, length'},
    {'id': 'table-to-whiteboard', 'role': 'held-out', 'from': 'table_se', 'to': 'whiteboard_bottom_left', 'label': 'Table corner to whiteboard corner'},
    {'id': 'window-width', 'role': 'held-out', 'from': 'window_top_left', 'to': 'window_top_right', 'label': 'Window opening, width'},
]
for s in truth['spans']:
    a, b = truth['landmarks'][s['from']], truth['landmarks'][s['to']]; s['distanceMeters'] = round(math.dist(a, b), 6)

# ---------- light, camera, path ----------
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.6, .65, .7, 1); world.node_tree.nodes['Background'].inputs[1].default_value = .3
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(55), 0, math.radians(20))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens, cam.data.sensor_width = 26, 36  # a phone's main camera: about 69 degrees across
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.cycles.denoiser = 'OPENIMAGEDENOISE'; sc.cycles.max_bounces = 4; sc.render.resolution_x, sc.render.resolution_y = WIDTH, HEIGHT
sc.render.image_settings.file_format = 'PNG'; sc.view_settings.view_transform = 'AgX'

def path(t):
    """A walk once round the room, 0.95 m inside the walls, at phone height, looking 50 degrees inward from the
    direction of travel and a little down, with a slight sway. t in [0, 1)."""
    m = .95; pts = [(m, m), (W - m, m), (W - m, D - m), (m, D - m)]
    per = [math.dist(pts[i], pts[(i + 1) % 4]) for i in range(4)]; total = sum(per); s = t * total
    for i in range(4):
        if s <= per[i]:
            a, b = pts[i], pts[(i + 1) % 4]; f = s / per[i]; break
        s -= per[i]
    x, z = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
    heading = math.atan2(b[1] - a[1], b[0] - a[0]) + math.radians(50) + .03 * math.sin(t * 37)  # inward is +90 here
    y = 1.5 + .02 * math.sin(t * 23)
    look = (math.cos(heading), -.16, math.sin(heading))
    return (x, y, z), look

truth['cameras'] = []
os.makedirs(os.path.join(OUT, 'frames'), exist_ok=True)
for f in range(FRAMES):
    (x, y, z), look = path(f / FRAMES)
    cam.location = B(x, y, z); direction = B(*look) - B(0, 0, 0)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    hfov = 2 * math.degrees(math.atan(18 / 26))
    truth['cameras'].append({'frame': f, 'position': [round(x, 6), round(y, 6), round(z, 6)], 'look': [round(v, 6) for v in look], 'hfov_degrees': round(hfov, 4)})
    if TEST is not None and f != TEST: continue
    sc.render.filepath = os.path.join(OUT, 'frames', f'frame_{f:04d}.png'); bpy.ops.render.render(write_still=True)
    print('frame', f, flush=True)
json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), indent=1)
if TEST is None:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '2', '-i', os.path.join(OUT, 'frames', 'frame_%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', os.path.join(OUT, 'walkthrough.mp4')], check=True)
os._exit(0)
