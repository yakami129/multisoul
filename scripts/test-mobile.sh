#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/mobile"
pnpm typecheck
pnpm lint
pnpm exec jest --watchAll=false --forceExit --coverage
