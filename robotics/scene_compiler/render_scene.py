"""Render a compiled scene to PNG with Blender (Workbench, headless) — three views so the result can actually be looked at."""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector

blend, out = Path(sys.argv[sys.argv.index("--") + 1]), Path(sys.argv[sys.argv.index("--") + 2])
bpy.ops.wm.open_mainfile(filepath=str(blend))
sc = bpy.context.scene; sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "MATERIAL"
sc.display.shading.show_object_outline = True; sc.render.resolution_x, sc.render.resolution_y = 1280, 900; sc.render.film_transparent = False
sc.world = sc.world or bpy.data.worlds.new("W"); sc.world.color = (0.05, 0.05, 0.07)
objs = [o for o in sc.objects if o.type == "MESH"]
lo = Vector((min(min((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in objs) for i in range(3)))
hi = Vector((max(max((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in objs) for i in range(3)))
centre, radius = (lo + hi) / 2, max((hi - lo).length / 2, 0.5)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 35
for name, direction in [("iso", Vector((1, -1, 0.8))), ("top", Vector((0, -0.05, 1))), ("front", Vector((0, -1, 0.15)))]:
    cam.location = centre + direction.normalized() * radius * 2.4
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(out / f"render-{name}.png"); bpy.ops.render.render(write_still=True)
print("RENDER_OK", [f"render-{n}.png" for n in ("iso", "top", "front")])
