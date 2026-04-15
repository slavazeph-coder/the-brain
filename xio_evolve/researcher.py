from __future__ import annotations

from typing import Dict, List, Optional

from .models import CognitionItem, ExperimentNode


class Researcher:
    """Produces the next candidate.

    This first version is intentionally safe and dependency-free. It keeps the
    contract ready for a future Codex/OpenClaw researcher connector without
    executing external commands from this module.
    """

    def run(
        self,
        task_description: str,
        context_nodes: List[ExperimentNode],
        cognition_items: List[CognitionItem],
        base_code: Optional[str] = None,
    ) -> Dict[str, str]:
        return self._fallback_candidate(task_description, context_nodes, cognition_items, base_code)

    def _fallback_candidate(
        self,
        task_description: str,
        context_nodes: List[ExperimentNode],
        cognition_items: List[CognitionItem],
        base_code: Optional[str],
    ) -> Dict[str, str]:
        notes = "\n".join(f"# cognition: {item.title}" for item in cognition_items[:5])

        if base_code:
            code = base_code + "\n\n# XIO-Evolve fallback: researcher connector not configured yet.\n" + notes + "\n"
            name = "fallback_base_candidate"
        elif context_nodes:
            code = context_nodes[0].code + "\n\n# XIO-Evolve fallback: reused sampled parent.\n" + notes + "\n"
            name = "fallback_parent_candidate"
        else:
            code = (
                '"""Initial XIO-Evolve candidate.\n\n'
                "Add a real researcher connector to generate task-specific code.\n"
                '"""\n\n'
                "def run(*args, **kwargs):\n"
                "    return {'status': 'needs_researcher'}\n"
            )
            name = "fallback_initial_candidate"

        return {
            "name": name,
            "motivation": "Fallback candidate created by the built-in safe researcher scaffold.",
            "code": code,
        }
