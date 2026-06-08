#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== [1/3] CLI unit + build ==="
bash "$REPO_ROOT/scripts/test-cli.sh"
echo "=== [2/3] CLI Serve E2E ==="
bash "$REPO_ROOT/scripts/test-e2e.sh"
echo "=== [3/3] Mobile full ==="
bash "$REPO_ROOT/scripts/test-mobile.sh"
echo "=== All passed ==="
