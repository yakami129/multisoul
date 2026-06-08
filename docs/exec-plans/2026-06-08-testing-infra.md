# 自动化测试体系建设 Implementation Plan

- **Date**: 2026-06-08
- **Spec**: `docs/product-specs/2026-06-08-SPEC-testing-infra.md`
- **Branch**: `feat/testing-infra`

---

## Context & Key Decisions

- Coverage threshold: **60% lines** (first PR, raise to 70% in next iteration per spec §5 risk note)
- CLI E2E test file: `cli/tests/serve/e2e_tests.rs` — registered via `[[test]]` in Cargo.toml so `cargo test --test e2e_tests` works; does NOT violate `check-cli-test-layout.sh` (subdirectory, not top-level)
- Port isolation: `TcpListener::bind("127.0.0.1:0")` to find a free port — no server code changes needed
- DB isolation: set `HOME=/tmp/msctl-test-<uuid>` env var on child process so `dirs::config_dir()` uses a temp dir
- Auth token: pass fixed test token `ms_v2_aabbccddaabbccddaabbccddaabbccdd` via `--token` CLI arg
- MSW version: v2 (`msw/node` setupServer), Node 20 / jest-environment-node — compatible

---

## Tasks

### T1 — CLI Cargo.toml: add [[test]] entry + dev dep

**File**: `cli/Cargo.toml`

Add to `[dev-dependencies]`:
```toml
tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
```

Add after `[dev-dependencies]`:
```toml
[[test]]
name = "e2e_tests"
path = "tests/serve/e2e_tests.rs"
```

---

### T2 — CLI E2E test file

**File**: `cli/tests/serve/e2e_tests.rs` (new, ~300 lines)

Structure:
```rust
// helpers
fn find_free_port() -> u16 { /* bind :0, get port, drop */ }

struct TestServer { port: u16, token: String, _home: tempfile::TempDir, _child: std::process::Child }
impl TestServer {
    fn start() -> Self { /* spawn msctl serve --port <port> --token <token> */ }
    fn base_url(&self) -> String { format!("http://127.0.0.1:{}", self.port) }
    fn auth_header(&self) -> String { format!("Bearer {}", self.token) }
}
impl Drop for TestServer { fn drop(&mut self) { self._child.kill().ok(); self._child.wait().ok(); } }

async fn wait_for_ready(base_url: &str) { /* poll GET /healthz up to 5s */ }

// Scenario A: Auth
#[tokio::test] async fn auth_no_token_returns_401() { ... }
#[tokio::test] async fn auth_wrong_token_returns_401() { ... }
#[tokio::test] async fn auth_valid_token_returns_200() { ... }

// Scenario B: Agent CRUD
#[tokio::test] async fn agent_crud() { /* register → list → get → delete → 404 */ }

// Scenario C: Conversation + Message + WebSocket
#[tokio::test] async fn conversation_and_messages() { /* create conv → send msg → list msgs */ }
#[tokio::test] async fn websocket_upgrade_succeeds() { /* connect WS, verify upgrade */ }

// Scenario D: Push Token
#[tokio::test] async fn push_token_register_and_delete() { /* register → delete → verify */ }
#[tokio::test] async fn push_token_duplicate_is_idempotent() { /* register twice → no error */ }
```

Reqwest client: use `reqwest::Client::new()` with `.header("Authorization", ...)`.
WebSocket: use `tokio_tungstenite::connect_async`.
All tests are `#[tokio::test]`.

---

### T3 — Mobile: install msw

```bash
cd mobile && pnpm add -D msw
```

Verify msw is added to `devDependencies` in `package.json`.

---

### T4 — Mobile: add coverageThreshold to package.json jest config

In `mobile/package.json`, add to `"jest"` object:
```json
"coverageThreshold": {
  "global": {
    "lines": 60
  }
}
```

---

### T5 — Mobile: MSW handlers.ts

**File**: `mobile/src/__tests__/integration/msw/handlers.ts` (new)

Cover all 8 endpoints from spec §3.1 with happy-path + error handlers.
Import types from `@/types` (mapped to `mobile/src/types.ts`).
Use `http.get`, `http.post`, `http.delete` from `msw`.

---

### T6 — Mobile: MSW server.ts

**File**: `mobile/src/__tests__/integration/msw/server.ts` (new)

```typescript
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
export const server = setupServer(...handlers);
```

---

### T7 — Mobile: agents integration test

**File**: `mobile/src/__tests__/integration/agents.integration.test.ts` (new)

Tests:
- List loads agents from API
- Empty list shows empty state
- Agent detail fetch
- 401 error propagates correctly

---

### T8 — Mobile: conversations integration test

**File**: `mobile/src/__tests__/integration/conversations.integration.test.ts` (new)

Tests:
- Create conversation → 201
- List messages for a conversation
- Send message → message appears in list

---

### T9 — Mobile: inbox integration test

**File**: `mobile/src/__tests__/integration/inbox.integration.test.ts` (new)

Tests:
- Push token registration → 201
- Duplicate push token → 409 handled
- Push token delete → 204

---

### T10 — Mobile: settings integration test

**File**: `mobile/src/__tests__/integration/settings.integration.test.ts` (new)

Tests:
- Endpoint URL saved to store, API uses new baseURL
- Token saved and sent as Bearer header

---

### T11 — Scripts: test-cli.sh

**File**: `scripts/test-cli.sh` (new, executable)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../cli"
cargo build --all-targets --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
```

---

### T12 — Scripts: test-mobile.sh

**File**: `scripts/test-mobile.sh` (new, executable)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../mobile"
pnpm typecheck
pnpm lint
pnpm exec jest --watchAll=false --forceExit --coverage
```

---

### T13 — Scripts: test-e2e.sh

**File**: `scripts/test-e2e.sh` (new, executable)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../cli"
cargo test --test e2e_tests --locked
```

---

### T14 — Scripts: test-all.sh

**File**: `scripts/test-all.sh` (new, executable)

```bash
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
```

---

### T15 — CI: add cli-e2e job + mobile coverage

**File**: `.github/workflows/ci.yml`

1. Add `cli-e2e` job (after `cli-check`):
```yaml
cli-e2e:
  name: cli (serve e2e)
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: cli
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: Swatinem/rust-cache@v2
      with:
        workspaces: cli
    - name: Build
      run: cargo build --locked
    - name: Serve E2E
      run: cargo test --test e2e_tests --locked
```

2. In `mobile-check` job, update the Test step:
```yaml
- name: Test
  run: pnpm exec jest --watchAll=false --forceExit --coverage --coverageReporters=text-summary
```

---

## Verification (all must pass before commit)

```bash
cd cli && cargo build --locked
cd cli && cargo test --locked
cd cli && cargo test --test e2e_tests --locked
cd mobile && pnpm typecheck
cd mobile && pnpm exec jest --watchAll=false --forceExit --coverage
```

All 4 E2E scenarios must have green assertions. Coverage must be ≥ 60% lines.

---

## Commit Protocol

1. Run all verifications above
2. Run code review (`requesting-code-review` equivalent: check for critical bugs, no `#[allow]`/eslint-disable)
3. One single `git commit` for all changes
4. Update `docs/exec-plans/index.json` with `lastCompletedCommit`
5. Push branch, open PR (wait for user confirmation before `gh pr create`)
