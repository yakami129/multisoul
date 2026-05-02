# GitHub Actions CI/CD Implementation Plan

> **来源：** 由 `docs/superpowers/plans/2025-07-14-github-actions-cicd.md` 迁入；命令中的路径已改为从仓库根目录执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善三个 GitHub Actions workflow：`ci.yml`（加 `workflow_call` + clippy/fmt/prettier）、`release-cli.yml`（加 CI 前置 + macOS Intel 平台）、新建 `release-ios.yml`（EAS Build + TestFlight）。

**Architecture:** `ci.yml` 暴露 `workflow_call` 接口，两个发布 workflow 通过 `needs: ci` 串联它，确保发布前 CI 全部通过。三个文件各自独立，互不耦合。

**Tech Stack:** GitHub Actions, Rust/Cargo, pnpm, EAS CLI (Expo), softprops/action-gh-release@v2, dtolnay/rust-toolchain, Swatinem/rust-cache, pnpm/action-setup

---

## File Map

| 文件 | 操作 | 变更内容 |
|------|------|----------|
| `.github/workflows/ci.yml` | 修改 | 加 `workflow_call` 触发器；cli-check 加 clippy + fmt；mobile-check 加 format:check |
| `.github/workflows/release-cli.yml` | 修改 | 加 CI 前置 job；matrix 加 `x86_64-apple-darwin`；npm 组装步骤加 macOS Intel |
| `.github/workflows/publish-npm.yml` | 删除 | 功能已被 release-cli.yml 的 publish-npm job 覆盖，独立手动触发版本冗余 |
| `.github/workflows/release-ios.yml` | 新建 | EAS Build + Submit，依赖 ci workflow_call |

---

## Task 1: ci.yml — 加 workflow_call + clippy + fmt + prettier

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 在 `on:` 块加 `workflow_call`**

将 `ci.yml` 的 `on:` 改为：

```yaml
on:
  pull_request:
  push:
    branches: [main]
  workflow_call:
```

- [ ] **Step 2: cli-check job 加 clippy 和 fmt**

在 `cli-check` job 的 steps 末尾，`Test` step 之后加：

```yaml
      - name: Clippy
        run: cargo clippy --all-targets --locked -- -D warnings

      - name: Format check
        run: cargo fmt --check
```

- [ ] **Step 3: mobile-check job 加 format:check**

在 `mobile-check` job 的 `Lint` step 之后加：

```yaml
      - name: Format check
        run: pnpm format:check
```

- [ ] **Step 4: 验证 YAML 语法**

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add workflow_call trigger, clippy, fmt, prettier checks"
```

---

## Task 2: release-cli.yml — 加 CI 前置 + macOS Intel 平台

**Files:**
- Modify: `.github/workflows/release-cli.yml`

- [ ] **Step 1: 在 jobs 最前面加 ci 前置 job**

在 `jobs:` 下、`build-binaries:` 之前插入：

```yaml
  ci:
    name: CI checks
    uses: ./.github/workflows/ci.yml

```

- [ ] **Step 2: build-binaries 加 needs: ci**

将 `build-binaries:` job 的 `name:` 行下方加：

```yaml
    needs: ci
```

- [ ] **Step 3: matrix 加 x86_64-apple-darwin**

在 matrix `include:` 列表中，`aarch64-apple-darwin` 条目之后加：

```yaml
          - os: macos-14
            target: x86_64-apple-darwin
            archive: tar.gz
            binary: msctl
```

- [ ] **Step 4: publish-npm job 加 macOS Intel 的组装步骤**

在 `Assemble bundled binaries` step 的 shell 脚本中，`aarch64-apple-darwin` 块之后加：

```bash
          tar -xzf "artifacts/msctl-${version}-x86_64-apple-darwin.tar.gz" -C artifacts
          mkdir -p vendor/x86_64-apple-darwin
          cp "artifacts/msctl-${version}-x86_64-apple-darwin/msctl" "vendor/x86_64-apple-darwin/msctl"
          chmod +x "vendor/x86_64-apple-darwin/msctl"
```

- [ ] **Step 5: publish-release 和 publish-container 也加 needs: ci**

`publish-release` 和 `publish-container` 已经 `needs: build-binaries`，间接依赖 CI，无需修改。`publish-npm` 同理。

- [ ] **Step 6: 验证 YAML 语法**

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-cli.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release-cli.yml
git commit -m "ci: add CI gate and x86_64-apple-darwin to release-cli workflow"
```

---

## Task 3: 删除冗余的 publish-npm.yml

**Files:**
- Delete: `.github/workflows/publish-npm.yml`

`publish-npm.yml` 是一个独立的手动触发 workflow，功能与 `release-cli.yml` 中的 `publish-npm` job 完全重复。保留它会造成混淆（两条发布路径）。

- [ ] **Step 1: 删除文件**

```bash
rm .github/workflows/publish-npm.yml
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish-npm.yml
git commit -m "ci: remove redundant publish-npm.yml (covered by release-cli.yml)"
```

---

## Task 4: 新建 release-ios.yml

**Files:**
- Create: `.github/workflows/release-ios.yml`

- [ ] **Step 1: 创建文件**

```yaml
name: Release iOS

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      version:
        description: "Release version, for example v0.1.0"
        required: true
        type: string

concurrency:
  group: release-ios-${{ github.ref }}
  cancel-in-progress: false

jobs:
  ci:
    name: CI checks
    uses: ./.github/workflows/ci.yml

  build-and-submit:
    name: EAS Build + Submit to TestFlight
    needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 60
    defaults:
      run:
        working-directory: mobile
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: mobile/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build iOS (EAS)
        run: npx eas-cli build --platform ios --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

      - name: Submit to TestFlight
        run: npx eas-cli submit --platform ios --non-interactive --latest
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

- [ ] **Step 2: 验证 YAML 语法**

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-ios.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-ios.yml
git commit -m "ci: add release-ios workflow (EAS Build + TestFlight)"
```

---

## Spec Coverage Check

| SPEC 要求 | 对应 Task |
|-----------|-----------|
| PR CI 检查（lint/fmt/typecheck/test/constraints） | Task 1 |
| `workflow_call` 供发布复用 | Task 1 |
| clippy + cargo fmt | Task 1 |
| prettier format:check | Task 1 |
| v* tag 触发 CLI 发布，CI 前置 | Task 2 |
| macOS Intel 平台二进制 | Task 2 |
| v* tag 触发 iOS 发布，CI 前置 | Task 4 |
| EAS Build + TestFlight | Task 4 |
| 删除冗余 workflow | Task 3 |
