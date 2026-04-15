from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional


class Engineer:
    """Runs candidate code through an external evaluator."""

    def run(
        self,
        code: str,
        step_dir: str | Path,
        eval_script: Optional[str | Path],
        timeout: int = 1800,
        experiment_name: str = "default",
    ) -> Dict[str, Any]:
        step_dir = Path(step_dir)
        step_dir.mkdir(parents=True, exist_ok=True)

        candidate_path = step_dir / "candidate.py"
        candidate_path.write_text(code, encoding="utf-8")

        if not eval_script:
            return {
                "success": True,
                "eval_score": 0.0,
                "score": 0.0,
                "runtime": 0.0,
                "message": "No eval_script provided.",
            }

        script_path = Path(eval_script).expanduser().resolve()
        start = time.time()
        env = os.environ.copy()
        env.update(
            {
                "CANDIDATE_PATH": str(candidate_path),
                "STEP_DIR": str(step_dir),
                "EXPERIMENT_NAME": experiment_name,
            }
        )

        try:
            completed = subprocess.run(
                ["bash", str(script_path)],
                cwd=step_dir,
                env=env,
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            stdout = completed.stdout
            stderr = completed.stderr
            return_code = completed.returncode
        except subprocess.TimeoutExpired as exc:
            runtime = time.time() - start
            return {
                "success": False,
                "eval_score": 0.0,
                "score": 0.0,
                "runtime": runtime,
                "error": f"Evaluator timed out after {timeout}s",
                "stdout": exc.stdout or "",
                "stderr": exc.stderr or "",
            }

        runtime = time.time() - start
        results_path = step_dir / "results.json"
        payload: Dict[str, Any] = {}

        if results_path.exists():
            try:
                payload = json.loads(results_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                payload = {"success": False, "eval_score": 0.0, "error": f"Invalid results.json: {exc}"}
        else:
            payload = {"success": return_code == 0, "eval_score": 0.0}

        payload.setdefault("success", return_code == 0)
        payload.setdefault("eval_score", 0.0)
        payload["eval_score"] = float(payload.get("eval_score") or 0.0)
        payload["score"] = float(payload.get("score", payload["eval_score"]) or 0.0)
        payload["runtime"] = runtime
        payload["return_code"] = return_code
        payload["stdout"] = stdout[-4000:]
        payload["stderr"] = stderr[-4000:]

        if return_code != 0 and "error" not in payload:
            payload["error"] = stderr[-1000:] or f"Evaluator exited with {return_code}"

        return payload
