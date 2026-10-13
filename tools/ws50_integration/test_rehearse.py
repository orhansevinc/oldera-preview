from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import rehearse


def cmd(cwd: Path, *args: str) -> str:
    p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return p.stdout.strip()


def commit(cwd: Path, message: str) -> str:
    cmd(cwd, "git", "add", "-A")
    cmd(cwd, "git", "commit", "-m", message)
    return cmd(cwd, "git", "rev-parse", "HEAD")


class RehearsalTests(unittest.TestCase):
    def make_repo(self) -> tuple[tempfile.TemporaryDirectory, Path]:
        td = tempfile.TemporaryDirectory()
        repo = Path(td.name) / "repo"
        repo.mkdir()
        cmd(repo, "git", "init", "-b", "main")
        cmd(repo, "git", "config", "user.name", "test")
        cmd(repo, "git", "config", "user.email", "test@example.invalid")
        (repo / "root.txt").write_text("base\n")
        commit(repo, "base")
        return td, repo

    def add_ws(self, repo: Path, branch: str, rel: str, content: str) -> str:
        cmd(repo, "git", "switch", "main")
        cmd(repo, "git", "switch", "-c", branch)
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        impl = commit(repo, f"{branch} implementation")
        ws = branch[2:4]
        sp = repo / f"workstreams/ws{ws}/STATUS.md"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(f"# WS{ws} STATUS\n\nCommit: `{impl}`\n")
        commit(repo, f"{branch} status")
        return impl

    def test_disposable_clone_keeps_source_clean_and_builds_batches(self):
        td, repo = self.make_repo()
        try:
            self.add_ws(repo, "ws01-alpha", "a.txt", "a\n")
            self.add_ws(repo, "ws02-beta", "b.txt", "b\n")
            cmd(repo, "git", "switch", "main")
            before = cmd(repo, "git", "rev-parse", "HEAD")
            results, _, batches, failures, _, _ = rehearse.rehearse(repo, Path(td.name) / "output")
            self.assertFalse(failures)
            by_ws = {r["ws"]: r["class"] for r in results}
            self.assertEqual(by_ws["WS01"], "cleanly integratable")
            self.assertEqual(by_ws["WS02"], "cleanly integratable")
            self.assertEqual(len(batches), 1)
            self.assertEqual(cmd(repo, "git", "rev-parse", "HEAD"), before)
            self.assertEqual(cmd(repo, "git", "status", "--porcelain"), "")
            self.assertTrue((Path(td.name) / "output/integration-rehearsal/REHEARSAL_REPORT.md").exists())
        finally:
            td.cleanup()

    def test_conflict_is_reported_without_product_fix(self):
        td, repo = self.make_repo()
        try:
            (repo / "shared.txt").write_text("base\n")
            commit(repo, "shared base")
            self.add_ws(repo, "ws01-alpha", "shared.txt", "from ws01\n")
            self.add_ws(repo, "ws02-beta", "shared.txt", "from ws02\n")
            cmd(repo, "git", "switch", "main")
            results, conflicts, _, _, _, _ = rehearse.rehearse(repo, Path(td.name) / "output")
            by_ws = {r["ws"]: r["class"] for r in results}
            self.assertEqual(by_ws["WS01"], "cleanly integratable")
            self.assertEqual(by_ws["WS02"], "conflict")
            self.assertTrue(any("shared.txt" in c["files"] for c in conflicts))
            self.assertEqual(cmd(repo, "git", "status", "--porcelain"), "")
        finally:
            td.cleanup()

    def test_missing_status_is_missing_commit(self):
        td, repo = self.make_repo()
        try:
            cmd(repo, "git", "switch", "-c", "ws03-no-status")
            (repo / "x.txt").write_text("x\n")
            commit(repo, "x")
            cmd(repo, "git", "switch", "main")
            results, *_ = rehearse.rehearse(repo, Path(td.name) / "output")
            r = next(x for x in results if x["ws"] == "WS03")
            self.assertEqual(r["class"], "missing commit")
        finally:
            td.cleanup()


if __name__ == "__main__":
    unittest.main()
