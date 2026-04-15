from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CognitionItem:
    title: str
    content: str
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "CognitionItem":
        return cls(**value)

    def context_text(self) -> str:
        return " ".join([self.title, self.content, " ".join(self.tags)])


@dataclass
class ExperimentNode:
    name: str
    motivation: str
    code: str
    id: Optional[int] = None
    created_at: str = field(default_factory=utc_now)
    parent_ids: List[int] = field(default_factory=list)
    score: float = 0.0
    results: Dict[str, Any] = field(default_factory=dict)
    analysis: str = ""
    visit_count: int = 0
    meta_info: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "ExperimentNode":
        return cls(**value)

    def context_text(self) -> str:
        return "\n".join(
            [
                f"name: {self.name}",
                f"motivation: {self.motivation}",
                f"score: {self.score}",
                f"analysis: {self.analysis}",
            ]
        )
