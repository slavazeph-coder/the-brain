from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brainsnn_mirror.director import propose_next
from brainsnn_mirror.registry import connect_registry


def parse_args():
    parser = argparse.ArgumentParser(description="Ask BrainSNN Research Director for the next bounded experiment proposal.")
    parser.add_argument("--registry", default=str(ROOT / "artifacts" / "experiments.sqlite"))
    parser.add_argument("--dataset-id", default="algonauts-2025")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    connection = connect_registry(args.registry)
    print(json.dumps(propose_next(connection, dataset_id=args.dataset_id), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
