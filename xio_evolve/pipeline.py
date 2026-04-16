"""XIO-Evolve pipeline: Learn → Design → Experiment → Analyze loop.

Ties cognition store + experiment database + researcher + engineer + analyzer
into a single driver. Python mirror of BrainSNN Layer 31 (brain-evolve) — same
UCB1-sampled tree of candidates, same lesson-per-round distillation, but
general enough to evolve any artifact produced by a researcher connector.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .analyzer import Analyzer
from .cognition import CognitionStore
from .database import ExperimentDatabase
from .engineer import Engineer
from .models import ExperimentNode
from .researcher import Researcher

ProgressCallback = Callable[[Dict[str, Any]], None]


@dataclass
class PipelineConfig:
    """Runtime configuration for a pipeline run."""

    task_description: str
    storage_dir: str | Path
    eval_script: Optional[str | Path] = None
    experiment_name: str = "xio_evolve_run"
    rounds: int = 5
    sample_size: int = 3
    sampler: str = "ucb1"
    exploration_c: float = 1.414
    timeout: int = 1800
    seed_code: Optional[str] = None
    cognition_top_k: int = 5

    def step_dir(self, round_index: int) -> Path:
        return Path(self.storage_dir) / "rounds" / f"round_{round_index:04d}"


@dataclass
class RoundResult:
    round_index: int
    node: ExperimentNode
    results: Dict[str, Any]
    sampled: List[ExperimentNode] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "round_index": self.round_index,
            "node": self.node.to_dict(),
            "results": self.results,
            "sampled_ids": [n.id for n in self.sampled if n.id is not None],
        }


class XIOEvolvePipeline:
    """Orchestrates the Learn → Design → Experiment → Analyze evolution loop."""

    def __init__(
        self,
        config: PipelineConfig,
        cognition: Optional[CognitionStore] = None,
        database: Optional[ExperimentDatabase] = None,
        researcher: Optional[Researcher] = None,
        engineer: Optional[Engineer] = None,
        analyzer: Optional[Analyzer] = None,
    ):
        self.config = config
        storage = Path(config.storage_dir)
        storage.mkdir(parents=True, exist_ok=True)
        self.cognition = cognition or CognitionStore(storage)
        self.database = database or ExperimentDatabase(storage)
        self.researcher = researcher or Researcher()
        self.engineer = engineer or Engineer()
        self.analyzer = analyzer or Analyzer()

    # --- main loop ------------------------------------------------------

    def run(
        self,
        rounds: Optional[int] = None,
        on_round: Optional[ProgressCallback] = None,
    ) -> List[RoundResult]:
        """Run the evolution loop for `rounds` iterations.

        Each round:
          1. Learn     — sample prior nodes (UCB1) + retrieve cognition context
          2. Design    — researcher proposes the next candidate
          3. Experiment — engineer runs the candidate through the evaluator
          4. Analyze   — analyzer distills a lesson, persisted as cognition
        """
        total = rounds if rounds is not None else self.config.rounds
        history: List[RoundResult] = []
        for i in range(total):
            result = self.run_once(round_index=i)
            history.append(result)
            if on_round is not None:
                on_round(result.to_dict())
        return history

    def run_once(self, round_index: int) -> RoundResult:
        # 1. Learn
        sampled = self.database.sample(
            n=self.config.sample_size,
            algorithm=self.config.sampler,
            exploration_c=self.config.exploration_c,
        )
        cognition_items = self.cognition.search(
            self.config.task_description, top_k=self.config.cognition_top_k
        )

        # 2. Design
        base_code = self.config.seed_code if round_index == 0 else None
        candidate = self.researcher.run(
            task_description=self.config.task_description,
            context_nodes=sampled,
            cognition_items=cognition_items,
            base_code=base_code,
        )

        # 3. Experiment
        step_dir = self.config.step_dir(round_index)
        results = self.engineer.run(
            code=candidate["code"],
            step_dir=step_dir,
            eval_script=self.config.eval_script,
            timeout=self.config.timeout,
            experiment_name=self.config.experiment_name,
        )

        # 4. Analyze
        best_sampled = max(sampled, key=lambda n: n.score) if sampled else None
        analysis = self.analyzer.run(
            code=candidate["code"],
            results=results,
            task_description=self.config.task_description,
            best_sampled_node=best_sampled,
        )

        # Persist node + lesson
        parent_ids = [n.id for n in sampled if n.id is not None]
        score = float(results.get("score", results.get("eval_score", 0.0)) or 0.0)
        node = ExperimentNode(
            name=candidate["name"],
            motivation=candidate.get("motivation", ""),
            code=candidate["code"],
            parent_ids=parent_ids,
            score=score,
            results=results,
            analysis=analysis.get("analysis", ""),
            meta_info={
                "round_index": round_index,
                "experiment_name": self.config.experiment_name,
            },
        )
        self.database.add(node)

        self.cognition.add(
            title=f"Round {round_index}: {node.name}",
            content=node.analysis,
            tags=["xio_evolve", self.config.experiment_name, "success" if results.get("success") else "failure"],
            metadata={
                "round_index": round_index,
                "score": score,
                "node_id": node.id,
            },
        )

        return RoundResult(
            round_index=round_index,
            node=node,
            results=results,
            sampled=sampled,
        )

    # --- convenience helpers -------------------------------------------

    def best(self) -> Optional[ExperimentNode]:
        return self.database.best()

    def history(self) -> List[ExperimentNode]:
        return self.database.list_all()
