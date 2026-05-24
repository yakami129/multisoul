# CLI（`msctl`）发布 Runbook

在默认分支上打 **语义化 tag** `vMAJOR.MINOR.PATCH` 会触发 GitHub Actions workflow **`Release CLI`**（`.github/workflows/release-cli.yml`），自动构建多平台二进制、创建 GitHub Release、推送容器镜像，并在配置了密钥时发布 npm 包。

> **与 iOS 解耦：** 云端 iOS 发布使用 **`ios-v*.*.*`** tag（`release-ios.yml`）。CLI 使用 **`v*.*.*`**。二者互不触发对方 workflow。

## 前置条件

- 发版提交应在 **`main`**（或你们约定的默认分支）上，且 CI 能通过；workflow 会先跑 `ci.yml`（含 `cli` 的 `cargo test --locked` 等）。
- 仓库 **Secrets**（在 GitHub → Settings → Secrets and variables → Actions）：
  - **`NPM_TOKEN`**：发布 `@yakami129/msctl` 到 npm 所必需；未配置时 **Publish npm Package** job 会在 `npm publish` 步骤失败（当前 workflow 无跳过逻辑）。
  - **`GITHUB_TOKEN`** 由 Actions 注入，用于 Release 与 GHCR，一般无需手工配置。

## 发版前本地检查

在版本号写入 `Cargo.toml` 之后执行：

```bash
cd cli
cargo test --locked
```

确认 `cli/Cargo.lock` 中根包 `msctl` 的版本与 `Cargo.toml` 一致（若不一致，运行 `cargo build` 或 `cargo test` 不带 `--locked` 一次以更新 lock，再提交 lock 变更）。

## 需要改动的文件

以下三处版本应保持一致（与即将打的 **tag** 在去掉 `v` 前缀后的 **纯 semver** 一致，例如 tag `v0.1.2` → `0.1.2`）：

| 文件 | 说明 |
|------|------|
| `cli/Cargo.toml` | `[package] version` |
| `cli/Cargo.lock` | `[[package]] name = "msctl"` 的 `version` |
| `cli/npm/package.json` | `"version"`（workflow 里也会用 tag 覆盖，但仓库内保持一致便于本地与审阅） |

## 标准发布步骤

1. 切到最新默认分支并同步远端：
   ```bash
   git checkout main
   git pull origin main
   ```
2. 按上表 bump 版本（例如 `0.1.2`），保存上述三个文件。
3. 本地验证：`cd cli && cargo test --locked`。
4. 提交版本 bump（示例信息）：
   ```bash
   git add cli/Cargo.toml cli/Cargo.lock cli/npm/package.json
   git commit -m "chore(cli): bump msctl to v0.1.2"
   ```
5. 打 tag 并推送 **分支 + tag**（仅 `git push origin tag` 不会把版本提交推到默认分支，容易遗漏）：
   ```bash
   git tag v0.1.2
   git push origin main
   git push origin v0.1.2
   ```

推送符合 `v*.*.*` 的 tag 后即触发 **`Release CLI`**（不会触发 iOS Release）。

## Workflow 行为摘要

- **CI**：复用 `.github/workflows/ci.yml`。
- **构建矩阵**：`x86_64-unknown-linux-gnu`、`aarch64-apple-darwin`（`macos-14`）、`x86_64-apple-darwin`（`macos-15-intel`，勿再用已退役的 `macos-13`）、`x86_64-pc-windows-msvc`，产出 tar.gz / zip 工件。
- **GitHub Release**：`softprops/action-gh-release`，附带各平台压缩包。
- **容器**：推送到 `ghcr.io/<owner>/<repo>/msctl`（具体以 workflow 中 `IMAGE_NAME` 为准）。
- **npm**：在 `cli/npm` 中组装 `vendor/` 下各平台二进制后 `npm publish`；版本号由 **tag**（或手动输入）推导，与 `package.json` 发版时应一致。

## 手动触发（不打 tag 推送时）

在 GitHub → Actions → **Release CLI** → **Run workflow**，在 **version** 中填入**完整 tag 名**，例如 `v0.1.0`（`workflow_dispatch` 创建的 Release 也将使用该名称）。此时应保证默认分支上的 `cli` 源码与 Cargo 版本已与该发版意图一致。

## 发布后核对

- Actions 中 **`Release CLI`** 运行是否全部成功。
- **Releases** 页面是否出现对应 tag 与附件。
- 若使用 npm：在 npm 上查看 `@yakami129/msctl` 是否出现新版本。

可用 CLI 快速查看运行列表（需已安装 [`gh`](https://cli.github.com/) 并完成 `gh auth login`）：

```bash
gh run list --workflow "Release CLI" --limit 5
```

## 常见问题

### CLI 与 iOS 分别用什么 tag？

| 产物 | Tag 示例 |
|------|----------|
| CLI `msctl` | `v0.1.2` |
| iOS（TestFlight） | `ios-v1.2.3` |

请勿对 CLI 再使用已废弃的 **`msctl-v*`** 前缀（见下方迁移说明）。

### Release 卡在 `Waiting for a runner` + `macos-13`

`macos-13` 已被 GitHub Actions 下线（约 2025-12 起），使用该 label 的作业可能**永远不分配 runner**。处理方式：

1. 在 Actions 里**取消**该次运行（或等其超时）。
2. 将 workflow 中 Intel macOS 一行改为 **`macos-15-intel`**（或改为在 Apple Silicon runner 上对 `x86_64-apple-darwin` 做交叉编译），合并进默认分支。
3. 在 Actions 中对该 workflow 使用 **Run workflow**，版本填 **`v0.1.2`**（与失败发版相同），以当前 `main` 上的 workflow 重新跑全流程；或发新 patch 版本并打新 tag。

### `git pull` 提示未跟踪文件将被覆盖

若本地有**未跟踪**文件，且远端在**同一路径**新增了已跟踪文件，`git pull` 会拒绝合并。可先暂存或移走该未跟踪文件，再 `pull`；若与远端内容等价，删除本地未跟踪副本后拉取即可。

### tag 已存在

同一 tag 不可重复推送。若发版失败需重发，应使用**新版本号**（bump patch/minor/major）并打新 tag，或按团队流程删除远端有问题的 tag 后重打（需谨慎，已发布到 npm/GHCR 的 tag 一般不应删除重打）。

### 从功能分支发版

建议先把发版用的版本 bump **合并进默认分支**，再在默认分支上打 tag，避免 Release 指向的源码与团队认知的「主线版本」不一致。

## 历史 tag 迁移（`msctl-v*` → `v*`）

2026-05 起 CLI 发版 tag 统一为 **`v*.*.*`**。若远端仍存在 `msctl-v0.1.11` 等旧 tag，可在合并新 workflow 后执行：

```bash
./scripts/migrate-msctl-v-tags-to-v.sh
```

脚本会：在相同 commit 上创建 `v*` tag、将已有 GitHub Release 改绑到新 tag、删除 `msctl-v*` tag。执行前需 `gh auth login` 且对仓库有 admin 权限。
