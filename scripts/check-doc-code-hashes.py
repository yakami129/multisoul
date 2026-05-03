#!/usr/bin/env python3
"""
Guard design docs against stale code references.

Docs opt in via docs/design-docs/index.json documents[].trackedFiles.
Each tracked file stores a whole-file sha256 plus the reason it affects the doc.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = REPO_ROOT / "docs" / "design-docs" / "index.json"
DOCS_ROOT = REPO_ROOT / "docs" / "design-docs"


def _load_index() -> dict[str, Any]:
    with INDEX_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("docs/design-docs/index.json must contain an object")
    return data


def _write_index(data: dict[str, Any]) -> None:
    with INDEX_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _repo_path(path: str) -> Path:
    if path.startswith("/") or ".." in Path(path).parts:
        raise ValueError(f"tracked path must be repo-relative: {path}")
    return REPO_ROOT / path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _git_rev_exists(rev: str) -> bool:
    return _git(["rev-parse", "--verify", f"{rev}^{{commit}}"], check=False).returncode == 0


def _base_ref() -> str | None:
    candidates: list[str] = []
    explicit_base = os.environ.get("DOC_CODE_HASH_BASE_REF")
    github_base_sha = os.environ.get("GITHUB_BASE_SHA")
    github_base_ref = os.environ.get("GITHUB_BASE_REF")

    if explicit_base:
        candidates.append(explicit_base)
    if github_base_sha:
        candidates.append(github_base_sha)
    if github_base_ref:
        candidates.append(f"origin/{github_base_ref}")
    candidates.extend(["origin/main", "HEAD^"])

    for candidate in candidates:
        if _git_rev_exists(candidate):
            return candidate
    return None


def _changed_files() -> set[str]:
    changed: set[str] = set()

    base = _base_ref()
    if base:
        proc = _git(["diff", "--name-only", f"{base}...HEAD"], check=False)
        if proc.returncode == 0:
            changed.update(line.strip() for line in proc.stdout.splitlines() if line.strip())

    # Include local staged and unstaged edits for pre-commit / manual checks.
    proc = _git(["diff", "--name-only", "HEAD"], check=False)
    if proc.returncode == 0:
        changed.update(line.strip() for line in proc.stdout.splitlines() if line.strip())

    proc = _git(["ls-files", "--others", "--exclude-standard"], check=False)
    if proc.returncode == 0:
        changed.update(line.strip() for line in proc.stdout.splitlines() if line.strip())

    return changed


def _tracked_documents(data: dict[str, Any]) -> list[dict[str, Any]]:
    documents = data.get("documents")
    if not isinstance(documents, list):
        raise ValueError("docs/design-docs/index.json: documents must be a list")
    return [item for item in documents if isinstance(item, dict) and item.get("trackedFiles")]


def _validate_entry(doc_file: str, entry: Any) -> tuple[str, str, str]:
    if not isinstance(entry, dict):
        raise ValueError(f"{doc_file}: trackedFiles[] entries must be objects")
    path = entry.get("path")
    sha = entry.get("sha256")
    reason = entry.get("reason")
    if not isinstance(path, str) or not path:
        raise ValueError(f"{doc_file}: trackedFiles[].path must be a non-empty string")
    if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError(f"{doc_file}: trackedFiles[].sha256 must be a lowercase sha256 hex")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError(f"{doc_file}: trackedFiles[].reason must be a non-empty string")
    tracked_path = _repo_path(path)
    if not tracked_path.is_file():
        raise ValueError(f"{doc_file}: tracked file does not exist: {path}")
    return path, sha, reason


def _check(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    changed = _changed_files()

    for doc in _tracked_documents(data):
        doc_file = doc.get("file")
        if not isinstance(doc_file, str) or not doc_file:
            errors.append("[doc-code-hash] tracked document missing file")
            continue

        doc_path = DOCS_ROOT / doc_file
        doc_rel = str(doc_path.relative_to(REPO_ROOT))
        doc_changed = doc_rel in changed
        tracked_files = doc.get("trackedFiles")
        if not isinstance(tracked_files, list):
            errors.append(f"[doc-code-hash] {doc_rel}: trackedFiles must be a list")
            continue

        for entry in tracked_files:
            try:
                tracked_rel, expected_hash, reason = _validate_entry(doc_file, entry)
            except ValueError as exc:
                errors.append(f"[doc-code-hash] {exc}")
                continue

            current_hash = _sha256(_repo_path(tracked_rel))
            tracked_changed = tracked_rel in changed
            hash_stale = current_hash != expected_hash

            if tracked_changed and not doc_changed:
                errors.extend(
                    [
                        f"[doc-code-hash] {doc_rel} is stale",
                        f"[doc-code-hash] tracked file changed: {tracked_rel}",
                        f"[doc-code-hash] reason: {reason}",
                        "[doc-code-hash] Fix: update the design doc in the same change.",
                    ]
                )

            if hash_stale:
                errors.extend(
                    [
                        f"[doc-code-hash] {doc_rel} has stale tracked hash",
                        f"[doc-code-hash] tracked file: {tracked_rel}",
                        f"[doc-code-hash] expected: {expected_hash}",
                        f"[doc-code-hash] current:  {current_hash}",
                        "[doc-code-hash] Fix: run python3 scripts/check-doc-code-hashes.py --update after updating docs.",
                    ]
                )

    return errors


def _update(data: dict[str, Any]) -> bool:
    changed = False
    for doc in _tracked_documents(data):
        doc_file = doc.get("file")
        if not isinstance(doc_file, str) or not doc_file:
            raise ValueError("tracked document missing file")
        tracked_files = doc.get("trackedFiles")
        if not isinstance(tracked_files, list):
            raise ValueError(f"{doc_file}: trackedFiles must be a list")

        for entry in tracked_files:
            tracked_rel, old_hash, _reason = _validate_entry(doc_file, entry)
            new_hash = _sha256(_repo_path(tracked_rel))
            if new_hash != old_hash:
                entry["sha256"] = new_hash
                changed = True

    if changed:
        _write_index(data)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Check or update design-doc code hashes.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Validate tracked hashes and doc updates.")
    mode.add_argument("--update", action="store_true", help="Refresh tracked hashes in index.json.")
    args = parser.parse_args()

    try:
        data = _load_index()
        if args.update:
            _update(data)
            return 0

        errors = _check(data)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"[doc-code-hash] ERROR: {exc}", file=sys.stderr)
        return 1

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
