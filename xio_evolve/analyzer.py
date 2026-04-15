from __future__ import annotations

from typing import Any, Dict, Optional

from .models import ExperimentNode


class Analyzer:
    """Converts evaluator output into a reusable lesson."""

    def run(
        self,
        code: str,
        results: Dict[str, Any],
        task_description: str,
        best_sampled_node: Optional[ExperimentNode] = None,
    ) -> Dict[str, str]:
        score = float(results.get("score", results.get("eval_score", 0.0)) or 0.0)
        success = bool(results.get("success", False))

        lines = [
            f"Outcome: {'success' if success else 'failure'}",
            f"Score: {score:.4f}",
        ]

        if best_sampled_node:
            delta = score - float(best_sampled_node.score or 0.0)
            lines.append(f"Compared with sampled best '{best_sampled_node.name}': delta {delta:+.4f}")

        if results.get("error"):
            lines.append(f"Error: {results['error']}")

        metrics = results.get("metrics")
        if metrics:
            lines.append(f"Metrics: {metrics}")

        if results.get("stderr"):
            lines.append(f"stderr hint: {str(results['stderr'])[:500]}")

        return {"analysis": "\n".join(lines)}
