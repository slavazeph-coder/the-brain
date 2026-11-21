# Export a delivery run as a LeRobot dataset

The World Builder showroom records a simulated delivery cart following a route between two floor positions. Use these recordings to study the controller, compare room layouts or prepare imitation-learning experiments. The converter creates a local LeRobot v3 dataset. It can also render one synchronized color image for each action.

## Record and convert

Download the episode JSON from the showroom, or record every saved route pair from the repository root. The recorder uses the same MuJoCo engine and controller as the playground. Install the app’s npm dependencies before using the recorder.

```sh
node scripts/world-demo/record_showroom_runs.mjs --out practice-runs
# For a room you prepared, also pass --room /path/to/showroom.json
```

Use Node 22 or newer and Python 3.12. The optional Python packages install in a separate environment. The state-only export needs the LeRobot dataset package. Native image rendering additionally needs MuJoCo 4.0.1 and a working OpenGL context.

```sh
python3.12 -m venv .venv-showroom-data
. .venv-showroom-data/bin/activate
python -m pip install 'lerobot[dataset]==0.7.0'
python scripts/world-demo/export_showroom_episodes.py practice-runs/*.episode.json --output delivery-state

# Replay with a simulated camera and export its lossless 128 × 128 RGB images.
python -m pip install 'mujoco==4.0.1'
python scripts/world-demo/export_showroom_episodes.py practice-runs/*.episode.json --rgb --output delivery-rgb
```

On a headless Linux machine with a functioning EGL installation, set `MUJOCO_GL=egl` for the RGB command. Choose a new output directory for each export. The converter uses the official LeRobot writer, closes the dataset and reopens it with the official reader to compare every saved row with the input. Conversion, rendering and verification run locally.

## What a row means

Each row represents 50 milliseconds of simulation. The timestamp belongs to the observation just before the controller applies its velocity command. MuJoCo integrates ten 5 ms steps before the next observation.

| Column | Values |
| --- | --- |
| `observation.state` | Position X and Z in metres, then velocity X and Z in metres per second |
| `observation.goal` | Route destination X and Z in metres |
| `observation.waypoint` | Current route waypoint X and Z in metres, supplied to the controller |
| `action` | Commanded planar velocity X and Z in metres per second |
| `next.observation.state` | Measured cart state after the command interval |
| `next.contact_count` | Number of distinct obstacles contacted during that interval |
| `next.done`, `next.success` | Final transition and recorded successful completion, respectively |
| `observation.images.overhead` | With `--rgb`, a lossless overhead image of the simulated cart and its collision geometry before the action |

The final observation has no action. It is preserved as the final row’s next state. A trial that ends before any action appears in the conversion receipt with zero rows. A dataset requires at least one input with an action. Both successful and unsuccessful trials with actions are retained.

The receipt at `meta/brainsnn-episodes.json` links each recording’s SHA-256, canonical room and model digests, object, controller provenance, variant and recorded score to its LeRobot episode index. For RGB, the converter regenerates MJCF from the validated room primitives before replaying the commands. It checks positions and velocities against every recorded state to within 0.00001 in their respective SI units. It checks every decoded RGB observation against the native render. These views depict the simulated collision shapes. The showroom photographs remain separate evidence.

## Load a row

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

data = LeRobotDataset("brainsnn/showroom-delivery", root="delivery-rgb")
row = data[0]
print(row["timestamp"], row["observation.state"], row["action"])
print(row["observation.images.overhead"].shape)  # channels, height, width
```

The fixed controller has access to its saved route. A learning experiment can use that same waypoint input or explicitly hold it out. Keep complete rooms and routes together when splitting training and evaluation data to reduce overlap. Training a model for a different robot requires mapping its observations and controls to that robot’s cameras, joints and action space. [LeRobot format](https://huggingface.co/docs/lerobot/lerobot-dataset-v3) · [Physical Intelligence training guide](https://github.com/Physical-Intelligence/openpi#fine-tuning-base-models-on-your-own-data)

## Export the kitchen gripper

In **Make a robot task**, try the kitchen task. Save the run JSON for each attempt, including the attempt with the gripper open. Use the same Python environment and provide filenames for the two saved recordings.

```sh
python scripts/world-demo/export_kitchen_episodes.py grip.episode.json open.episode.json --output gripper-state
python scripts/world-demo/export_kitchen_episodes.py grip.episode.json open.episode.json --rgb --output gripper-rgb
```

This command produces its own dataset, `brainsnn/kitchen-pin`. Each command targets four actuator positions in metres for the carriage, elevator and two jaws. The 21 state values cover the free rolling pin’s position, quaternion and velocity and the four gripper joints’ positions and velocities. Feature names and units are recorded in `meta/info.json`. The contact columns indicate whether the pin touched either pad or the tray base during the most recent 2 ms physics step at the sample time. Each row pairs the state and command with the next state and contacts 50 ms later.

With `--rgb`, MuJoCo replays each command on the built-in kitchen model. Each image comes from its fixed side camera at the start of the command. The converter checks all recorded positions, velocities and contact flags against the replay and compares every decoded image with its native render. The six-second grip and open-gripper trials contribute 120 commands each. The final transition carries the recorded placement outcome, and the receipt retains the controller, lift height, tray rest time and success reason.
