# GitHub Actions CI/CD SPEC

> **来源：** 由 `docs/specs/github-actions-cicd-spec.md` 迁入 canonical 路径（`docs/product-specs/`）。

## 1. 背景与目标

MultiSoul monorepo 包含 Rust CLI（`msctl`）和 React Native iOS App。目标是通过 GitHub Actions 将 CI 检查、CLI 发布（npm）、iOS 发布（TestFlight）串联成自动化流水线，减少人工操作，保证发布质量。

## 2. 范围

### 2.1 In Scope

- PR CI 检查（lint、format、typecheck、test、mechanized constraints）
- **`msctl-v*.*.*` tag**（或手动触发 **`Release CLI`**）发布 CLI：npm `@yakami129/msctl`、GitHub Release、GHCR
- **`ios-v*.*.*` tag**（或手动触发 **`Release iOS`**）走 EAS Build + TestFlight（版本以 `app.json` / `eas.json` 为准）
- GitHub Release 自动创建（附带多平台二进制）
- Secrets 配置指引

### 2.2 Out of Scope

- Android 发布
- 后端服务部署
- 自动打 tag / 版本号管理
- Slack 通知

---

## 3. Workflow 文件结构

```
.github/workflows/
├── ci.yml           # PR 检查（可被发布 workflow 复用）
├── release-cli.yml  # CLI 发布
└── release-ios.yml  # iOS 发布
```

---

## 4. ci.yml — CI 检查

**触发条件：** `pull_request` → `main`，以及 `workflow_call`（供发布 workflow 调用）

### Jobs

#### `check-constraints`（runner: `ubuntu-latest`）

```bash
scripts/check-no-secrets.sh        # 检测硬编码 token/Bearer
scripts/check-mobile-colors.sh     # 检测 mobile/ 非 allowlist 颜色
scripts/check-agents-md-size.sh    # 检测 AGENTS.md 超 120 行
```

> `check-mobile-colors.sh` 默认用 `git ls-files` 扫描全部 tracked 文件，CI 中直接运行无需 `--staged` 参数。

#### `lint-rust`（runner: `ubuntu-latest`）

```bash
cargo clippy -- -D warnings
cargo fmt --check
```

#### `test-rust`（runner: `ubuntu-latest`）

```bash
cargo test
```

#### `lint-mobile`（runner: `ubuntu-latest`）

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint --max-warnings 0
pnpm format:check     # prettier --check
```

#### `test-mobile`（runner: `ubuntu-latest`）

```bash
pnpm install --frozen-lockfile
pnpm test -- --watchAll=false --ci
```

**失败行为：** 任一 job 失败，PR 显示红叉；发布 workflow 不继续执行。

---

## 5. release-cli.yml — CLI 发布

**触发条件：** `push` tag `msctl-v*.*.*`，或 `workflow_dispatch`（参数为完整 tag，如 `msctl-v0.1.0`）

**前置：** 通过 `workflow_call` 调用 `ci.yml`，全部通过后才进入构建。

### Jobs

#### `ci`

复用 `ci.yml`（`workflow_call`）。

#### `build-binaries`（matrix，depends on `ci`）

| target | runner |
|--------|--------|
| `aarch64-apple-darwin` | `macos-latest` |
| `x86_64-apple-darwin` | `macos-latest` |
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` |
| `x86_64-pc-windows-msvc` | `windows-latest` |

每个 matrix job：

1. `rustup target add <target>`
2. `cargo build --release --target <target>`
3. 上传二进制为 artifact（命名：`msctl-<target>`，Windows 为 `msctl-<target>.exe`）

#### `publish-npm`（depends on `build-binaries`）

1. 下载全部 4 个 artifacts
2. 将二进制放入 `cli/npm/vendor/<target>/msctl[.exe]`
3. 从 tag 名去掉 `msctl-` 与 `v` 前缀得到 semver，覆盖 `cli/npm/package.json` 的 `version`
4. `npm publish --access public`（使用 `NPM_TOKEN`）

#### `create-release`（depends on `build-binaries`）

1. 下载全部 artifacts
2. `gh release create <tag>` 附带 4 个二进制文件
3. Release notes 从 tag message 生成

---

## 6. release-ios.yml — iOS 发布

**触发条件：** `push` tag `ios-v*.*.*`，或 `workflow_dispatch`

**前置：** 通过 `workflow_call` 调用 `ci.yml`，全部通过后才进入构建。

### Jobs

#### `ci`

复用 `ci.yml`（`workflow_call`）。

#### `build-and-submit`（runner: `ubuntu-latest`，depends on `ci`）

1. `pnpm install --frozen-lockfile`
2. `npx eas-cli build --platform ios --non-interactive`
3. `npx eas-cli submit --platform ios --non-interactive`

- timeout: 60 分钟（EAS Build 云端构建通常 15–30 分钟）
- 证书：EAS Managed（无需额外 Apple 证书 secrets）

---

## 7. Secrets 配置清单

| Secret 名称 | 用途 | 获取方式 |
|-------------|------|----------|
| `NPM_TOKEN` | npm publish | npmjs.com → Access Tokens → 类型选 **Automation** |
| `EXPO_TOKEN` | EAS Build + Submit | expo.dev → Account Settings → Access Tokens |

配置位置：GitHub repo → Settings → Secrets and variables → Actions → New repository secret

---

## 8. 版本号同步策略

- 打 **`msctl-v*`** tag 前手动确保 `cli/Cargo.toml` 和 `cli/npm/package.json` 的 `version` 字段一致
- `release-cli.yml` 中从 tag 名（`msctl-v1.2.3` → `1.2.3`）覆盖 `cli/npm/package.json` 的 `version`，确保 npm 包版本与 Cargo 一致
- `Cargo.toml` 版本不在 CI 中修改

---

## 9. 验收标准

- [ ] 提 PR 时，5 个 CI job 全部运行，任一失败显示红叉
- [ ] `check-no-secrets` 能检测到硬编码 token 并阻断 PR
- [ ] `check-mobile-colors` 能检测到非 allowlist 颜色并阻断 PR
- [ ] `check-agents-md-size` 能检测到 AGENTS.md 超限并阻断 PR
- [ ] 打 `msctl-v0.1.2` tag 后，npm 出现 `@yakami129/msctl@0.1.2`，包含 4 平台二进制
- [ ] 打 `msctl-v*` tag 后，GitHub Releases 出现对应 release，附带各平台二进制下载
- [ ] 打 `ios-v*` tag（且 `app.json` / EAS 配置正确）后，TestFlight 出现新构建
- [ ] CI 任一 job 失败时，发布 job 不执行
