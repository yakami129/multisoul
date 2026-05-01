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

### R5 · 改动包必跑 typecheck

| | |
|---|---|
| 实现 | [`.husky/pre-commit`](../../.husky/pre-commit) 中按 staged path 路由 |
| 起因 | TypeScript 错误经常逃过 lint-staged，下个会话才被发现 |
| 行为 | 改 `mobile/**` 触发 `pnpm typecheck`；改 `cli/**/*.rs` 触发 `cargo check` |
| 性能 | 文档/脚本变更不触发，避免无关惩罚 |

### R6 · CI 远端兜底

| | |
|---|---|
| 实现 | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| 触发 | `pull_request` 与 `push: main` |
| Job 1 (`repo-checks`) | 跑 R1-R3 三个脚本 |
| Job 2 (`mobile-check`) | `pnpm typecheck` + `pnpm lint` + `pnpm test` |
| Job 3 (`cli-check`) | `cargo build --all-targets` + `cargo test` |
| 角色 | 兜底 —— 若开发者本地用 `--no-verify` 跳过 husky，CI 仍拒绝 merge |

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
