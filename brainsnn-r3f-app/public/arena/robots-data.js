/* Researched robot integration routes. Upstream assets are not installed BrainSNN physics workers. */
(() => {
  'use strict';
  const menagerie = 'https://github.com/google-deepmind/mujoco_menagerie/tree/main/';
  const live = 'https://live.mujoco.org/?model=github:google-deepmind/mujoco_menagerie/main/';
  const robots = [
    {
      id: 'so101', name: 'SO-101', maker: 'The Robot Studio', type: 'arm', tag: 'Start here',
      summary: 'An accessible tabletop arm for sorting, pick-and-place and recovery experiments.',
      asset: 'robotstudio_so101',
      route: 'Fine-tune SmolVLA on your SO-101 task and compare it with ACT trained on the same demonstrations. MolmoAct2 publishes a separate SO-100/101 checkpoint.',
      contract: 'Calibrated camera views and ordered joint state in; joint targets and gripper actions out. Match units, normalization and control timing to the chosen checkpoint.',
      next: 'Reproduce one task in a physics worker, then use the same interface for a supervised EDU-arm experiment.',
      models: ['smolvla', 'act', 'molmo', 'diffusion'],
      source: 'https://github.com/TheRobotStudio/SO-ARM100', licenseLabel: 'Apache-2.0',
      tasks: ['Colour sorting', 'Pick & place', 'Recovery'], featured: true
    },
    {
      id: 'panda', name: 'Franka Panda', maker: 'Franka Robotics', type: 'arm', tag: 'Benchmark route',
      summary: 'A research arm with established manipulation benchmarks and reproducible model comparisons.',
      asset: 'franka_emika_panda',
      route: 'Start with a published LIBERO checkpoint and its exact benchmark environment. Candidate families include π₀.₅, OpenVLA-OFT, MolmoAct2 and GR00T.',
      contract: 'Preserve checkpoint-specific cameras, proprioception, action representation, gripper convention and timing. A standalone Panda asset does not reproduce LIBERO.',
      next: 'Reproduce an official benchmark result before adding controlled BrainSNN task variations.',
      models: ['pi05', 'openvla', 'molmo', 'groot', 'act', 'diffusion'],
      source: 'https://github.com/Lifelong-Robot-Learning/LIBERO', licenseLabel: 'Apache-2.0',
      tasks: ['Precision pick', 'Object relocation', 'Clutter recovery'], featured: true
    },
    {
      id: 'stretch3', name: 'Stretch 3', maker: 'Hello Robot', type: 'mobile', tag: 'Service tasks',
      summary: 'A mobile base, lift and telescoping arm bring retrieval and restocking into a room.',
      asset: 'hello_robot_stretch_3',
      route: 'Put a visual planner above verified navigation and manipulation skills. Learned motor control needs a Stretch-specific dataset, controller and checkpoint.',
      contract: 'Base velocity, lift and arm state plus calibrated cameras. Navigation and manipulation require separate limits and synchronized observations.',
      next: 'Build a navigation-and-retrieval task with a working controller, then test planning and recovery.',
      models: ['qwen', 'cosmosreason', 'act'],
      source: 'https://github.com/hello-robot/stretch_mujoco', licenseLabel: 'Apache-2.0',
      tasks: ['Room reset', 'Shelf retrieval', 'Object delivery'], featured: true
    },
    {
      id: 'aloha', name: 'ALOHA 2', maker: 'ALOHA 2 team', type: 'arm', tag: 'Two arms',
      summary: 'A bimanual setup for hand-offs, coordinated packing and manipulation with two grippers.',
      asset: 'aloha',
      route: 'Use ACT as a bimanual baseline. OpenPI, OpenVLA-OFT and RDT offer ALOHA-related workflows that need their exact robot, task and observation configuration.',
      contract: 'Synchronized camera views and two-arm state in; paired action chunks and gripper targets out. Match ALOHA generation, calibration and actuator conventions.',
      next: 'Reproduce a supported two-arm task with matched demonstrations before comparing larger policies.',
      models: ['act', 'openvla', 'rdt', 'diffusion'],
      source: 'https://aloha-2.github.io/', licenseLabel: 'BSD-3-Clause',
      tasks: ['Team handoff', 'Two-arm packing', 'Coordinated reach'], featured: false
    },
    {
      id: 'go2', name: 'Unitree Go2', maker: 'Unitree Robotics', type: 'quadruped', tag: 'Exploration',
      summary: 'A quadruped for route-following, inspection and changing-obstacle challenges.',
      asset: 'unitree_go2',
      route: 'A language or vision planner can choose bounded navigation skills above a separately verified locomotion controller. Manipulation VLAs do not provide a gait.',
      contract: 'IMU, joint state and scene observations feed the control stack. A locomotion policy executes velocity or gait targets beneath the planner.',
      next: 'Validate standing and walking in physics, then add route instructions and obstacle variations.',
      models: ['qwen', 'cosmosreason'],
      source: 'https://github.com/unitreerobotics/unitree_mujoco', licenseLabel: 'BSD-3-Clause',
      tasks: ['Obstacle route', 'Inspection circuit', 'Route recovery'], featured: false
    },
    {
      id: 'g1', name: 'Unitree G1', maker: 'Unitree Robotics', type: 'humanoid', tag: 'Whole-body research',
      summary: 'A humanoid route for reaching, balance and coordinated movement in bounded tasks.',
      asset: 'unitree_g1',
      route: 'GR00T documents a G1 SONIC workflow. It needs its specified embodiment, whole-body controller, task data and validation.',
      contract: 'Humanoid state, camera views and embodiment configuration. The whole-body controller must decode model outputs into stable motion.',
      next: 'Reproduce the reference controller workflow before introducing new missions or environments.',
      models: ['groot'],
      source: 'https://github.com/NVIDIA/Isaac-GR00T', licenseLabel: 'BSD-3-Clause',
      tasks: ['Supported reach', 'Balance study', 'Whole-body coordination'], featured: true
    },
    {
      id: 'ur5e', name: 'UR5e', maker: 'Universal Robots', type: 'arm', tag: 'Workcell research',
      summary: 'A six-axis industrial arm for repeatable reach, transfer and workcell experiments.',
      asset: 'universal_robots_ur5e',
      route: 'Train an ACT or diffusion baseline on a chosen UR5e task. A VLA needs a matching dataset and adaptation; a UR-family checkpoint is not automatic UR5e support.',
      contract: 'Six ordered joint states or a defined Cartesian control interface, calibrated cameras, and a separately specified tool or gripper. Match the controller and action rate.',
      next: 'Add the chosen end effector, validate reach and contact behavior, then collect repeatable task demonstrations.',
      models: ['act', 'diffusion', 'smolvla'],
      source: menagerie + 'universal_robots_ur5e', licenseLabel: 'BSD-3-Clause',
      tasks: ['Workcell reach', 'Part transfer', 'Obstacle clearance'], featured: false
    },
    {
      id: 'fr3', name: 'Franka Research 3', maker: 'Franka Robotics', type: 'arm', tag: 'Research manipulator',
      summary: 'A seven-axis research arm for reach studies and carefully configured manipulation tasks.',
      asset: 'franka_fr3',
      route: 'Build an FR3-specific imitation baseline or adapt a VLA to its data. Panda and DROID checkpoints require an explicit transfer study, not a robot-name swap.',
      contract: 'FR3 joint ordering, limits and actuator behavior; calibrated images and an explicit end effector. The included asset describes the arm, so configure the tool separately.',
      next: 'Validate the arm and tool model together, then compare policies on a held-out FR3 task set.',
      models: ['act', 'diffusion', 'smolvla'],
      source: menagerie + 'franka_fr3', licenseLabel: 'Apache-2.0',
      tasks: ['Reach precision', 'Grasp adaptation', 'Tool positioning'], featured: false
    },
    {
      id: 'gen3', name: 'Kinova Gen3', maker: 'Kinova Robotics', type: 'arm', tag: 'Seven-axis reach',
      summary: 'A seven-axis arm for constrained reaching, placement and camera-guided task research.',
      asset: 'kinova_gen3',
      route: 'Start with ACT or diffusion trained on your Gen3 task. VLA adaptation needs matching demonstrations and a verified Kortex-to-simulation interface.',
      contract: 'Ordered seven-joint state, wrist-camera calibration and tool-specific actions. If using a Robotiq gripper, preserve the mounting and end-effector offsets documented by the asset.',
      next: 'Validate tool geometry and controller behavior before collecting task demonstrations or scoring contacts.',
      models: ['act', 'diffusion', 'smolvla'],
      source: menagerie + 'kinova_gen3', licenseLabel: 'BSD-3-Clause',
      tasks: ['Constrained reach', 'Shelf placement', 'Camera-guided pick'], featured: false
    },
    {
      id: 'xarm7', name: 'xArm7', maker: 'UFACTORY', type: 'arm', tag: 'Tabletop manipulation',
      summary: 'A seven-axis arm and gripper asset for sorting, packing and manipulation experiments.',
      asset: 'ufactory_xarm7',
      route: 'Train a task-specific ACT or diffusion policy and compare an adapted SmolVLA model. xArm variants use different embodiments, so checkpoints need an exact match.',
      contract: 'Seven arm joints plus the gripper mechanism, calibrated cameras and a defined action space. Distinguish actuator commands from the model’s additional gripper joints.',
      next: 'Reproduce a scripted grasp in physics, check gripper contacts, then collect matched demonstrations.',
      models: ['act', 'diffusion', 'smolvla'],
      source: menagerie + 'ufactory_xarm7', licenseLabel: 'BSD-3-Clause',
      tasks: ['Object sorting', 'Tray packing', 'Grasp recovery'], featured: false
    },
    {
      id: 'piper', name: 'PiPER', maker: 'AgileX Robotics', type: 'arm', tag: 'Open arm route',
      summary: 'A compact arm with a parallel gripper for pick-and-place and data-collection experiments.',
      asset: 'agilex_piper',
      route: 'Train an ACT or diffusion baseline on the single-arm PiPER setup, then adapt a VLA. Bimanual PiPER demonstrations require a separate paired-arm configuration.',
      contract: 'Six arm joints, the coupled gripper, calibrated camera views and matching action normalization. Preserve the asset’s gripper coupling and actuator limits.',
      next: 'Validate the single-arm task and camera setup before collecting demonstrations or adding a second arm.',
      models: ['act', 'diffusion', 'smolvla'],
      source: menagerie + 'agilex_piper', licenseLabel: 'MIT',
      tasks: ['Bin sorting', 'Object relocation', 'Grip recovery'], featured: false
    },
    {
      id: 'widowx', name: 'WidowX 250S', maker: 'Trossen Robotics', type: 'arm', tag: 'Dataset bridge',
      summary: 'A six-axis research arm for tabletop tasks and carefully matched dataset experiments.',
      asset: 'trossen_wx250s',
      route: 'Octo provides a useful Bridge-data adaptation route; reproduce the precise WidowX setup, camera and action processing. ACT and diffusion offer custom-trained baselines.',
      contract: 'Six arm joints and coupled gripper state, calibrated images, and matching joint or end-effector actions. The Menagerie asset alone does not reproduce the Bridge environment.',
      next: 'Match a reference controller and camera configuration before reusing a checkpoint or introducing new tasks.',
      models: ['octo', 'act', 'diffusion'],
      source: menagerie + 'trossen_wx250s', licenseLabel: 'BSD-3-Clause',
      tasks: ['Tabletop transfer', 'Language grounding', 'Grasp recovery'], featured: false
    },
    {
      id: 'tiago', name: 'TIAGo', maker: 'PAL Robotics', type: 'mobile', tag: 'Room-scale tasks',
      summary: 'A mobile manipulator for navigation, retrieval and combined room-scale task research.',
      asset: 'pal_tiago',
      route: 'Use a visual planner over verified navigation and arm skills. A learned motion policy needs TIAGo-specific demonstrations and an explicit whole-robot interface.',
      contract: 'Mobile-base motion, lift, arm, head and gripper state. Choose the asset’s position, velocity or motor-control variant and keep that contract consistent.',
      next: 'Validate base and arm controllers separately, then combine them in a bounded retrieve-and-deliver task.',
      models: ['qwen', 'cosmosreason', 'act'],
      source: menagerie + 'pal_tiago', licenseLabel: 'Apache-2.0',
      tasks: ['Room navigation', 'Shelf retrieval', 'Delivery planning'], featured: false
    }
  ];
  window.BrainSNNRobots = robots.map(robot => Object.freeze({
    ...robot,
    viewer: live + robot.asset + (robot.id === 'tiago' ? '/scene_position.xml' : '/scene.xml'),
    image: 'assets/robots/' + robot.id + '.png'
  }));
})();
