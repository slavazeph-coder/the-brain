/* Exact experiment recipes. A recipe is not an installed or verified runtime. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const cameras = [
    { id: 'agentview', width: 256, height: 256, role: 'policy' },
    { id: 'wrist', width: 256, height: 256, role: 'policy' }
  ];
  const libero = {
    robotId: 'panda', environment: 'LIBERO', cameras, state: { size: 8 },
    action: { size: 7, space: 'cartesian-delta-gripper', controller: 'OSC_POSE' },
    protocols: ['practice', 'benchmark'], commands: [], ready: false,
    tasks: [{ id: 'libero_spatial:0', label: 'LIBERO Spatial · task 1' }],
    reason: 'Connect a matched physics worker to load this checkpoint and its saved processors.'
  };
  const entries = [
    { ...libero, id: 'panda-pi05-libero', modelId: 'pi05', name: 'Panda + π0.5',
      checkpoint: 'gs://openpi-assets/checkpoints/pi05_libero/', adapter: 'openpi-libero',
      cameras: cameras.map(c => ({ ...c, width: 224, height: 224, sourceWidth: 256, sourceHeight: 256, rotation: 180 })),
      description: 'Native OpenPI LIBERO checkpoint with two policy cameras and a Cartesian action controller.',
      timing: { controlHz: 20, actionChunkSteps: 5 },
      source: 'https://github.com/Physical-Intelligence/openpi',
      setup: 'Use the bundled LIBERO worker and an OpenPI server configured with pi05_libero. Pin the checkpoint revision and Python environment.' },
    { ...libero, id: 'panda-molmoact2-libero', modelId: 'molmo', name: 'Panda + MolmoAct2',
      checkpoint: 'allenai/MolmoAct2-LIBERO-LeRobot', adapter: 'lerobot-molmoact2-libero',
      description: 'LeRobot checkpoint format. Restore its saved processor, statistics and camera mapping.',
      timing: { controlHz: 20, actionChunkSteps: 10 },
      source: 'https://huggingface.co/allenai/MolmoAct2-LIBERO-LeRobot',
      setup: 'A MolmoAct2-specific adapter is required. The OpenPI loader does not execute these weights.' },
    { id: 'g1-sonic', robotId: 'g1', modelId: 'sonic', name: 'G1 + SONIC',
      checkpoint: 'nvidia/GEAR-SONIC', adapter: 'sonic-mujoco', environment: 'G1 motion arena',
      cameras: [], state: { size: null }, action: { size: 29, space: 'joint-position', controller: 'SONIC-PD' },
      timing: { controlHz: 50, physicsHz: 200 }, protocols: ['practice'], commands: [], ready: false,
      tasks: [{ id: 'track-motion', label: 'Track a reference motion' }, { id: 'push-recovery', label: 'Recover from a push' }],
      description: 'A learned whole-body controller. Motion commands and joint torques need an owned, licensed runtime adapter.',
      reason: 'The SONIC controller and G1 physics adapter are not connected.',
      setup: 'Load the matching G1 assets, licensed SONIC encoder/decoder and PD controller. Verify 50 Hz control and 200 Hz physics before enabling tests.',
      source: 'https://github.com/NVlabs/GR00T-WholeBodyControl' },
    { id: 'g1-groot-sonic', robotId: 'g1', modelId: 'groot', name: 'G1 + GR00T + SONIC',
      checkpoint: null, adapter: 'groot-unitree-g1-sonic', environment: 'G1 task arena',
      cameras: [], state: { size: null }, action: { size: 78, space: 'sonic-latent-hands', controller: 'SONIC' },
      protocols: ['practice'], commands: [], tasks: [], ready: false,
      description: 'Task-trained GR00T using UNITREE_G1_SONIC and a matching SONIC controller.',
      reason: 'Choose a task-finetuned UNITREE_G1_SONIC checkpoint and connect both policy and whole-body controller.',
      setup: 'A general GR00T checkpoint cannot drive this body directly. Supply the task checkpoint, observation processing and matching SONIC variant.',
      source: 'https://nvlabs.github.io/GR00T-WholeBodyControl/tutorials/vla_workflow.html' },
    ...['act', 'smolvla'].map(modelId => ({
      id: 'so101-' + modelId, robotId: 'so101', modelId, name: 'SO-101 + ' + (modelId === 'act' ? 'ACT' : 'SmolVLA'),
      checkpoint: null, adapter: 'lerobot-so101', environment: 'SO-101 EDU arena', cameras: [],
      state: { size: null }, action: { size: 6, space: 'joint-position', controller: 'SO101-position' },
      protocols: ['practice'], commands: [], tasks: [], ready: false,
      description: 'Task-adapted manipulation with the same robot calibration, cameras and action units used for training.',
      reason: 'Choose a task-adapted checkpoint and matching SO-101 environment before running.',
      setup: 'Collect or import matching demonstrations, train the selected policy, and connect a worker with saved processing and calibration.',
      source: 'https://huggingface.co/docs/lerobot/en/envhub_leisaac'
    }))
  ];
  function findForSelection(selection = {}) {
    const match = entries.find(p => p.robotId === selection.robotId && p.modelId === selection.modelId && (!selection.profileId || p.id === selection.profileId));
    return match ? clone(match) : null;
  }
  window.BrainSNNArenaProfiles = Object.freeze({
    list: () => clone(entries), findForSelection,
    find: id => { const item = entries.find(p => p.id === id); return item ? clone(item) : null; }
  });
})();
