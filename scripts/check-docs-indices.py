#!/usr/bin/env python3
"""
Verify docs/*/index.json manifests stay in sync with Markdown on disk.

Configured by scripts/docs-indices.json. See docs/quality/mechanized-constraints.md (R9).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "scripts" / "docs-indices.json"


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _expected_order(files: list[str], sort_key: str) -> list[str]:
    if sort_key == "filename_desc":
        return sorted(files, reverse=True)
    if sort_key == "filename_asc":
        return sorted(files)
    raise ValueError(f"unknown sortDocuments: {sort_key}")


def _check_one(
    index_id: str,
    root_rel: str,
    file_pattern: str,
    sort_documents: str,
) -> list[str]:
    errors: list[str] = []
    prefix = f"[{index_id}]"
    root = REPO_ROOT / root_rel
    index_path = root / "index.json"
    filename_re = re.compile(file_pattern)

    if not index_path.is_file():
        errors.append(f"{prefix} missing {index_path.relative_to(REPO_ROOT)}")
        return errors

    try:
        data = _load_json(index_path)
    except json.JSONDecodeError as exc:
        errors.append(f"{prefix} invalid JSON in index.json: {exc}")
        return errors

    documents = data.get("documents")
    if not isinstance(documents, list):
        errors.append(f"{prefix} index.json: documents must be a list")
        return errors

    indexed: list[str] = []
    seen: set[str] = set()

    for i, item in enumerate(documents):
        if not isinstance(item, dict):
            errors.append(f"{prefix} documents[{i}] must be an object")
            continue
        file_name = item.get("file")
        title = item.get("title")
        if not isinstance(file_name, str) or not file_name:
            errors.append(f"{prefix} documents[{i}].file must be a non-empty string")
            continue
        if not isinstance(title, str) or not title.strip():
            errors.append(f"{prefix} documents[{i}].title must be a non-empty string")
            continue
        if file_name in seen:
            errors.append(f"{prefix} duplicate documents[].file: {file_name}")
            continue
        seen.add(file_name)
        if not filename_re.match(file_name):
            errors.append(
                f"{prefix} documents[].file does not match configured pattern: {file_name}"
            )
            continue
        path = root / file_name
        if not path.is_file():
            errors.append(f"{prefix} index lists missing file: {file_name}")
            continue
        indexed.append(file_name)

    if errors:
        return errors

    on_disk_set = {
        p.name for p in root.glob("*.md") if p.name != "README.md"
    }
    indexed_set = set(indexed)

    missing_in_index = sorted(on_disk_set - indexed_set)
    if missing_in_index:
        errors.append(f"{prefix} Markdown files not listed in index.json:")
        for name in missing_in_index:
            errors.append(f"{prefix}   - {name}")
        errors.append(f"{prefix} Fix: add entries to {root_rel}/index.json")

    stale_in_index = sorted(indexed_set - on_disk_set)
    if stale_in_index:
        errors.append(f"{prefix} index.json lists files that do not exist:")
        for name in stale_in_index:
            errors.append(f"{prefix}   - {name}")

    expected = _expected_order(indexed, sort_documents)
    if indexed != expected:
        errors.append(
            f"{prefix} documents[] must be sorted ({sort_documents}); "
            f"expected {expected}, got {indexed}"
        )

    return errors


def main() -> int:
    if not CONFIG_PATH.is_file():
        print(f"ERROR: missing {CONFIG_PATH.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 1

    try:
        cfg = _load_json(CONFIG_PATH)
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in {CONFIG_PATH}: {exc}", file=sys.stderr)
        return 1

    indices = cfg.get("indices")
    if not isinstance(indices, list) or not indices:
        print("ERROR: docs-indices.json: indices must be a non-empty list", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    for entry in indices:
        if not isinstance(entry, dict):
            all_errors.append("[config] each indices[] item must be an object")
            continue
        index_id = entry.get("id")
        root_rel = entry.get("root")
        file_pattern = entry.get("filePattern")
        sort_documents = entry.get("sortDocuments")
        if not isinstance(index_id, str) or not index_id:
            all_errors.append("[config] indices[].id required")
            continue
        if not isinstance(root_rel, str) or not root_rel:
            all_errors.append(f"[{index_id}] indices[].root required")
            continue
        if not isinstance(file_pattern, str) or not file_pattern:
            all_errors.append(f"[{index_id}] indices[].filePattern required")
            continue
        if sort_documents not in ("filename_asc", "filename_desc"):
            all_errors.append(
                f"[{index_id}] indices[].sortDocuments must be "
                "filename_asc or filename_desc"
            )
            continue
        all_errors.extend(
            _check_one(index_id, root_rel, file_pattern, sort_documents)
        )

    if all_errors:
        for line in all_errors:
            print(line, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
