from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import planned_branch_check


def cmd(cwd: Path, *args: str) -> str:
    p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return p.stdout.strip()


class PlannedBranchCheckTests(unittest.TestCase):
    def test_ws40_planned_branch_absence_is_reported(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "repo"
            repo.mkdir()
            cmd(repo, "git", "init", "-b", "main")
            cmd(repo, "git", "config", "user.name", "test")
            cmd(repo, "git", "config", "user.email", "test@example.invalid")
            (repo / "root.txt").write_text("base\n")
            cmd(repo, "git", "add", "-A")
            cmd(repo, "git", "commit", "-m", "base")

            cmd(repo, "git", "switch", "-c", "ws01-runtime")
            (repo / "one.txt").write_text("one\n")
            cmd(repo, "git", "add", "-A")
            cmd(repo, "git", "commit", "-m", "ws01")

            cmd(repo, "git", "switch", "main")
            cmd(repo, "git", "switch", "-c", "ws40-release-readiness")
            plan = repo / "integration-plans/MERGE_ORDER.md"
            plan.parent.mkdir(parents=True)
            plan.write_text("# Plan\n\n`WS01 -> WS06`\n")
            cmd(repo, "git", "add", "-A")
            cmd(repo, "git", "commit", "-m", "plan")

            result = planned_branch_check.check(repo, "refs/heads/ws40-release-readiness")
            self.assertEqual(result["missing_branches"], ["WS06"])
            self.assertEqual(result["missing_count"], 1)


if __name__ == "__main__":
    unittest.main()
