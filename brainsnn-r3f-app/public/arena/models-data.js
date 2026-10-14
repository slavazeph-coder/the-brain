/* Researched model candidates, 2026-10-13. Nothing in this registry installs or runs a model. */
window.BrainSNNModels = [
  {
    "id": "qwen",
    "name": "Qwen3-VL",
    "variant": "4B Instruct",
    "org": "Qwen",
    "type": "planner",
    "size": "4B",
    "status": "Adapter needed",
    "checkpoint": "Qwen/Qwen3-VL-4B-Instruct",
    "contract": "Images or video + instruction → text or structured skill response. BrainSNN must validate the response before executing a bounded skill.",
    "route": "The existing skill-agent interface, through your own compatible endpoint. This is a vision-language planner, not a motor-control policy.",
    "compute": "Self-hosted GPU inference or a compatible endpoint. Measure latency at your chosen image resolution and context size before estimating cost.",
    "license": "Apache-2.0 model card. Serving software and dependencies have their own licenses.",
    "sources": [
      [
        "Official model card",
        "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct"
      ]
    ],
    "accent": "cyan",
    "symbol": "Q",
    "summary": "Let a vision model choose the next skill.",
    "robotIds": [
      "so101",
      "panda",
      "stretch3",
      "aloha",
      "go2",
      "g1",
      "ur5e",
      "fr3",
      "gen3",
      "xarm7",
      "piper",
      "widowx",
      "tiago"
    ],
    "tasks": [
      "Planning",
      "Scene reasoning",
      "Recovery"
    ],
    "licenseLabel": "Apache-2.0",
    "readyConditions": [
      "Serve the chosen checkpoint behind a compatible endpoint.",
      "Map final model output to the bounded BrainSNN skill schema.",
      "Validate every action; retain the separate robot controller."
    ],
    "featured": true,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [],
    "workflowEvidenceNote": "General vision-language planning only. No official workflow matching a catalog robot was verified; each body needs a validated skill adapter and controller."
  },
  {
    "id": "smolvla",
    "name": "SmolVLA",
    "variant": "Affordable robot control",
    "org": "Hugging Face",
    "type": "vla",
    "size": "450M",
    "status": "Physics worker needed",
    "checkpoint": "lerobot/smolvla_base",
    "contract": "Multi-view RGB + robot state + instruction → continuous action chunks. The base model needs task-specific adaptation and matched processing.",
    "route": "SO-101 pick-and-place with a calibrated camera setup. Compare with ACT using the same demonstrations and task conditions.",
    "compute": "Authors document consumer hardware and CPU deployment. Use measured end-to-end throughput; CPU support is not a realtime performance guarantee.",
    "license": "Apache-2.0 weights and LeRobot code. Check any third-party fine-tuned checkpoint separately.",
    "sources": [
      [
        "Official model card",
        "https://huggingface.co/lerobot/smolvla_base"
      ],
      [
        "Architecture and examples",
        "https://huggingface.co/blog/smolvla"
      ],
      [
        "SO-101 fine-tuning and rollout workflow",
        "https://huggingface.co/docs/lerobot/en/smolvla"
      ]
    ],
    "accent": "cyan",
    "symbol": "s",
    "summary": "The practical first brain for an EDU arm.",
    "robotIds": [
      "so101",
      "panda",
      "aloha",
      "ur5e",
      "fr3",
      "gen3",
      "xarm7",
      "piper",
      "widowx"
    ],
    "tasks": [
      "Manipulation",
      "Imitation learning",
      "Recovery"
    ],
    "licenseLabel": "Apache-2.0",
    "readyConditions": [
      "Fine-tune on the chosen robot, task and calibrated cameras.",
      "Use the checkpoint’s state order, processing and normalization.",
      "Connect a matched physics/controller worker before evaluation."
    ],
    "featured": true,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "so101"
    ],
    "workflowEvidenceNote": "LeRobot documents SO-101 follower rollout after fine-tuning on the task and camera setup. The generic base is not an SO-101 task checkpoint, and the catalog mesh is not a validated simulator integration."
  },
  {
    "id": "act",
    "name": "ACT",
    "variant": "Imitation baseline",
    "org": "LeRobot",
    "type": "baseline",
    "size": "~80M",
    "status": "Physics worker needed",
    "checkpoint": "LeRobot policy.type=act",
    "contract": "Multi-view RGB + joint positions → a chunk of future actions. Standard ACT is an imitation policy, not a language model.",
    "route": "Train on the same SO-101 or bimanual task demonstrations as the larger policy. Compare success, latency and recovery on held-out episodes.",
    "compute": "LeRobot documents training in a few hours on one GPU. Runtime and training cost depend on the dataset, camera setup and batch size.",
    "license": "LeRobot ACT implementation: Apache-2.0. Uploaded policy weights and datasets require their own license check.",
    "sources": [
      [
        "Official documentation",
        "https://huggingface.co/docs/lerobot/en/act"
      ],
      [
        "Implementation and license",
        "https://github.com/huggingface/lerobot/blob/main/src/lerobot/policies/act/modeling_act.py"
      ]
    ],
    "accent": "mint",
    "symbol": "a",
    "summary": "A small baseline that keeps comparisons honest.",
    "robotIds": [
      "so101",
      "panda",
      "aloha",
      "ur5e",
      "fr3",
      "gen3",
      "xarm7",
      "piper",
      "widowx",
      "stretch3",
      "tiago"
    ],
    "tasks": [
      "Imitation learning",
      "Manipulation",
      "Bimanual"
    ],
    "licenseLabel": "Apache-2.0 code",
    "readyConditions": [
      "Train a checkpoint for the selected body and task.",
      "Match joint ordering, camera views and action horizon.",
      "Evaluate on held-out episodes shared with the larger policy."
    ],
    "featured": true,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "so101"
    ],
    "workflowEvidenceNote": "LeRobot documents training ACT and rolling out a task-trained policy on an SO-101 follower. Other listed bodies are proposed custom-training routes; there is no universal ACT checkpoint."
  },
  {
    "id": "pi05",
    "name": "π₀.₅",
    "variant": "OpenPI · LIBERO",
    "org": "Physical Intelligence",
    "type": "vla",
    "size": "~4B¹",
    "status": "Physics worker needed",
    "checkpoint": "gs://openpi-assets/checkpoints/pi05_libero/",
    "contract": "LIBERO agent and wrist images + 8 state values + instruction → 7D Cartesian/gripper actions. Native OpenPI and LeRobot use different processing and must keep their own exact evaluation recipe.",
    "route": "Start with the published LIBERO checkpoint in its matching Panda benchmark environment. Base and DROID checkpoints have different requirements.",
    "compute": "Upstream inference guidance: over 8 GB GPU memory for the model. Simulation, rendering and batching need additional headroom. ¹HF rounds the converted checkpoint to 4B.",
    "license": "OpenPI code is Apache-2.0. Check the selected checkpoint and underlying model terms before deployment.",
    "sources": [
      [
        "OpenPI official checkpoints",
        "https://github.com/Physical-Intelligence/openpi"
      ],
      [
        "LIBERO evaluation recipe",
        "https://github.com/Physical-Intelligence/openpi/tree/main/examples/libero"
      ],
      [
        "LeRobot alternative checkpoint",
        "https://huggingface.co/lerobot/pi05_libero_finetuned"
      ]
    ],
    "accent": "violet",
    "symbol": "π",
    "summary": "A matched Panda policy for a real physics worker.",
    "robotIds": [
      "panda"
    ],
    "tasks": [
      "Manipulation",
      "LIBERO",
      "Generalization"
    ],
    "licenseLabel": "Checkpoint-specific terms",
    "readyConditions": [
      "Start the pi05_libero OpenPI policy server with the LIBERO checkpoint.",
      "Connect a BrainSNN LIBERO worker using its exact camera, state and action contract.",
      "Choose a worker-advertised task and check the loaded checkpoint before running."
    ],
    "featured": false,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda"
    ],
    "workflowEvidenceNote": "The native OpenPI LIBERO example specifies Panda environment state, camera rotation, action processing and a five-action replanning horizon. The BrainSNN adapter follows that native route. The LeRobot reproduction is a separate profile.",
    "checkpointsByRobot": {
      "panda": "gs://openpi-assets/checkpoints/pi05_libero/"
    }
  },
  {
    "id": "molmo",
    "name": "MolmoAct2",
    "variant": "Embodied action model",
    "org": "Ai2",
    "type": "vla",
    "size": "5B",
    "status": "Physics worker needed",
    "checkpoint": "allenai/MolmoAct2-SO100_101",
    "contract": "RGB views + raw joint state + instruction → absolute joint-pose actions for the SO-100/101 checkpoint. Use its saved normalization metadata.",
    "route": "An SO-100/101 checkpoint for the EDU path, or the separate LIBERO-LeRobot checkpoint for a Panda benchmark. These routes use different processing.",
    "compute": "SO checkpoint authors report under 16 GB in BF16; about 24–26 GB in FP32. These measurements depend on settings and exclude your simulator.",
    "license": "Official code and LIBERO checkpoint: Apache-2.0. Confirm SO-100/101 weight terms separately; its card does not state a license. Retain Ai2 intended-use guidance.",
    "sources": [
      [
        "SO-100/101 checkpoint",
        "https://huggingface.co/allenai/MolmoAct2-SO100_101"
      ],
      [
        "LIBERO checkpoint and license",
        "https://huggingface.co/allenai/MolmoAct2-LIBERO-LeRobot"
      ],
      [
        "Official repository",
        "https://github.com/allenai/molmoact2"
      ]
    ],
    "accent": "mint",
    "symbol": "m",
    "summary": "A newer comparison for arms and benchmarks.",
    "robotIds": [
      "so101",
      "panda"
    ],
    "tasks": [
      "Manipulation",
      "LIBERO",
      "Action reasoning"
    ],
    "licenseLabel": "Checkpoint-specific",
    "readyConditions": [
      "Choose the separate SO-100/101 or LIBERO checkpoint.",
      "Confirm weight terms for the chosen checkpoint.",
      "Restore its normalization, control mode and camera processing."
    ],
    "featured": false,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "so101",
      "panda"
    ],
    "workflowEvidenceNote": "The SO-100/101 and LIBERO-LeRobot releases are separate workflows with different processing and action contracts. SO-101 uses the SO100_101 release; Panda uses LIBERO-LeRobot in its matched benchmark, never the SO weights.",
    "checkpointsByRobot": {
      "so101": "allenai/MolmoAct2-SO100_101",
      "panda": "allenai/MolmoAct2-LIBERO-LeRobot"
    }
  },
  {
    "id": "openvla",
    "name": "OpenVLA-OFT",
    "variant": "Optimized fine-tuning",
    "org": "OpenVLA research team",
    "type": "vla",
    "size": "7B",
    "status": "Physics worker needed",
    "checkpoint": "moojink/openvla-7b-oft-finetuned-libero-spatial",
    "contract": "Third-person image + wrist image + proprioception + task → continuous action chunks. Use the checkpoint’s action head and unnormalization key.",
    "route": "LIBERO Spatial on Panda first. A separate ALOHA workflow supports bimanual experiments with its matched configuration.",
    "compute": "Official inference guidance: about 16 GB VRAM for LIBERO and 18 GB for ALOHA. Add capacity for simulation and rendering.",
    "license": "OFT code and checkpoint are tagged MIT. Underlying OpenVLA derives from Llama 2 and inherits its Community License conditions.",
    "sources": [
      [
        "Official implementation",
        "https://github.com/moojink/openvla-oft"
      ],
      [
        "LIBERO checkpoint",
        "https://huggingface.co/moojink/openvla-7b-oft-finetuned-libero-spatial"
      ],
      [
        "Underlying model license notes",
        "https://github.com/openvla/openvla"
      ],
      [
        "Separate ALOHA training and evaluation",
        "https://github.com/moojink/openvla-oft/blob/main/ALOHA.md"
      ]
    ],
    "accent": "violet",
    "symbol": "v",
    "summary": "A well-defined benchmark comparison.",
    "robotIds": [
      "panda",
      "aloha"
    ],
    "tasks": [
      "Manipulation",
      "LIBERO",
      "Bimanual"
    ],
    "licenseLabel": "MIT + Llama 2 terms",
    "readyConditions": [
      "Load the exact OFT checkpoint, action head and processor.",
      "Use the matching LIBERO or ALOHA environment configuration.",
      "Preserve inherited Llama 2 terms when serving or distributing."
    ],
    "featured": false,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda",
      "aloha"
    ],
    "workflowEvidenceNote": "Official guides cover LIBERO Panda and separate real ALOHA training/evaluation. The mapped weights are LIBERO Spatial only. ALOHA requires its own task-trained checkpoint and matched hardware/configuration; the catalog ALOHA 2 asset does not establish parity.",
    "checkpointsByRobot": {
      "panda": "moojink/openvla-7b-oft-finetuned-libero-spatial"
    }
  },
  {
    "id": "groot",
    "name": "GR00T N1.7",
    "variant": "Cross-embodiment VLA",
    "org": "NVIDIA",
    "type": "vla",
    "size": "3B",
    "status": "Physics worker needed",
    "checkpoint": "nvidia/GR00T-N1.7-3B",
    "contract": "RGB + proprioception + instruction + embodiment ID → action chunks. Modality configuration, action convention and normalization follow the embodiment.",
    "route": "Use a matching LIBERO or DROID checkpoint first. G1 whole-body work requires the documented SONIC controller and workflow.",
    "compute": "Official repository: at least 16 GB VRAM for inference; 40 GB+ recommended for fine-tuning. The Cosmos backbone requires model access.",
    "license": "Code: Apache-2.0. The N1.7 weights card and gated Cosmos-Reason2 backbone specify NVIDIA Open Model License terms.",
    "sources": [
      [
        "Official reference stack",
        "https://github.com/NVIDIA/Isaac-GR00T"
      ],
      [
        "N1.7 weights and terms",
        "https://huggingface.co/nvidia/GR00T-N1.7-3B"
      ],
      [
        "Cosmos backbone terms",
        "https://huggingface.co/nvidia/Cosmos-Reason2-2B"
      ]
    ],
    "accent": "cyan",
    "symbol": "g",
    "summary": "A path from manipulation to humanoid research.",
    "robotIds": [
      "panda",
      "g1",
      "so101"
    ],
    "tasks": [
      "Manipulation",
      "LIBERO",
      "Humanoid research"
    ],
    "licenseLabel": "NVIDIA model terms",
    "readyConditions": [
      "Obtain required backbone access and choose a matched checkpoint.",
      "Verify embodiment tag, state/action fields and normalization.",
      "For G1, integrate the documented whole-body controller separately."
    ],
    "featured": false,
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda",
      "g1"
    ],
    "workflowEvidenceNote": "N1.7 documents LIBERO Panda and a G1 collect/fine-tune/deploy workflow using SONIC. LIBERO weights require selection of the suite subfolder within nvidia/GR00T-N1.7-LIBERO; G1 needs a separate task-trained policy and SONIC decoder. Neither is resolved from the base checkpoint automatically."
  },
  {
    "id": "octo",
    "name": "Octo",
    "variant": "Base 1.5",
    "org": "Octo Model Team",
    "type": "vla",
    "size": "93M",
    "summary": "A compact generalist controlled by language or a goal image.",
    "checkpoint": "rail-berkeley/octo-base-1.5",
    "robotIds": [
      "widowx",
      "panda"
    ],
    "tasks": [
      "Manipulation",
      "Goal images",
      "Transfer learning"
    ],
    "status": "Physics worker needed",
    "licenseLabel": "MIT",
    "license": "Official code and Base 1.5 model card: MIT. Retain terms for T5 and dataset components when building the complete stack.",
    "compute": "Upstream reports 13 inference iterations per second on one RTX 4090 for Octo-Base. That is a model measurement, not complete simulated episodes per second.",
    "contract": "Primary and optional wrist images with up to two history frames, plus language or goal images, produce four future 7D actions. Apply the correct dataset unnormalization and history masks.",
    "route": "Reproduce the reference WidowX/Bridge rollout with its actual cameras and controller, or fine-tune a matched Panda task. The listed WidowX250s asset alone does not establish Bridge parity.",
    "sources": [
      [
        "Official checkpoint",
        "https://huggingface.co/rail-berkeley/octo-base-1.5"
      ],
      [
        "Reference code and evaluation",
        "https://github.com/octo-models/octo"
      ]
    ],
    "featured": false,
    "accent": "mint",
    "symbol": "o",
    "readyConditions": [
      "Wrap the matched environment with history and padding masks.",
      "Verify action scaling, gripper convention and camera arrangement.",
      "Reproduce a reference rollout before adding new perturbations."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "widowx"
    ],
    "workflowEvidenceNote": "The official real-robot example evaluates Octo on WidowX with its Bridge-compatible environment. Verify cameras, normalization, arm variant and controller; the catalog WidowX250s mesh is not proof of Bridge parity. The base remains a reference until that workflow is selected."
  },
  {
    "id": "rdt",
    "name": "RDT-1B",
    "variant": "Bimanual diffusion policy",
    "org": "Tsinghua / RDT team",
    "type": "vla",
    "size": "1.2B policy",
    "summary": "A foundation policy for coordinated two-arm manipulation.",
    "checkpoint": "robotics-diffusion-transformer/rdt-1b",
    "robotIds": [
      "aloha",
      "panda"
    ],
    "tasks": [
      "Bimanual",
      "Manipulation",
      "Imitation learning"
    ],
    "status": "Physics worker needed",
    "licenseLabel": "MIT + encoder terms",
    "license": "RDT code and released policy weights: MIT. T5-XXL, SigLIP and external datasets are separate components with their own terms.",
    "compute": "The 1.2B policy is only part of the stack. The large T5 encoder can dominate memory; upstream recommends precomputed language embeddings on an RTX 4090 or smaller GPU.",
    "contract": "Instruction embeddings, current proprioception and ordered camera history produce action chunks in a unified physical state space. Robot-to-state and action-to-joint mappings must be implemented.",
    "route": "Use the documented Mobile ALOHA workflow or a task-specific ManiSkill checkpoint. The ALOHA 2 preview is a proposed adaptation target, not the Mobile ALOHA reference platform.",
    "sources": [
      [
        "Official weights",
        "https://huggingface.co/robotics-diffusion-transformer/rdt-1b"
      ],
      [
        "Robot mappings and simulation guide",
        "https://github.com/thu-ml/RoboticsDiffusionTransformer"
      ]
    ],
    "featured": false,
    "accent": "violet",
    "symbol": "r",
    "readyConditions": [
      "Select and adapt a checkpoint for the exact embodiment.",
      "Implement physical-unit mappings and the prescribed camera order.",
      "Profile policy and language encoder memory separately."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "aloha"
    ],
    "workflowEvidenceNote": "The authors document Mobile ALOHA deployment using a fine-tuned checkpoint, camera ordering and robot-state/action mappings. The catalog ALOHA 2 body is a related adaptation target, not the same mobile hardware; no base-to-body checkpoint assignment is made."
  },
  {
    "id": "pi0fast",
    "name": "π₀-FAST",
    "variant": "Autoregressive action tokens",
    "org": "Physical Intelligence / LeRobot",
    "type": "vla",
    "size": "~3B",
    "summary": "Compare tokenized action generation with flow-based policies.",
    "checkpoint": "lerobot/pi0fast-base",
    "robotIds": [
      "panda"
    ],
    "tasks": [
      "Manipulation",
      "Action tokenization",
      "LIBERO"
    ],
    "status": "Physics worker needed",
    "licenseLabel": "Gemma weights",
    "license": "OpenPI and LeRobot code: Apache-2.0. The base weight card is tagged Gemma. The documented LIBERO checkpoint has no model card; verify its inherited terms before deployment.",
    "compute": "Use a GPU worker and measure token generation plus FAST decoding latency. Do not infer a realtime control rate or campaign price from the model name.",
    "contract": "Images, robot state and instruction produce autoregressive FAST tokens; the matching tokenizer decodes them into continuous action chunks. Action cadence and normalization must match training.",
    "route": "Fine-tune the base for the selected task, or reproduce LeRobot’s documented lerobot/pi0fast-libero evaluation after checking checkpoint terms. Compare on the same Panda task as π₀.₅.",
    "sources": [
      [
        "Base weights and license",
        "https://huggingface.co/lerobot/pi0fast-base"
      ],
      [
        "Official integration and evaluation",
        "https://huggingface.co/docs/lerobot/en/pi0fast"
      ],
      [
        "Documented LIBERO weights",
        "https://huggingface.co/lerobot/pi0fast-libero"
      ]
    ],
    "featured": false,
    "accent": "cyan",
    "symbol": "π",
    "readyConditions": [
      "Pin the FAST tokenizer and its action decoding configuration.",
      "Select a task-matched checkpoint and verify its terms.",
      "Reproduce the official camera mapping and action execution horizon."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda"
    ],
    "workflowEvidenceNote": "LeRobot documents lerobot/pi0fast-libero evaluation in LIBERO. Use the released benchmark checkpoint and matching processors/control mode rather than the generic base; verify the checkpoint terms before deployment.",
    "checkpointsByRobot": {
      "panda": "lerobot/pi0fast-libero"
    }
  },
  {
    "id": "diffusion",
    "name": "Diffusion Policy",
    "variant": "Task-trained baseline",
    "org": "Columbia / TRI / MIT",
    "type": "baseline",
    "size": "Config-dependent",
    "summary": "A strong imitation baseline for smooth action sequences.",
    "checkpoint": "Task-specific checkpoint; no universal robot checkpoint",
    "robotIds": [
      "so101",
      "panda",
      "aloha",
      "ur5e",
      "fr3",
      "gen3",
      "xarm7",
      "piper",
      "widowx"
    ],
    "tasks": [
      "Imitation learning",
      "Manipulation",
      "Pushing"
    ],
    "status": "Physics worker needed",
    "licenseLabel": "MIT code",
    "license": "Official repository: MIT. Published task checkpoints and training datasets should be checked individually; this entry does not designate a universal licensed weight package.",
    "compute": "Runtime depends on the selected CNN or Transformer, camera setup, diffusion steps and action horizon. Train and profile the baseline on the same task data as the larger policy.",
    "contract": "Images or low-dimensional observations condition a diffusion model over action sequences. The controller consumes a receding horizon; standard policies do not supply a language interface.",
    "route": "Reproduce one published Push-T or robomimic experiment, then train on the chosen arm. The authors also document a real UR5/UR5e Push-T workflow with specific hardware.",
    "sources": [
      [
        "Official code, tasks and checkpoints",
        "https://github.com/real-stanford/diffusion_policy"
      ],
      [
        "Authors’ project",
        "https://diffusion-policy.cs.columbia.edu/"
      ]
    ],
    "featured": false,
    "accent": "mint",
    "symbol": "d",
    "readyConditions": [
      "Choose a specific task config and training dataset.",
      "Train or select a checkpoint matching the observations and actions.",
      "Use the same held-out scenarios and budget as the comparison policy."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda",
      "ur5e"
    ],
    "workflowEvidenceNote": "Official workflows include robomimic/robosuite Panda tasks and real UR5/UR5e Push-T with RTDE, two RealSense D415 cameras and a task-specific tool. Select the exact experiment config and trained checkpoint; generic body assets do not recreate either setup."
  },
  {
    "id": "xvla",
    "name": "X-VLA",
    "variant": "Soft-prompt adaptation",
    "org": "2toINF / LeRobot",
    "type": "vla",
    "size": "0.9B",
    "summary": "Adapt one backbone to different robot setups.",
    "checkpoint": "lerobot/xvla-libero",
    "robotIds": [
      "panda",
      "widowx",
      "so101"
    ],
    "tasks": [
      "Manipulation",
      "Transfer learning",
      "LIBERO"
    ],
    "status": "Physics worker needed",
    "licenseLabel": "Apache-2.0",
    "license": "Reference code and the LeRobot LIBERO checkpoint are labeled Apache-2.0. Check each other checkpoint, backbone and dataset when changing the route.",
    "compute": "A 0.9B model family. LeRobot recommends BF16 for adaptation; memory depends on frozen versus trained components and batch size. Profile the full worker before setting a compute budget.",
    "contract": "Images, state, instruction and learned domain prompts condition continuous flow-matching actions. The LIBERO recipe explicitly uses absolute control; do not substitute delta actions.",
    "route": "Start with the exact LIBERO checkpoint on Panda. Separate WidowX and base checkpoints support other workflows; SO-101 adaptation is documented but requires its own training/configuration.",
    "sources": [
      [
        "LIBERO checkpoint",
        "https://huggingface.co/lerobot/xvla-libero"
      ],
      [
        "LeRobot routes and control modes",
        "https://huggingface.co/docs/lerobot/xvla"
      ],
      [
        "Official reference repository",
        "https://github.com/2toinf/X-VLA"
      ],
      [
        "Separate WidowX checkpoint",
        "https://huggingface.co/lerobot/xvla-widowx"
      ]
    ],
    "featured": false,
    "accent": "violet",
    "symbol": "x",
    "readyConditions": [
      "Load the checkpoint’s domain prompt and processing.",
      "Use absolute LIBERO control for the published route.",
      "Choose a separate matched checkpoint or train for other bodies."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda",
      "widowx"
    ],
    "workflowEvidenceNote": "Official releases cover LIBERO Panda in absolute control and a separate Bridge/WidowX checkpoint. Camera layout, domain prompt, state and action mode must match. The SO-101 documentation is a bimanual adaptation recipe, not a released checkpoint for this single-arm asset.",
    "checkpointsByRobot": {
      "panda": "lerobot/xvla-libero",
      "widowx": "lerobot/xvla-widowx"
    }
  },
  {
    "id": "walloss",
    "name": "WALL-OSS 0.5",
    "variant": "Cross-embodiment research",
    "org": "X Square Robot",
    "type": "vla",
    "size": "4B",
    "summary": "Explore a policy with explicit robot-specific normalization.",
    "checkpoint": "x-square-robot/wall-oss-0.5",
    "robotIds": [
      "panda",
      "aloha",
      "widowx",
      "ur5e"
    ],
    "tasks": [
      "Manipulation",
      "Bimanual",
      "Transfer learning"
    ],
    "status": "Research only",
    "licenseLabel": "Weight terms unverified",
    "license": "Wall-X reference code: Apache-2.0. The selected 0.5 weight card does not state a license. Confirm checkpoint and underlying Qwen terms before commercial deployment or redistribution.",
    "compute": "The official 4B stack includes custom CUDA components. No general minimum VRAM claim is made here; measure the selected camera, action and batch configuration.",
    "contract": "Visual observations, instruction, state and an embodiment-specific norm_key feed continuous action generation. The key controls how the model interprets robot state and actions.",
    "route": "Study the documented DROID, Bridge, UR5 or ALOHA normalization routes, then verify the precise body and controller. A similarly named asset is not sufficient compatibility evidence.",
    "sources": [
      [
        "Selected checkpoint and embodiment keys",
        "https://huggingface.co/x-square-robot/wall-oss-0.5"
      ],
      [
        "Reference code and license",
        "https://github.com/X-Square-Robot/wall-x"
      ]
    ],
    "featured": false,
    "accent": "violet",
    "symbol": "w",
    "readyConditions": [
      "Resolve the exact weight license.",
      "Verify the checkpoint’s norm_key, state layout and action convention.",
      "Reproduce the reference workflow before claiming BrainSNN support."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [],
    "workflowEvidenceNote": "Checkpoint normalization keys describe embodiment families, but an exact catalog-body rollout and usable weight terms were not verified. Listed robots remain research adaptation candidates."
  },
  {
    "id": "cosmosreason",
    "name": "Cosmos Reason 2",
    "variant": "2B physical reasoning",
    "org": "NVIDIA",
    "type": "planner",
    "size": "2B",
    "summary": "Reason about a robot’s video, scene and next step.",
    "checkpoint": "nvidia/Cosmos-Reason2-2B",
    "robotIds": [
      "so101",
      "panda",
      "stretch3",
      "aloha",
      "go2",
      "g1",
      "ur5e",
      "fr3",
      "gen3",
      "xarm7",
      "piper",
      "widowx",
      "tiago"
    ],
    "tasks": [
      "Scene reasoning",
      "Planning",
      "Video understanding"
    ],
    "status": "Adapter needed",
    "licenseLabel": "NVIDIA model terms",
    "license": "Weights use the gated NVIDIA Open Model License. The Qwen3-VL base and serving code have separate terms. Required access and attribution must be preserved.",
    "compute": "The official card tests BF16 inference on NVIDIA hardware. Video length, frame sampling and output length materially affect latency; benchmark a short observation window first.",
    "contract": "Text plus image/video produce text reasoning or an answer. A separate adapter must select and validate bounded robot skills; it does not produce ready-to-execute joint control.",
    "route": "Use as an observer or high-level planner above an existing robot controller. Compare instruction following and recovery decisions with Qwen on identical observations.",
    "sources": [
      [
        "Official model card and terms",
        "https://huggingface.co/nvidia/Cosmos-Reason2-2B"
      ]
    ],
    "featured": false,
    "accent": "cyan",
    "symbol": "c",
    "readyConditions": [
      "Obtain access to the exact weight revision.",
      "Build an endpoint that maps final outputs to the allowed skill schema.",
      "Keep low-level control, validation and timing outside the VLM."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [],
    "workflowEvidenceNote": "This model reasons over images/video and text. No catalog-body motor-control workflow was verified; a separate validated skill/controller layer is required."
  },
  {
    "id": "cosmospredict",
    "name": "Cosmos Predict 2.5",
    "variant": "2B world generation",
    "org": "NVIDIA",
    "type": "world",
    "size": "2B",
    "summary": "Explore visual futures and synthetic scenario ideas.",
    "checkpoint": "nvidia/Cosmos-Predict2.5-2B",
    "robotIds": [],
    "tasks": [
      "World generation",
      "Synthetic video",
      "Scenario design"
    ],
    "status": "Research only",
    "licenseLabel": "NVIDIA model terms",
    "license": "Gated weights: NVIDIA Open Model License. Separate software and component notices apply. Preserve the model’s required attribution if integrated.",
    "compute": "GPU video generation requires a separate worker. Resolution, clip length, denoising settings and auxiliary components determine memory and runtime; do not price from 2B alone.",
    "contract": "Text plus an image or video condition a generated video. It does not output robot actions, contacts, collision metrics or an executable 3D physics scene.",
    "route": "An optional scenario-design or synthetic-data tool. Generated clips can inspire visual conditions; every scored robot test must still run in a validated environment.",
    "sources": [
      [
        "Official world-model card",
        "https://huggingface.co/nvidia/Cosmos-Predict2.5-2B"
      ],
      [
        "Official generation stack",
        "https://github.com/nvidia-cosmos/cosmos-predict2.5"
      ]
    ],
    "featured": false,
    "accent": "violet",
    "symbol": "∞",
    "readyConditions": [
      "Establish the exact data-generation use case and model access.",
      "Validate generated data quality and licensing for its downstream use.",
      "Keep generated video separate from physics-backed evaluation evidence."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "World-generation tool; no direct robot-control pairing.",
    "documentedRobotIds": [],
    "workflowEvidenceNote": "This release generates video. It has no documented robot action or physics-control workflow and no robot checkpoint assignment."
  },
  {
    "id": "lingbotva",
    "name": "LingBot-VA",
    "variant": "Video-action world model",
    "org": "Robbyant / LeRobot",
    "type": "world",
    "size": "~5B + encoders",
    "summary": "Compare an imagined future with a robot’s actual rollout.",
    "checkpoint": "lerobot/lingbot_va_libero_long",
    "robotIds": [
      "panda"
    ],
    "tasks": [
      "World prediction",
      "Manipulation",
      "Long-horizon tasks"
    ],
    "status": "Research only",
    "licenseLabel": "Apache-2.0",
    "license": "The LeRobot checkpoint and upstream model are labeled Apache-2.0. Wan VAE, UMT5 and tokenizer assets are separate dependencies; retain their notices.",
    "compute": "LeRobot documents a single 24–32 GB GPU route with the large text encoder on CPU. Additional encoder assets are downloaded separately. Streaming evaluation currently uses one environment at a time.",
    "contract": "Camera history and text drive intertwined predictions of future video latents and end-effector actions. Observed keyframes update the cache; predicted video remains distinct from recorded evidence.",
    "route": "Reproduce the LIBERO-Long Panda workflow and save predicted versus simulator-rendered video side by side. This is a research integration, not a drop-in replacement for the browser controller.",
    "sources": [
      [
        "LeRobot checkpoint",
        "https://huggingface.co/lerobot/lingbot_va_libero_long"
      ],
      [
        "Integration, action layout and requirements",
        "https://huggingface.co/docs/lerobot/en/lingbot_va"
      ],
      [
        "Official upstream repository",
        "https://github.com/Robbyant/lingbot-va"
      ]
    ],
    "featured": false,
    "accent": "mint",
    "symbol": "l",
    "readyConditions": [
      "Pin checkpoint, VAE, text encoder and camera processing together.",
      "Run the matched LIBERO action schema and single-environment loop.",
      "Label predicted video separately from observed simulator video."
    ],
    "added": "2026-10-13",
    "robotMatchNote": "Listed robots are proposed integration routes, not verified BrainSNN compatibility. Match the checkpoint, cameras, state, actions and controller.",
    "documentedRobotIds": [
      "panda"
    ],
    "workflowEvidenceNote": "The released LIBERO-Long workflow uses two camera views and seven end-effector/gripper action values on the benchmark Panda, alongside video prediction. It requires a matched physics and video-action worker; generated video must remain distinct from observed simulator frames.",
    "checkpointsByRobot": {
      "panda": "lerobot/lingbot_va_libero_long"
    },
    "executionTrack": "matched-physics-video-action"
  },
  {
    "id": "sonic",
    "name": "GEAR-SONIC",
    "variant": "G1 whole-body controller",
    "org": "NVIDIA",
    "type": "controller",
    "size": "29 DoF",
    "status": "G1 worker needed",
    "checkpoint": "nvidia/GEAR-SONIC",
    "checkpointsByRobot": {
      "g1": "nvidia/GEAR-SONIC"
    },
    "contract": "Motion reference + body state → matched encoder/decoder → 29 joint targets. Keep the controller variant, observation configuration and motor gains together. This is a learned motion controller, not an LLM.",
    "route": "Start with G1 motion tracking and bounded disturbance recovery. A language-directed manipulation task also needs its own trained high-level policy.",
    "compute": "Official release supports ONNX/TensorRT deployment. Browser and worker latency depend on runtime and hardware; no BrainSNN speed claim has been validated.",
    "license": "NVIDIA Open Model License weights; Apache-2.0 whole-body-control source.",
    "sources": [
      [
        "Official checkpoint and variants",
        "https://huggingface.co/nvidia/GEAR-SONIC"
      ],
      [
        "Whole-body control code",
        "https://github.com/NVlabs/GR00T-WholeBodyControl"
      ],
      [
        "Upstream interactive example",
        "https://nvlabs.github.io/GEAR-SONIC/demo.html"
      ]
    ],
    "accent": "violet",
    "symbol": "S",
    "summary": "Give G1 a learned motion controller. Test its recovery.",
    "robotIds": [
      "g1"
    ],
    "documentedRobotIds": [
      "g1"
    ],
    "tasks": [
      "Motion tracking",
      "Recovery",
      "Teleoperation"
    ],
    "licenseLabel": "NVIDIA Open Model License",
    "readyConditions": [
      "Choose and pin one matched SONIC encoder, decoder and observation configuration.",
      "Provide the G1 controller worker and the selected reference motion.",
      "Verify actual inference and physics readiness before measuring recovery."
    ],
    "featured": true,
    "added": "2026-10-14",
    "robotMatchNote": "Official G1 controller route. BrainSNN needs its own compatible worker before this policy can run inside the arena.",
    "workflowEvidenceNote": "The upstream G1 release provides motion tracking, teleoperation and planner workflows. The external example is separate from a BrainSNN recorded experiment.",
    "executionTrack": "matched-whole-body-controller"
  }
];
