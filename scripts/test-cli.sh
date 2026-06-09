#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/cli"
cargo build --all-targets --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
