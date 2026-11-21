# Follow an object through a room

Open **World Builder → Open the showroom** or visit `/world/index.html#showroom`. Pick an object in a saved camera view, turn its linked 3D points, and inspect its footprint on the floor. On a phone, the Source, Objects, Points and Map buttons switch between the four views. Remove a cart from a simulation copy to compare routes to the same destination. Restore the cart to return to the original. The practice room uses authored geometry and the existing World ground planner.

**Preview the walk** opens directly at `/world/index.html#showroom-walk`. Choose two saved views and press **Play walk**, or drag the slider to stop between them. The preview uses camera position and depth to place pixels from the two source pictures in the new view. The percentage under the picture shows how much of the frame these samples cover. **Fill gaps with an endpoint picture** optionally fills the remaining pixels with colors from the nearer end of the walk in time. The **Room points** option shows the underlying geometry. Room files with only floor position and heading get the point preview with estimated lens and height.

Choose **Check a saved view** to compare a preview with the actual picture at that camera and the closest other saved picture. The preview takes its colors from the bracketing source views. For a room reconstructed from all of its photographs, this is a visual check on the color sources. A separate evaluation can reserve photographs before building any geometry. [Withheld-view evaluation and model handoff](world-showroom-walk-evaluation.md)

**Open a room file** reads a showroom JSON file in the browser. Each surveyed or reconstructed room supplies its own scale provenance and simulated route pairs. Optional source video stays on the device. The player checks its SHA-256 before enabling synchronization, switches to the nearest retained view during playback and shows when the video is outside the mapped interval. Image boxes belong to their saved frame. Footprints describe the planner's model of an object and can differ from its observed shape.

## Preparing evidence

The importer in `brainsnn-r3f-app/public/world/showroom-model.mjs` is the format reference. `createShowroomExample()` returns a complete working example.

- Set `units` to `m`, supply the floor bounds as `[minX,minZ,maxX,maxZ]` and provide a stable ID, label and X/Z polygon for each object. Supply the polygons of unknown space.
- Link each known frame observation to an object ID and a normalized image box in left, top, right, bottom order. Linked point samples use `[x,z,height,objectId]`. Use three coordinates for unassigned points. Keep uncertain image identities unassigned.
- Supply each frame's ID, dimensions, image and observations. Portable files can embed JPEG, PNG or WebP raster bytes as data URLs. `timeSeconds` can be null. Optional `camera` is the camera's position on the floor.
- `routes` contains the simulation object ID and a pair of routes called `before` and `after`. Each has a floor polyline and a distance in metres. `comparisons` can hold pairs for other objects. Label their provenance and use the same start and destination within each pair. The viewer replays the supplied simulation.
- For video, set `sourceVideo.sha256` to the original file hash and supply verified playback-relative seconds for matched frames. Existing camera ledgers also identify prepared views across reconstruction engines. [Camera evidence](world-camera-evidence.md)

When the reconstruction kept the images but lost their source times, the offline matcher compares the retained images against displayed frames and checks the decoder timestamps. It reports ambiguous matches and can handle a variable frame rate and nonzero media start. The report gives source presentation timestamps and their time base. For a recording whose timeline begins at a nonzero timestamp, translate the report times to the movie player’s clock and verify the offset against a retained view. The tool needs FFmpeg, FFprobe, NumPy and Pillow.

```sh
python3 scripts/world-demo/match_showroom_frames.py \
  --source capture.mov --frames-dir prepared-images \
  --receipt reconstruction-receipt.json --output frame-matches.json
```

Review image associations on other views before using them in a shared room. Use geometry reviewed for planning when preparing the route pairs. An object’s presence in an image alone gives no clearance measurement.

## Add calibrated depth to a room

A calibrated frame may include `pose` with `eye`, `right`, `down`, `forward` in room XYZ (Y up) and `intrinsics: [fx, fy, cx, cy]` in pixels of that frame. A supplied floor position must agree with the eye's X and Z coordinates. Its optional `depth` has `width`, `height` and `millimeters`, a base64 encoding of row-major little-endian unsigned 16-bit optical-axis depths. A value of zero means missing. Each depth dimension can be at most 256 pixels and must retain the source aspect ratio. The practice room's maps come from rays intersecting its original authored Blender meshes.

For a reconstruction using undistorted SIMPLE_PINHOLE images, prepare per-view depths from the existing colored or uncolored point cloud. Supply the source-to-room similarity transform and floor estimate from the same reconstruction. The tool matches photos by ID, applies the camera intrinsics at the embedded image size, and keeps the nearest sampled point along each pixel. Coordinates in a scale-estimated reconstruction retain that uncertainty.

```sh
python3 scripts/world-demo/prepare_showroom_depth.py \
  --room showroom.json --cameras capture/reconstruction.json \
  --alignment compiled/arena-cloud.json --cloud capture/cloud.npz \
  --output showroom-with-depth.json
```

The walkthrough is a camera preview. Robot fit, room edits and clearance still use the reviewed map. ViewNeXt can be evaluated through the external prediction format when its authors release runnable inference code and weights. [ViewNeXt release](https://github.com/phai-lab/ViewNext)
