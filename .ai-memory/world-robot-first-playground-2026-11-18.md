---
type: project
description: Robot-first World Builder playground (choose a robot, build its world, let it try), camera buttons, tap-to-choose, undo, More contrast
---

Owner liked the Robot Arena's MuJoCo-style setup, where you choose the robot and then its world, and asked
for the same in the World Builder playground, plus a deep visual pass for ages 6–90 with no lost features
(Nov 18, after #310 and #312). Scope stays the playground; keep the near-black/cyan/violet identity.

A robot-first setup (`robot-setup.mjs`, `#robot-setup`) sits directly above the world:
01 Choose your robot shows five illustrated cards for core.mjs ROBOTS, with plain words first, then size and pace.
02 Build its world offers Example room, Street, Empty room, My photo or video, and Saved map. Each runs the
existing #hero-sample, #hero-street, new-map, #hero-capture or restore path, with their confirmations.
03 Let it try runs #run. In the street it opens the street's own simulate tool.
The cards and the existing #robot select are one choice. Robots remain body envelopes for the planner.
The street robot keeps its own size; the setup says so.

The map draws the chosen robot's body where it stands, facing along the route. Name tags are 13 px pills,
and the selected object has a 3 px outline. Tapping a box picks it (renderer.pick). "Tap a thing to change it"
buttons mirror #objects. The map camera dock uses the canvas's existing keys. Visual-preview Turn buttons
call the viewer's explicit rotateYaw action; preview arrow keys continue to pan. Turn preserves the
current target and distance. Touch drag never turned the map, so these buttons are the phone path.
Undo/Redo and Ctrl/Cmd+Z cover mutate() edits only. Replacing the map clears the history, and an undone map
is never marked reviewed.

The type scale is larger on the playground only (body.playground: 16/18/15 px; Larger text 19/22/18 px).
Linked pages that share world.css keep their tested sizes. No visible playground text is under 13 px.
More contrast is optional and remembered, and it follows prefers-contrast until the person chooses.
Tool-strip numbers became icons, so the setup is the one numbered path. The integrated robot/camera offline shell is world-shell-robot-camera-v33; only obsolete World shell caches are removed, preserving model caches.

Checks:
- robot_setup_browser_smoke.py (Chromium/WebKit; 320/390 px in standard and large text) is in CI.
- robot-setup.test.mjs requires a drawing and plain labels for every ROBOTS entry.
- WebKit in the Claude container fails browser_smoke's offline service-worker reload on production as well,
  so that is environmental; GitHub CI decides it. No usability study with children or older adults has been run.

Review fixes before merge:
- A planner advice.start accompanied by advice.size fits only the smaller envelope. Open robot size/clearance settings instead of moving the unchanged robot into another failure.
- Regression coverage uses actual planner errors plus camera orientation checks in Chromium and WebKit; UI actions preserve the original start and envelope until the user changes them.
- Integration preserves the existing repair, localization, motion, biomechanics and camera-layout tools.
