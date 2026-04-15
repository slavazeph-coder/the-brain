"""
Maps TRIBE v2 fsaverage5 cortical predictions (~20,484 vertices)
to BrainSNN's 7 brain regions using the Desikan-Killiany atlas.
"""

import numpy as np

# Desikan-Killiany label indices → BrainSNN region mapping
# Reference: FreeSurfer aparc atlas on fsaverage5
# Labels from nilearn.datasets.fetch_atlas_surf_destrieux or aparc

DK_TO_REGION = {
    # PFC — Prefrontal Cortex
    'superiorfrontal': 'PFC',
    'rostralmiddlefrontal': 'PFC',
    'caudalmiddlefrontal': 'PFC',
    'parsopercularis': 'PFC',
    'parstriangularis': 'PFC',
    'parsorbitalis': 'PFC',
    'lateralorbitofrontal': 'PFC',
    'medialorbitofrontal': 'PFC',
    'frontalpole': 'PFC',

    # CTX — General Cortex (sensory, parietal, temporal, occipital)
    'precentral': 'CTX',
    'postcentral': 'CTX',
    'superiorparietal': 'CTX',
    'inferiorparietal': 'CTX',
    'supramarginal': 'CTX',
    'precuneus': 'CTX',
    'lateraloccipital': 'CTX',
    'lingual': 'CTX',
    'cuneus': 'CTX',
    'pericalcarine': 'CTX',
    'superiortemporal': 'CTX',
    'middletemporal': 'CTX',
    'inferiortemporal': 'CTX',
    'bankssts': 'CTX',
    'fusiform': 'CTX',
    'transversetemporal': 'CTX',
    'insula': 'CTX',
    'posteriorcingulate': 'CTX',
    'isthmuscingulate': 'CTX',
    'caudalanteriorcingulate': 'CTX',
    'rostralanteriorcingulate': 'CTX',
    'paracentral': 'CTX',
    'temporalpole': 'CTX',

    # HPC — Hippocampus (closest cortical labels)
    'parahippocampal': 'HPC',
    'entorhinal': 'HPC',

    # AMY — Amygdala (no direct cortical label; use temporal pole overlap)
    # Amygdala is subcortical — approximate via nearby cortical vertices
    # Handled via fallback below

    # BG — Basal Ganglia (subcortical — no fsaverage5 surface label)
    # Handled via fallback below

    # CBL — Cerebellum (not on fsaverage5 cortical surface)
    # Handled via fallback below

    # THL — Thalamus (subcortical — no fsaverage5 surface label)
    # Handled via fallback below
}

# Regions without direct cortical representation use baseline values
SUBCORTICAL_DEFAULTS = {
    'THL': 0.40,
    'AMY': 0.15,
    'BG': 0.14,
    'CBL': 0.17,
}


def build_label_to_region_map(labels):
    """
    Given a list of label names from an atlas, return a dict mapping
    each label index to a BrainSNN region ID.
    """
    mapping = {}
    for idx, label in enumerate(labels):
        label_clean = label.lower().replace('-', '').replace('_', '').replace(' ', '')
        for dk_name, region in DK_TO_REGION.items():
            if dk_name.lower().replace('_', '') in label_clean:
                mapping[idx] = region
                break
    return mapping


def map_predictions_to_regions(predictions, parcellation, labels):
    """
    Map TRIBE v2 vertex-level predictions to 7 BrainSNN regions.

    Args:
        predictions: np.array of shape (n_timesteps, n_vertices)
        parcellation: np.array of shape (n_vertices,) with label indices
        labels: list of label names corresponding to indices

    Returns:
        list of dicts, one per timestep:
        [{"CTX": 0.42, "HPC": 0.31, "THL": 0.58, ...}, ...]
    """
    label_map = build_label_to_region_map(labels)

    # Group vertices by region
    region_vertices = {r: [] for r in ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL']}
    for vertex_idx, label_idx in enumerate(parcellation):
        region = label_map.get(label_idx)
        if region:
            region_vertices[region].append(vertex_idx)

    frames = []
    for t in range(predictions.shape[0]):
        frame = {}
        for region_id in region_vertices:
            vertices = region_vertices[region_id]
            if vertices:
                raw = np.mean(predictions[t, vertices])
                # Normalize to 0.02–0.95 range
                frame[region_id] = float(np.clip(raw, 0.02, 0.95))
            else:
                frame[region_id] = SUBCORTICAL_DEFAULTS.get(region_id, 0.15)
        frames.append(frame)

    # For subcortical regions, modulate defaults based on cortical activity
    for frame in frames:
        ctx_activity = frame.get('CTX', 0.24)
        pfc_activity = frame.get('PFC', 0.19)

        # THL tracks inversely with cortical suppression
        if 'THL' not in region_vertices or not region_vertices['THL']:
            frame['THL'] = float(np.clip(0.3 + ctx_activity * 0.5, 0.1, 0.95))

        # AMY responds to overall arousal
        if 'AMY' not in region_vertices or not region_vertices['AMY']:
            frame['AMY'] = float(np.clip(0.1 + ctx_activity * 0.3, 0.05, 0.85))

        # BG tracks with PFC for action selection
        if 'BG' not in region_vertices or not region_vertices['BG']:
            frame['BG'] = float(np.clip(0.1 + pfc_activity * 0.35, 0.05, 0.8))

        # CBL tracks motor cortex (approximate via CTX)
        if 'CBL' not in region_vertices or not region_vertices['CBL']:
            frame['CBL'] = float(np.clip(0.12 + ctx_activity * 0.2, 0.05, 0.7))

    return frames


def compute_flows(frames, links):
    """
    Compute per-edge flow values from region activations.

    Args:
        frames: list of region dicts from map_predictions_to_regions
        links: list of [from, to] pairs

    Returns:
        list of flow dicts, one per timestep
    """
    flow_frames = []
    for frame in frames:
        flows = {}
        for from_id, to_id in links:
            key = f"{from_id}\u2192{to_id}"
            flows[key] = float(
                max(frame.get(from_id, 0), frame.get(to_id, 0))
                * (frame.get(from_id, 0) + frame.get(to_id, 0)) / 2
            )
        flow_frames.append(flows)
    return flow_frames
