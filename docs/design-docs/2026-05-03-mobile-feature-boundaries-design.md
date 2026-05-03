# Mobile Feature Boundaries Design

## 1. 背景与目标

MultiSoul mobile 采用 `features/{agents,chat,inbox,settings}` 按业务域组织代码。第一阶段已经通过 ESLint 禁止 feature 内部跨域深路径 import，目标是减少隐藏依赖、重复实现和 Agent 误用内部文件。

本设计文档沉淀该边界的原则、当前规则、非目标与后续实施方向，作为下一阶段 PR 与 code review 的依据。

## 2. 核心原则

跨边界才需要 public API；同边界内部保持直接、简单。

- 同一 feature 内部可以直接使用本 feature 的 `components/services/utils/hooks`。
- 一个 feature 需要复用另一个 feature 能力时，只能通过对方 public entry（如 `@/features/chat`）。
- public entry 只导出真实跨 feature 使用的能力，不作为全量 re-export。
- 新增 public export 时，需要能说明调用方是谁、为什么这是正式能力。

## 3. 当前边界

当前 feature 内部依赖图：

```text
features/inbox -> features/chat public API
```

当前 `chat` public API 暴露：

- `AskQuestionCard`
- `MultiAskQuestionCard`

原因：Inbox 需要复用 Chat 的 AskQuestion UI，但不应依赖 `chat/components/...` 的内部文件结构。

## 4. 机械化规则

由 `mobile/eslint.config.mjs` 的 `no-restricted-imports` 强制。

禁止：

```ts
import X from '@/features/chat/components/X';
import { y } from '@/features/chat/services/y';
```

允许：

```ts
import { AskQuestionCard } from '@/features/chat';
```

规则适用范围：

```text
mobile/src/features/{agents,chat,inbox,settings}/**/*.{ts,tsx}
```

## 5. 非目标

本阶段不做：

- 不要求 `app/` 全部只能走 public API。
- 不把 feature 内部文件全量从 `index.ts` 导出。
- 不收紧 `store/`、`hooks/`、`services/` 等跨 feature 编排层。
- 不处理 CLI routes/state/db 边界。
- 不引入 dependency-cruiser 等新工具。

## 6. 为什么不是过度封装

错误方向是“所有 import 都必须经过 `index.ts`”。本设计避免这个方向。

合理边界是：

```text
app/chat/[id].tsx -> features/chat/components/...    OK
features/inbox -> features/chat/components/...       不 OK
features/inbox -> features/chat                     OK
```

即：同 feature 页面或模块可以直接使用本域内部，跨 feature 才需要 public API。

## 7. 对 Agent 的收益

Agent 搜索代码时容易直接引用搜到的深层文件。Lint 护栏会把它拉回 feature public API：

1. Agent 尝试从 `features/inbox` import `features/chat/components/...`。
2. `pnpm lint` 报错。
3. Agent 改为使用 `@/features/chat`。
4. 如果 public API 不够，需要显式新增 export。
5. Reviewer 能看到该 feature 新增了一个正式跨域能力。

这减少了“短期能跑、长期把内部结构泄漏出去”的改动。

## 8. 验收标准

- `pnpm --dir mobile lint` 能阻止 feature 跨域深路径 import。
- `pnpm --dir mobile typecheck` 通过。
- `ARCHITECTURE.md` 与 `docs/quality/mechanized-constraints.md` 同步记录该边界。
- 新增 public export 时，PR 需说明跨 feature 使用者与理由。
- 当前 Inbox 复用 Chat AskQuestion UI 的例子仍能通过 public API 工作。

当前实施：

- `.github/pull_request_template.md` 已加入 Boundary review checklist，提醒新增或扩展 `mobile/src/features/*/index.ts` public export 时说明跨 feature 使用者与理由。

## 9. 后续方向

后续如需扩展，可另开 exec-plan 讨论：

- 是否定义 `app/` 路由归属表。
- 是否允许 `app/<feature>` 深入本 feature，但禁止跨其他 feature 深路径。
- 是否把 `hooks/` / `store/` 定义为显式 orchestration 层。
