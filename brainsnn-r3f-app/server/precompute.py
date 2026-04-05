"""
Pre-compute TRIBE v2 scenario packs from canonical stimuli.
Saves region-mapped timeseries as JSON for browser-side playback.

Usage:
    python precompute.py --stimulus path/to/video.mp4 --modality video --name sensory_burst
    python precompute.py --generate-defaults
"""

import argparse
import json
import sys
from pathlib import Path

SCENARIOS_DIR = Path(__file__).parent / "scenarios"
LINKS = [
    ["THL", "CTX"], ["CTX", "HPC"], ["HPC", "CTX"], ["CTX", "PFC"],
    ["PFC", "CTX"], ["CTX", "AMY"], ["AMY", "BG"], ["BG", "THL"],
    ["CBL", "CTX"], ["PFC", "HPC"],
]


def generate_synthetic_scenario(name, profile):
    """
    Generate a synthetic scenario pack when TRIBE v2 model is not available.
    Uses neuroscience-informed activation patterns.
    """
    import random
    random.seed(hash(name))

    frames = []
    base = dict(profile)

    for t in range(15):
        regions = {}
        flows = {}
        for region, baseline in base.items():
            noise = (random.random() - 0.5) * 0.06
            decay = max(0, (t - 5) * 0.01) if t > 5 else 0
            regions[region] = round(min(0.95, max(0.02, baseline + noise - decay)), 4)

        for from_id, to_id in LINKS:
            key = f"{from_id}\u2192{to_id}"
            flows[key] = round(
                max(regions.get(from_id, 0), regions.get(to_id, 0))
                * (regions.get(from_id, 0) + regions.get(to_id, 0)) / 2,
                4
            )

        frames.append({"t": t, "regions": regions, "flows": flows})

    return {
        "frames": frames,
        "meta": {
            "duration": 15,
            "fps": 1,
            "source": "synthetic",
            "name": name
        }
    }


SCENARIO_PROFILES = {
    "baseline": {
        "CTX": 0.24, "HPC": 0.16, "THL": 0.40, "AMY": 0.12,
        "BG": 0.14, "PFC": 0.19, "CBL": 0.17
    },
    "sensory_burst": {
        "CTX": 0.35, "HPC": 0.18, "THL": 0.82, "AMY": 0.20,
        "BG": 0.16, "PFC": 0.22, "CBL": 0.19
    },
    "memory_replay": {
        "CTX": 0.42, "HPC": 0.78, "THL": 0.30, "AMY": 0.16,
        "BG": 0.15, "PFC": 0.28, "CBL": 0.17
    },
    "emotional_salience": {
        "CTX": 0.28, "HPC": 0.22, "THL": 0.35, "AMY": 0.82,
        "BG": 0.48, "PFC": 0.20, "CBL": 0.16
    },
    "executive_override": {
        "CTX": 0.45, "HPC": 0.36, "THL": 0.28, "AMY": 0.12,
        "BG": 0.16, "PFC": 0.85, "CBL": 0.19
    }
}


def run_tribe_scenario(stimulus_path, modality, name):
    """Run TRIBE v2 on a real stimulus file."""
    from api import run_inference
    frames, duration = run_inference(stimulus_path, modality)
    return {
        "frames": frames,
        "meta": {
            "duration": duration,
            "fps": 1,
            "source": modality,
            "name": name
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Pre-compute TRIBE v2 scenarios")
    parser.add_argument("--stimulus", help="Path to stimulus file")
    parser.add_argument("--modality", choices=["video", "audio", "text"])
    parser.add_argument("--name", help="Scenario name")
    parser.add_argument("--generate-defaults", action="store_true",
                        help="Generate synthetic default scenarios")
    args = parser.parse_args()

    SCENARIOS_DIR.mkdir(exist_ok=True)

    if args.generate_defaults:
        for name, profile in SCENARIO_PROFILES.items():
            data = generate_synthetic_scenario(name, profile)
            out_path = SCENARIOS_DIR / f"{name}.json"
            with open(out_path, "w") as f:
                json.dump(data, f, indent=2)
            print(f"Generated {out_path}")
        return

    if args.stimulus and args.modality and args.name:
        try:
            data = run_tribe_scenario(args.stimulus, args.modality, args.name)
        except ImportError:
            print("TRIBE v2 not available, falling back to synthetic generation")
            profile = SCENARIO_PROFILES.get(args.name, SCENARIO_PROFILES["baseline"])
            data = generate_synthetic_scenario(args.name, profile)

        out_path = SCENARIOS_DIR / f"{args.name}.json"
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Saved {out_path}")
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
