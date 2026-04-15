from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Iterable, List, Optional

from .models import CognitionItem


def _words(text: str) -> set[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in text or "")
    return {part for part in cleaned.split() if part}


class CognitionStore:
    """Persistent lightweight knowledge store for evolution experiments."""

    def __init__(self, storage_dir: str | Path):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.storage_dir / "cognition.json"
        self.items: List[CognitionItem] = []
        self._load()

    def add(
        self,
        title: str,
        content: str,
        tags: Optional[Iterable[str]] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        item = CognitionItem(
            id=str(uuid.uuid4()),
            title=title,
            content=content,
            tags=list(tags or []),
            metadata=metadata or {},
        )
        self.items.append(item)
        self._save()
        return item.id or ""

    def search(self, query: str, top_k: int = 5) -> List[CognitionItem]:
        query_words = _words(query)
        if not query_words:
            return self.items[:top_k]

        scored = []
        for item in self.items:
            title_score = 3 * len(query_words & _words(item.title))
            tag_score = 2 * len(query_words & _words(" ".join(item.tags)))
            content_score = len(query_words & _words(item.content))
            score = title_score + tag_score + content_score
            if score > 0:
                scored.append((score, item))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [item for _, item in scored[:top_k]]

    def list_all(self) -> List[CognitionItem]:
        return list(self.items)

    def _load(self) -> None:
        if not self.path.exists():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self.items = [CognitionItem.from_dict(item) for item in raw.get("items", [])]

    def _save(self) -> None:
        payload = {"items": [item.to_dict() for item in self.items]}
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def __len__(self) -> int:
        return len(self.items)
