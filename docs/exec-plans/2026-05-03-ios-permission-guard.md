# iOS 权限声明守护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 双层拦截「Expo 原生权限模块已安装但 Info.plist 缺少 NSXxxUsageDescription」，同时接入 expo-doctor 捕获依赖漂移。

**Architecture:** 新增 `scripts/check-ios-permissions.sh` 静态检查脚本，读取 `mobile/package.json` 推算必要 plist key，与 `mobile/ios/MultiSoul/Info.plist` 比对；pre-commit 按 staged 路径条件触发，CI `repo-checks` job 无条件运行。expo-doctor 仅在 CI `mobile-check` job 运行（避免 npx 下载延迟影响本地 commit）。

**Tech Stack:** bash, Python（已有脚本风格参考），GitHub Actions YAML，expo-doctor（npx）

---

## 文件清单

| 文件 | 操作 |
|---|---|
| `scripts/check-ios-permissions.sh` | 新建 |
| `.husky/pre-commit` | 在 staged_ios 条件块增加调用 |
| `.github/workflows/ci.yml` | repo-checks 加 R12 step；mobile-check 加 expo-doctor step |
| `mobile/app.json` | 将顶层 `newArchEnabled` 移入 `expo.newArchEnabled` |
| `mobile/package.json` | 添加 `expo-asset` dep；`react-native-gesture-handler` 加入 `expo.install.exclude` |
| `docs/quality/mechanized-constraints.md` | 追加 R12 小节 |
| `docs/exec-plans/index.json` | 注册本计划 |

---

## Task 1：新建 `scripts/check-ios-permissions.sh`

**Files:**
- Create: `scripts/check-ios-permissions.sh`

- [ ] **Step 1：写脚本文件**

```bash
#!/usr/bin/env bash
# R12 · iOS Info.plist 权限声明守护
# 检查 mobile/package.json 中安装的 Expo 权限模块，
# 确认 mobile/ios/MultiSoul/Info.plist 里声明了对应的 NSXxxUsageDescription。
#
# 用法：
#   bash scripts/check-ios-permissions.sh           # 全量（CI）
#   bash scripts/check-ios-permissions.sh --staged  # 仅在 staged 含相关文件时跑（pre-commit）
#
# 维护：新增需要权限的 Expo 模块时，在下方 MAPPINGS 中追加一行，格式：
#   "expo-module-name:NSXxxUsageDescription[,NsYyyUsageDescription]"

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
PACKAGE_JSON="$repo_root/mobile/package.json"
INFO_PLIST="$repo_root/mobile/ios/MultiSoul/Info.plist"

# --staged 模式：仅当 staged 文件含 mobile/package.json 或 mobile/ios/** 时才运行
if [[ "${1:-}" == "--staged" ]]; then
  staged=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if ! echo "$staged" | grep -qE '^mobile/(package\.json|ios/)'; then
    exit 0
  fi
fi

# 映射表：每行 "expo-module:key1,key2"
MAPPINGS=(
  "expo-image-picker:NSPhotoLibraryUsageDescription"
  "expo-camera:NSCameraUsageDescription"
  "expo-location:NSLocationWhenInUseUsageDescription"
  "expo-media-library:NSPhotoLibraryUsageDescription,NSPhotoLibraryAddUsageDescription"
  "expo-contacts:NSContactsUsageDescription"
  "expo-calendar:NSCalendarsUsageDescription"
  "expo-audio:NSMicrophoneUsageDescription"
)

fail=0

for entry in "${MAPPINGS[@]}"; do
  module="${entry%%:*}"
  keys_str="${entry#*:}"

  # 检查模块是否在 package.json dependencies 或 devDependencies 中
  if ! python3 -c "
import json, sys
d = json.load(open('$PACKAGE_JSON'))
deps = {**d.get('dependencies', {}), **d.get('devDependencies', {})}
sys.exit(0 if '$module' in deps else 1)
" 2>/dev/null; then
    continue
  fi

  # 检查每个必要 key 是否在 Info.plist 中
  IFS=',' read -ra keys <<< "$keys_str"
  for key in "${keys[@]}"; do
    if ! grep -q "<key>${key}</key>" "$INFO_PLIST"; then
      echo "ERROR [R12]: '$module' is installed but Info.plist is missing <key>${key}</key>"
      echo "  Fix: add <key>${key}</key><string>Describe why the app needs this</string> to mobile/ios/MultiSoul/Info.plist"
      fail=1
    fi
  done
done

if [[ $fail -eq 1 ]]; then
  echo ""
  echo "R12 failed. See docs/quality/mechanized-constraints.md §R12 for the full module→key mapping."
  exit 1
fi

exit 0
```

- [ ] **Step 2：给脚本加可执行权限**

```bash
chmod +x scripts/check-ios-permissions.sh
```

- [ ] **Step 3：验证脚本在当前仓库通过（当前 Info.plist 已有所有必要 key）**

```bash
bash scripts/check-ios-permissions.sh
```

期望输出：无任何 ERROR 行，exit 0。

- [ ] **Step 4：验证 --staged 模式在没有相关 staged 文件时直接跳过**

```bash
bash scripts/check-ios-permissions.sh --staged
echo "exit code: $?"
```

期望输出：`exit code: 0`（无 staged 文件时不运行）。

---

## Task 2：接入 pre-commit

**Files:**
- Modify: `.husky/pre-commit`

- [ ] **Step 1：在 pre-commit 的 staged_mobile 块之后，添加 staged_ios 条件块**

在 `.husky/pre-commit` 里，找到这段：

```bash
# 3c. No #[allow(...)] in Rust source (staged paths only)
bash scripts/check-no-allow.sh --staged
```

在它后面（`# 3d.` 那行之前）插入：

```bash
# 3e. iOS Info.plist permission alignment (staged paths only)
bash scripts/check-ios-permissions.sh --staged
```

修改后该区域应如下所示：

```bash
# 3c. No #[allow(...)] in Rust source (staged paths only)
bash scripts/check-no-allow.sh --staged

# 3e. iOS Info.plist permission alignment (staged paths only)
bash scripts/check-ios-permissions.sh --staged

# 3d. Canonical docs manifests (product-specs / design-docs / exec-plans)
```

- [ ] **Step 2：验证 pre-commit 钩子语法正确**

```bash
bash -n .husky/pre-commit
echo "syntax ok"
```

期望输出：`syntax ok`

---

## Task 3：接入 CI repo-checks

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1：在 repo-checks job 末尾追加 R12 step**

在 `ci.yml` 的 `repo-checks` job 中，找到最后一步：

```yaml
      - name: docs code hashes stay fresh
        run: python3 scripts/check-doc-code-hashes.py --check
```

在其后追加：

```yaml
      - name: iOS Info.plist permission alignment (R12)
        run: bash scripts/check-ios-permissions.sh
```

- [ ] **Step 2：验证 YAML 语法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "yaml ok"
```

期望输出：`yaml ok`

---

## Task 4：修复 expo-doctor warning ①  — app.json `newArchEnabled`

**Files:**
- Modify: `mobile/app.json`

expo-doctor 报 `should NOT have additional property 'newArchEnabled'`，因为 SDK 55 要求该字段放在 `expo.newArchEnabled` 而非顶层。

- [ ] **Step 1：把 `newArchEnabled` 从顶层移到 `expo` 对象内**

当前 `mobile/app.json` 顶层有：

```json
"newArchEnabled": true,
```

将其删除，并在 `expo` 对象内 `"name"` 字段之后添加：

```json
"newArchEnabled": true,
```

修改后 `expo` 对象开头应如下：

```json
"expo": {
  "name": "MultiSoul",
  "newArchEnabled": true,
  "slug": "multisoul",
```

- [ ] **Step 2：验证 JSON 合法**

```bash
python3 -m json.tool mobile/app.json > /dev/null && echo "json ok"
```

期望输出：`json ok`

---

## Task 5：修复 expo-doctor warning ②  — `expo-asset` peer dep

**Files:**
- Modify: `mobile/package.json`（由 pnpm install 自动更新）
- Modify: `mobile/pnpm-lock.yaml`（pnpm 自动更新）

- [ ] **Step 1：安装 expo-asset**

```bash
cd mobile && npx expo install expo-asset
```

期望：命令结束无错误，`package.json` 的 `dependencies` 中出现 `expo-asset`。

- [ ] **Step 2：确认版本写入**

```bash
grep "expo-asset" mobile/package.json
```

期望输出：包含 `"expo-asset": "~X.Y.Z"` 的行。

---

## Task 6：修复 expo-doctor warning ③  — 版本漂移

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/pnpm-lock.yaml`

expo-doctor 报告三个版本问题：
- `expo` 55.0.17 → 需要 ~55.0.19
- `expo-notifications` 55.0.20 → 需要 ~55.0.22
- `react-native-gesture-handler` 2.31.1 vs ~2.30.0（minor 漂移）

- [ ] **Step 1：升级 expo 和 expo-notifications**

```bash
cd mobile && npx expo install expo@~55.0.19 expo-notifications@~55.0.22
```

期望：命令完成，`package.json` 版本更新。

- [ ] **Step 2：将 react-native-gesture-handler 加入 expo.install.exclude 豁免**

minor 漂移不影响功能，用 exclude 豁免而非降版本以避免潜在回退。

在 `mobile/package.json` 中的 `"expo"` 对象里（若没有则新建）添加：

```json
"expo": {
  "install": {
    "exclude": ["react-native-gesture-handler"]
  }
}
```

- [ ] **Step 3：验证 JSON 合法**

```bash
python3 -m json.tool mobile/package.json > /dev/null && echo "json ok"
```

期望输出：`json ok`

- [ ] **Step 4：重新安装依赖，确保 lockfile 一致**

```bash
cd mobile && pnpm install
```

期望：无报错。

---

## Task 7：接入 expo-doctor 到 CI mobile-check

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1：在 mobile-check job 的 Install 步骤之后，Typecheck 之前，插入 expo-doctor step**

找到：

```yaml
      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck
```

在两者之间插入：

```yaml
      - name: expo-doctor
        run: npx expo-doctor
```

- [ ] **Step 2：验证 YAML 语法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "yaml ok"
```

期望输出：`yaml ok`

- [ ] **Step 3：本地验证 expo-doctor 通过（warning 全部清零后）**

```bash
cd mobile && npx expo-doctor
```

期望输出：`N/N checks passed`，无 `✖` 行，exit 0。

---

## Task 8：更新 `docs/quality/mechanized-constraints.md`

**Files:**
- Modify: `docs/quality/mechanized-constraints.md`

- [ ] **Step 1：在 R11 小节后追加 R12 小节**

找到文件末尾 `## 不机械化的规则（暂时）` 之前，追加：

```markdown
### R12 · iOS Info.plist 权限声明对齐

| | |
|---|---|
| 脚本 | [`scripts/check-ios-permissions.sh`](../../scripts/check-ios-permissions.sh) |
| 起因 | `feat(chat): multi-image upload` 引入 `expo-image-picker` 后未添加 `NSPhotoLibraryUsageDescription`，iOS 直接崩溃 |
| 检测 | 扫描 `mobile/package.json` 中的 Expo 权限模块，对比 `mobile/ios/MultiSoul/Info.plist` 中的 key |
| 触发 | pre-commit（staged 含 `mobile/package.json` 或 `mobile/ios/**`）；CI `repo-checks` 全量 |
| 修复方式 | 在 `Info.plist` 添加缺失的 `NSXxxUsageDescription`；同步更新脚本映射表与本文档 |

**模块→key 映射表：**

| Expo 模块 | 必须存在的 plist key |
|---|---|
| `expo-image-picker` | `NSPhotoLibraryUsageDescription` |
| `expo-camera` | `NSCameraUsageDescription` |
| `expo-location` | `NSLocationWhenInUseUsageDescription` |
| `expo-media-library` | `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` |
| `expo-contacts` | `NSContactsUsageDescription` |
| `expo-calendar` | `NSCalendarsUsageDescription` |
| `expo-audio` | `NSMicrophoneUsageDescription` |

```

---

## Task 9：注册 exec-plan 到 index.json，全量验证，提交

**Files:**
- Modify: `docs/exec-plans/index.json`

- [ ] **Step 1：将本计划注册到 `docs/exec-plans/index.json`**

在 `documents` 数组**开头**插入（降序排列）：

```json
{
  "file": "2026-05-03-ios-permission-guard.md",
  "title": "iOS 权限声明守护"
},
```

- [ ] **Step 2：运行全量验证**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul

bash scripts/check-ios-permissions.sh
bash scripts/check-agents-md-size.sh
bash scripts/check-mobile-colors.sh
bash scripts/check-max-file-lines.sh
bash scripts/check-no-allow.sh
bash scripts/check-no-secrets.sh
python3 scripts/check-docs-indices.py
python3 scripts/check-doc-code-hashes.py --check
```

期望：所有命令 exit 0，无错误输出。

- [ ] **Step 3：运行 mobile typecheck**

```bash
cd mobile && pnpm typecheck
```

期望：无 TypeScript 错误。

- [ ] **Step 4：运行 mobile 测试**

```bash
cd mobile && pnpm test -- --watchAll=false
```

期望：所有测试通过。

- [ ] **Step 5：提交**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul
git add \
  scripts/check-ios-permissions.sh \
  .husky/pre-commit \
  .github/workflows/ci.yml \
  mobile/app.json \
  mobile/package.json \
  mobile/pnpm-lock.yaml \
  mobile/ios/MultiSoul/Info.plist \
  docs/quality/mechanized-constraints.md \
  docs/design-docs/2026-05-03-ios-permission-guard-design.md \
  docs/design-docs/index.json \
  docs/exec-plans/2026-05-03-ios-permission-guard.md \
  docs/exec-plans/index.json

git commit -m "feat(quality): R12 iOS permission guard + expo-doctor CI integration

- Add scripts/check-ios-permissions.sh (R12): maps Expo modules to
  required NSXxxUsageDescription keys, fails if any are missing
- Wire R12 into pre-commit (staged mobile/package.json or ios/**)
  and CI repo-checks (unconditional)
- Fix expo-doctor warnings: move newArchEnabled into expo object,
  add expo-asset peer dep, upgrade expo + expo-notifications,
  exclude react-native-gesture-handler from version check
- Add expo-doctor step to CI mobile-check job
- Document R12 in mechanized-constraints.md
- Info.plist already has NSPhotoLibraryUsageDescription (hotfix from
  previous commit)

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6：将 lastCompletedCommit 写入 exec-plans/index.json**

```bash
SHA=$(git rev-parse HEAD)
echo "SHA: $SHA"
```

用该 SHA 更新 `docs/exec-plans/index.json` 中本计划条目的 `lastCompletedCommit` 字段：

```json
{
  "file": "2026-05-03-ios-permission-guard.md",
  "title": "iOS 权限声明守护",
  "lastCompletedCommit": "<上一步输出的40位SHA>"
}
```

然后补充提交：

```bash
git add docs/exec-plans/index.json
git commit -m "chore: record lastCompletedCommit for ios-permission-guard plan

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```
