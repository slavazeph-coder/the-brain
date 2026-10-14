# Playground selection flow

The catalog carries the explicit robot and model together into one playground. It must never substitute another robot to make a selected route appear runnable.

## Entrypoints

- Model cards: open that model with the first documented robot, then a listed candidate if none is documented.
- Robot cards: open that exact robot and prompt for a model.
- Robot/model detail routes: carry both selections explicitly in either direction.
- Filtered comparisons, draft plans and saved plans: retain the selected body, model, task and seed.
- Shareable fragments use `#playground?robot=g1&model=groot&task=Supported+reach&seed=42`.
- Pure world generation has a separate setup; LingBot-VA retains its documented Panda video-action track.

The original BrainSNN B mark, cyan/violet palette and dark surfaces remain in use.

## Current execution boundary

Named bodies load the official MuJoCo Live viewer in an iframe, with an external fallback. It is a physics asset preview, not an inference integration. The G1 scene begins at its standing keyframe but may settle or fall without a controller. An iframe load event only indicates document loading.

There is no parent control or observation bridge for this upstream viewer. Named model execution stays disabled with its required checkpoint, controller and worker explained beside the preview. Configuration exports contain no fabricated evaluation results. Preview browsing contexts are removed when leaving the playground.

The generic BrainSNN arm remains a separate scripted challenge workspace. Switching into it clears any prior endpoint. Its explicitly connected bounded skill endpoint controls only that sandbox. It does not control the chosen named robot.

## Regression verification

Run `node tests/brainsnn-experiment-review.cjs` from the repository. The DOM fixture exercises all 76 listed pairs, all 16 model entries, all 13 robot entries, both selection directions, G1/GR00T retention, saved plans, world and hybrid tracks, explicit incompatible pairs, checkpoint mapping, fragment restore and honest runtime status.

This is source and DOM-fixture verification. It does not validate WebGL pixels, upstream iframe rendering on a device, trained model behaviour or physical hardware.
