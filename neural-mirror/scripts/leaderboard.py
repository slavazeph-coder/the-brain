from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brainsnn_mirror.registry import connect_registry, list_experiments


def parse_args():
    parser = argparse.ArgumentParser(description="Show BrainSNN Neural Mirror experiment leaderboard.")
    parser.add_argument("--registry", default=str(ROOT / "artifacts" / "experiments.sqlite"))
    parser.add_argument("--limit", type=int, default=50)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows = list_experiments(connect_registry(args.registry), limit=args.limit)
    eligible = [row for row in rows if row.get("benchmarkValid") and row.get("metrics", {}).get("meanPearson") is not None]
    eligible.sort(key=lambda row: float(row["metrics"]["meanPearson"]), reverse=True)
    print(f"{'MODEL':<24} {'MEAN_R':>8} {'MEDIAN_R':>9} {'POS_FRAC':>9} {'LATENCY':>10} {'STATUS':>10}")
    for row in eligible:
        metrics = row.get("metrics", {})
        print(
            f"{row['id']:<24} "
            f"{float(metrics.get('meanPearson', 0)):>8.4f} "
            f"{float(metrics.get('medianPearson', 0)):>9.4f} "
            f"{float(metrics.get('positiveParcelFraction', 0)):>9.3f} "
            f"{float(metrics.get('latencyMs', 0)):>9.1f}ms "
            f"{row.get('status', ''):>10}"
        )
    if not eligible:
        print("No valid measured experiments yet.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
