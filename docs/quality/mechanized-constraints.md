# 机械化约束（Harness 第二支柱）

> "CLAUDE.md 是建议，Hooks 是法律。" 本文档列出 MultiSoul 中已经从"建议"
> 升级为"法律"的约束 —— 由脚本、ESLint、CI 强制执行，违反时拒绝 commit / 拒绝 merge。

每条规则都来自一次真实的 Agent 犯错或人类失误。我们不发明规则。

## 双层拦截

```
本地 (husky pre-commit)  →  远端 (GitHub Actions PR check)
   ~1s 反馈                       ~3min 反馈
   可被 --no-verify 跳过            硬阻塞 merge
```

本地是开发者快速反馈，远端是仓库底线。两层检查内容一致，由相同脚本驱动。

## 规则清单

### R1 · AGENTS.md ≤ 120 行

| | |
|---|---|
| 脚本 | [`scripts/check-agents-md-size.sh`](../../scripts/check-agents-md-size.sh) |
| 起因 | Harness 文章核心教训：AGENTS.md 必须是地图不是说明书 |
| 拒绝信号 | `ERROR: AGENTS.md is N lines (limit: 120)` |
| 修复方式 | 把详情下沉到 `docs/` 子目录，AGENTS.md 只保留指针 |

### R2 · 禁止硬编码 token

| | |
|---|---|
| 脚本 | [`scripts/check-no-secrets.sh`](../../scripts/check-no-secrets.sh) |
| 起因 | 一次 PR 中 `ms_v2_xxx` 真实 token 差点提交进 git history |
| 检测 | 源码 (rs/ts/tsx/js/mjs/toml/yml) 出现 `ms_v2_<16+>` 或 `Bearer <32+>` |
| 排除 | `docs/`、`__tests__/`、`*.test.*`、`fixtures/` |
| 修复方式 | 从 env / config / 用户输入读取；测试用 fixture |

### R3 · Mobile 颜色调色板合规

| | |
|---|---|
| 脚本 | [`scripts/check-mobile-colors.sh`](../../scripts/check-mobile-colors.sh) |
| 起因 | 设计系统漂移：Tailwind 默认 slate 色泄漏到 `Input.tsx`，破坏终端美学 |
| 检测 | `mobile/{src,app}/**/*.{ts,tsx}` 中的 hex 颜色必须在 [`mobile/docs/design.md`](../../mobile/docs/design.md) §2 白名单内 |
| 注意 | 单行 `//` 注释会被剥离再扫描；扩展色板必须同步更新 design.md + 脚本 |
| 修复方式 | 用调色板内的色；如确需新色，先在 design.md 添加并说明语义 |

### R4 · 禁止生产 `console.log`

| | |
|---|---|
| 实现 | [`mobile/eslint.config.mjs`](../../mobile/eslint.config.mjs) `'no-console': ['error', { allow: ['warn', 'error'] }]` |
| 起因 | 多次 `[Debug]` 日志被忘在生产代码中；console.warn/error 已能覆盖真实诊断需求 |
| 修复方式 | 调试用日志删除，或改为 `console.warn` / `console.error`（语义级别允许） |

### R10 · Mobile feature 禁止跨域深路径 import

| | |
|---|---|
| 实现 | [`mobile/eslint.config.mjs`](../../mobile/eslint.config.mjs) `no-restricted-imports` 分域规则 |
| 起因 | Inbox 直接复用 Chat 内部组件，容易形成隐藏依赖；后续 Chat 内部重构会误伤 Inbox |
| 检测 | `mobile/src/features/{agents,chat,inbox,settings}/**/*.{ts,tsx}` 不能 import 其他 feature 的 `/**` 深路径 |
| 允许 | 跨 feature 只能走公共入口，例如 `@/features/chat`；路由壳、store、hook 的全局边界后续另行收紧 |
| 修复方式 | 在被依赖 feature 新增或扩展公共入口 `index.ts`，调用方改用 `@/features/<domain>` |

### R5 · 改动包必跑 typecheck

| | |
|---|---|
| 实现 | [`.husky/pre-commit`](../../.husky/pre-commit) 中按 staged path 路由 |
| 起因 | TypeScript 错误经常逃过 lint-staged，下个会话才被发现 |
| 行为 | 改 `mobile/**` 触发 `pnpm typecheck`；改 `cli/**/*.rs` 触发 `cargo check` |
| 性能 | 文档/脚本变更不触发，避免无关惩罚 |

### R6 · 单文件 ≤ 500 行

| | |
|---|---|
| 脚本 | [`scripts/check-max-file-lines.sh`](../../scripts/check-max-file-lines.sh) |
| 起因 | 超长单文件不利于审阅与 Agent 局部修改，易重复逻辑 |
| 检测 | `mobile/{src,app}/**/*.{ts,tsx}`、`cli/src/**/*.rs` 物理行数 ≤ 500 |
| 排除 | `__tests__/`、`*.test.*`、`fixtures/` |
| 修复方式 | 拆文件、抽模块、去重；错误信息提示 LLM 按职责拆分而非放宽上限 |

### R8 · 禁止 `#[allow(...)]`

| | |
|---|---|
| 脚本 | [`scripts/check-no-allow.sh`](../../scripts/check-no-allow.sh) |
| 起因 | PR #4 中用 `#[allow(clippy::too_many_arguments)]` 掩盖了 `process_turn` 参数过多的设计问题，而不是重构 |
| 检测 | `cli/src/**/*.rs` 中出现 `#[allow(` 即拒绝 commit / CI fail |
| 修复方式 | 解决根本原因：`too_many_arguments` → 封 context struct；`dead_code` → 删未使用代码或接入调用链；`unused_imports` → 删 import；`unused_variables` → 前缀 `_` |
| 例外 | 无。真的需要 `#[allow]` 意味着代码需要重构 |

### R9 · 权威文档目录清单与磁盘一致

| | |
|---|---|
| 脚本 | [`scripts/check-docs-indices.py`](../../scripts/check-docs-indices.py)（配置 [`scripts/docs-indices.json`](../../scripts/docs-indices.json)） |
| 起因 | `README.md` 手工维护的「现有文档」列表与真实文件漂移，审查与 Agent 易误判 |
| 检测 | `docs/product-specs/`、`docs/design-docs/`、`docs/exec-plans/` 各自目录下 `*.md`（除 `README.md`）与该目录 `index.json` 中 `documents[].file` **双射**；文件名须符合各目录命名约定（由 `docs-indices.json` 内正则表达）；`documents` 排序须与配置一致（规格目录升序、设计与计划目录按文件名降序） |
| 修复方式 | 增删改权威 `.md` 时同步更新对应目录的 `index.json`（`title` 为人类可读标题）；各目录 `README` 只指针到 `index.json`，不维护平行列表；新增一类权威目录时在 `docs-indices.json` 注册一条 `indices[]` |

### R11 · Design doc 关联代码 hash 保鲜

| | |
|---|---|
| 脚本 | [`scripts/check-doc-code-hashes.py`](../../scripts/check-doc-code-hashes.py) |
| 起因 | 开发指南引用的代码文件会随时间变化；文档未同步时会误导人类和 Agent |
| 检测 | `docs/design-docs/index.json` 中带 `trackedFiles` 的文档必须满足：tracked code 变更时对应文档同 PR 修改，且 `sha256` 刷新为当前文件内容 |
| 当前 pilot | [`docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md`](../design-docs/2026-05-03-new-cli-runtime-integration-guide.md) 追踪 runtime 分发、adapter、DB 与 mobile 类型文件 |
| 修复方式 | 根据 tracked file diff 更新对应设计文档，再运行 `python3 scripts/check-doc-code-hashes.py --update` 刷新 hash |

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

### R7 · CI 远端兜底

| | |
|---|---|
| 实现 | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| 触发 | `pull_request` 与 `push: main` |
| Job 1 (`repo-checks`) | 跑 R1-R3、R6、R8、R9、R11-R12 共八个脚本 |
| Job 2 (`mobile-check`) | `pnpm typecheck` + `pnpm lint`（含 R4、R10）+ `pnpm test` |
| Job 3 (`cli-check`) | `cargo build --all-targets` + `cargo test` |
| 角色 | 兜底 —— 若开发者本地用 `--no-verify` 跳过 husky，CI 仍应在合并前拦住坏变更 |
| **合并闸** | **GitHub `main` 必须启用 branch protection：`Require status checks to pass`，且三张 green（`repo checks (constraints)`、`mobile (typecheck + lint + test)`、`cli (build + test)`）；**任一失败则不得合并**；并启用 *Do not allow bypassing*，禁止以 admin 身份绕过硬闸。操作说明见 [`docs/runbooks/github-pr-merge-policy.md`](../runbooks/github-pr-merge-policy.md) |

## 加新规则的流程

1. **观察**：Agent 或人类犯了一次错（PR 评论里出现"应该这样写"的措辞）
2. **沉淀**：把规则用人类语言写到 `CLAUDE.md` / `AGENTS.md` / 本文档
3. **机械化**：写脚本或 ESLint 规则强制执行
4. **接入双层**：husky pre-commit + CI workflow 各添一处调用
5. **演练**：构造一次违规变更，确认两层都拦截
6. **删除资格**：每条规则都应该可独立删除（参考 Bitter Lesson —— 今天的复杂规则可能明天就被模型能力覆盖）

## 不机械化的规则（暂时）

| 规则 | 不机械化的原因 |
|------|---------------|
| 不要碰 `~/.config/msctl/*` | 这是运行时约束，不是代码层；进沙箱测试时单独处理 |
| REST/WS 强制 Bearer auth | 需要运行时测试或精细 AST 分析，ROI 待评估 |
| AskQuestion 决策必须用工具调用 | 需要 LLM 语义判断，规则边界不清晰；保留为 prompt-level 软约束 |
| DB schema 改动必须走 migration | 文件路径约定即可，但当前 schema 改动频率低，先观察 |
| Bug fix 必须有回归测试 | 需要判断 bug 边界与有效断言，先作为 `CLAUDE.md` 软约束；后续可用 PR 模板或变更集检查辅助 |
| 规格/计划只写入 `product-specs` / `exec-plans` | 路径约定见 `AGENTS.md`、`docs/superpowers/README.md`；`docs/specs`、`docs/superpowers` 不跑路径门禁，靠审查与 Agent 规则 |
