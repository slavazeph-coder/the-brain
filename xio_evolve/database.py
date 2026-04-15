from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import List, Optional

from .models import ExperimentNode


class ExperimentDatabase:
    """JSON-backed experiment tree with simple sampling strategies."""

    def __init__(self, storage_dir: str | Path):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.storage_dir / "nodes.json"
        self.nodes: List[ExperimentNode] = []
        self.next_id = 0
        self._load()

    def add(self, node: ExperimentNode) -> int:
        node.id = self.next_id
        self.next_id += 1
        self.nodes.append(node)
        self._save()
        return node.id

    def list_all(self) -> List[ExperimentNode]:
        return list(self.nodes)

    def best(self) -> Optional[ExperimentNode]:
        if not self.nodes:
            return None
        return max(self.nodes, key=lambda node: node.score)

    def sample(self, n: int, algorithm: str = "ucb1", exploration_c: float = 1.414) -> List[ExperimentNode]:
        if not self.nodes or n <= 0:
            return []
        n = min(n, len(self.nodes))

        if algorithm == "random":
            selected = random.sample(self.nodes, n)
        elif algorithm == "greedy":
            selected = sorted(self.nodes, key=lambda node: node.score, reverse=True)[:n]
        else:
            selected = self._sample_ucb1(n=n, exploration_c=exploration_c)

        for node in selected:
            node.visit_count += 1
        self._save()
        return selected

    def _sample_ucb1(self, n: int, exploration_c: float) -> List[ExperimentNode]:
        total_visits = sum(max(0, node.visit_count) for node in self.nodes)
        if total_visits <= 0:
            return random.sample(self.nodes, n)

        scores = [node.score for node in self.nodes]
        min_score = min(scores)
        max_score = max(scores)
        score_range = max(max_score - min_score, 1.0)

        ranked = []
        for node in self.nodes:
            if node.visit_count <= 0:
                value = float("inf")
            else:
                normalized = (node.score - min_score) / score_range
                exploration = exploration_c * math.sqrt(math.log(total_visits + 1) / node.visit_count)
                value = normalized + exploration
            ranked.append((value, node))

        ranked.sort(key=lambda pair: pair[0], reverse=True)
        return [node for _, node in ranked[:n]]

    def _load(self) -> None:
        if not self.path.exists():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self.next_id = int(raw.get("next_id", 0))
        self.nodes = [ExperimentNode.from_dict(item) for item in raw.get("nodes", [])]

    def _save(self) -> None:
        payload = {
            "next_id": self.next_id,
            "nodes": [node.to_dict() for node in self.nodes],
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def __len__(self) -> int:
        return len(self.nodes)
