# Custom Lint Skill 设计

本文记录 `custom-lint` project skill 的设计决策。它的目标是让 Agent 能把一次真实犯错沉淀成可执行的仓库 lint：采访用户、生成检查脚本、接入本地 pre-commit 与 CI，并把规则写回质量文档。

## 背景

MultiSoul 已有多条机械化约束，例如 hardcoded token、单文件行数、Rust `#[allow]`、文档索引和 design-doc code hash。它们共同遵守一个模式：

1. 规则来自真实错误，而不是预先发明。
2. 本地 pre-commit 给快速反馈，CI 做最终阻塞。
3. 规则必须有清晰拒绝信号和修复提示。
4. 每条规则都应能独立删除。

当前问题是：新增一条 lint 仍依赖 Agent 临场发挥。`custom-lint` skill 要把这套流程固化为项目内可复用能力，并让 Cursor、Claude Code、Codex 都能发现。

## 目标

- 支持确定性 lint 与 PR diff 语义 lint。
- 通过采访式生成收集规则上下文，适配手机低输入场景。
- 自动修改标准门禁文件，减少遗漏。
- 生成“一条规则一个脚本”的资产，保持可删除性。
- CI blocking 只依赖可复现输入。
- 在项目内维护 skill，使 Cursor、Claude Code、Codex 都能自动识别或通过项目指针发现。

## 非目标

- v1 不读取 Agent transcript 作为 CI 阻塞输入。
- v1 不默认依赖 LLM API 判断语义违规。
- v1 不引入集中式 lint runner。
- v1 不清理历史存量违规；历史治理应单独计划。

## 核心决策

### D1 · Skill 真源放在 `.agents/skills`

Canonical source:

```text
.agents/skills/custom-lint/
  SKILL.md
  references/
  templates/
  scripts/
```

理由：

- `.agents/skills` 是项目内共享 skill 的真源，适合进入版本控制。
- 其他 agent 入口只做适配，不复制主体内容。
- 后续如需安装到本机全局 skill 目录，可以从该目录同步。

### D2 · 三端适配尽量使用 symlink

适配策略：

```text
.claude/skills/custom-lint/SKILL.md -> ../../../.agents/skills/custom-lint/SKILL.md
.cursor/rules/custom-lint.mdc      # 薄 wrapper，指向 canonical source
AGENTS.md / CLAUDE.md              # 仅放短指针
```

Claude Code 的 `SKILL.md` 可以优先 symlink 到真源。Cursor Project Rules 需要 `.mdc` frontmatter 和 rule 语义，不能假设能直接读取 `SKILL.md`，因此采用薄 wrapper：说明触发条件，并要求读取 `.agents/skills/custom-lint/SKILL.md`。

Codex 通过 `AGENTS.md` / `CLAUDE.md` 的短指针发现该 project skill。为避免 `AGENTS.md` 超过 150 行，入口只保留一行导航，不复制规则正文。

### D3 · 采访式生成

用户触发 custom lint 时，skill 不要求用户直接写 YAML。Agent 通过结构化问题收集规则：

- 这条规则来自哪次错误？
- 规则类型是什么：路径/diff、正则扫描、清单同步、AST/ESLint？
- 检查全量现状还是本次变更？
- 是否 grandfather 历史存量？
- rename/copy 是否按新增处理？
- 拒绝信号是什么？
- 修复方式是什么？
- 是否接入 pre-commit、CI，是否 blocking？
- 是否需要同步质量文档或索引？

涉及决策时继续使用 MultiSoul 的 `msctl ask-question` 问题卡，不在纯文本里让用户输入选项。

### D4 · 一条规则一个脚本

生成资产遵循当前仓库风格：

```text
scripts/check-<rule-name>.sh
scripts/check-<rule-name>.py
scripts/check-<rule-name>.mjs
```

选择依据：

- 和现有 `scripts/check-*.sh|py` 一致。
- 每条规则可以单独运行、禁用或删除。
- CI 和 pre-commit 接入点清楚。

不采用集中 runner，因为 v1 的规则类型跨度较大，集中抽象会过早固化接口。

### D5 · CI 语义 lint 只读 PR 变更文件

CI blocking 输入限定为 PR diff 和仓库文件，不读取运行时会话。

推荐接口：

```bash
bash scripts/check-<rule>.sh --staged
bash scripts/check-<rule>.sh --base origin/main
```

这样语义 lint 可以阻塞 CI，但仍然可复现。AskQuestion 这类需要 transcript 才能准确判断的协作规则，不适合 v1 blocking CI；可以先作为文档约束或后续非阻塞报告。

### D6 · 启发式优先，不默认调用 LLM

v1 的“语义”主要指仓库约定层面的判断，例如：

- 新增文件是否落在错误权威目录。
- 某类 schema 改动是否伴随 migration。
- 清单是否和磁盘文件保持双射。

这些应优先用路径、diff、JSON、AST 或 ESLint 表达。LLM 判断留给后续“启发式无法表达”的场景，并且在进入 blocking CI 前必须先积累误报数据。

## v1 规则模板

### 路径 / diff 规则

输入：`git diff --name-status`。

适用：

- 禁止新增文件到旧目录。
- 特定路径改动必须伴随另一类文件。
- rename/copy 的目标路径按新增处理。

### 正则扫描规则

输入：候选文件内容。

适用：

- token 泄漏。
- 禁止 suppression 指令。
- 禁止特定字符串或导入模式。

### 清单同步规则

输入：磁盘文件 + manifest JSON。

适用：

- `docs/*/index.json` 与目录文件双射。
- skill adapter 是否存在并指向真源。

### AST / ESLint 规则

输入：TypeScript/JavaScript AST 或 ESLint config。

适用：

- import 边界。
- React / TypeScript 语义约束。
- 需要解析代码结构而非 grep 的检查。

## 自动接入范围

Skill 允许自动修改标准门禁文件：

- `scripts/check-*.sh|py|mjs`
- `.husky/pre-commit`
- `.github/workflows/ci.yml`
- `docs/quality/mechanized-constraints.md`
- 相关 manifest，如 `docs/design-docs/index.json`

其他文件需要在采访结果中明确列为规则本身的目标，不能顺手改。

## Dogfood Dry-run：权威文档路径门禁

本轮用 `canonical-doc-paths` 做 dry-run，不落文件。

规则：

- 新增权威产品规格必须在 `docs/product-specs/`。
- 新增设计文档必须在 `docs/design-docs/`。
- 新增执行计划必须在 `docs/exec-plans/`。
- 禁止新增到 `docs/specs/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`。

关键边界：

- 只拦新增、复制、重命名后的目标路径。
- 保留历史 `docs/superpowers/**` 存量，不做全量扫描失败。
- 修改历史文件不因路径本身失败。
- rename/copy 到旧目录按新增处理。

脚本草案：

```bash
git diff --cached --name-status --diff-filter=ACR
git diff --name-status --diff-filter=ACR "$base"...HEAD
```

Fail 样例：

```text
A  docs/specs/custom-lint.md
A  docs/superpowers/specs/custom-lint.md
A  docs/superpowers/plans/custom-lint.md
R  docs/product-specs/SPEC-old.md -> docs/specs/SPEC-old.md
```

Pass 样例：

```text
A  docs/product-specs/2026-06-07-SPEC-custom-lint.md
A  docs/design-docs/2026-06-07-custom-lint-design.md
M  docs/superpowers/plans/legacy-plan.md
```

Dry-run 暴露出一个独立问题：`AGENTS.md`、`CLAUDE.md` 和若干 README 指向 `docs/superpowers/README.md`，但当前工作区没有该文件。这属于“导航链接存在性”规则，不应和 `canonical-doc-paths` 混在同一个脚本里；可作为后续清单同步规则单独实现。

## 生成流程

1. 读取仓库约束与现有 lint 风格。
2. 用问题卡采访规则字段。
3. 选择模板：path/diff、regex、manifest、AST/ESLint。
4. 生成检查脚本。
5. 生成 pass/fail fixture 或 dry-run 样例。
6. 接入 `.husky/pre-commit`。
7. 接入 `.github/workflows/ci.yml`。
8. 更新 `docs/quality/mechanized-constraints.md`。
9. 运行脚本正反样例和仓库现有检查。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 语义 lint 误报阻塞 PR | v1 只允许可复现 PR diff 输入，启发式优先 |
| 自动接入改坏 CI | 限定标准门禁文件，接入后必须运行对应 check |
| 三端 skill 内容漂移 | `.agents/skills` 为真源，Claude 尽量 symlink，Cursor 只保留 wrapper |
| 历史存量导致一启用就失败 | 采访必须询问历史存量策略，默认只拦新增 |
| 规则变成不可删除平台 | 一条规则一个脚本，不引入强耦合 runner |

## 待定

- Cursor `.mdc` wrapper 的具体 frontmatter。
- `.claude/skills` symlink 在目标环境中的兼容性验证。
- `scripts/check-agent-skill-adapters.py` 已校验三端入口；后续可扩展到更多 project skills。
- 第一条实际落地的 dogfood 规则是否采用 `canonical-doc-paths`。
