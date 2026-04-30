# `quality/` — 规则与检查清单（"法律"层）

回答 **"哪些事必须做 / 必须不做"**。

## 内容范围

- Code conventions（命名、目录结构、依赖方向）
- UI/UX 硬约束（颜色、字号、圆角、间距网格）
- Release checklist（发版前必跑哪些 check）
- 安全约束（不可硬编码 token、不可碰 `~/.config/msctl/*`）
- Hooks/Lint 规则的人类可读说明（实现见 `.husky/`、`.github/workflows/`）

## 与 `references/` 的区别

| 维度 | `references/` | `quality/` |
|------|---------------|------------|
| 性质 | 描述"是什么" | 规定"必须怎样" |
| 例子 | "REST API 列表" | "新接口必须返回 JSON、必须带 X-Request-Id" |

## 现有规则

- [`mechanized-constraints.md`](./mechanized-constraints.md) — **已机械化**的 6 条约束（脚本 + ESLint + CI 强制）

## 仍以人类可读形式存在的规则

- [`../../CLAUDE.md`](../../CLAUDE.md) — 工程手册：命令、env vars、UI 设计系统摘要
- [`../../mobile/docs/design.md`](../../mobile/docs/design.md) — Vault-Tec PIP-BOY 视觉规范（颜色白名单的 source of truth）
- [`../../mobile/docs/rules/ui-pitfalls.md`](../../mobile/docs/rules/ui-pitfalls.md) — RN UI 常见坑

## 持续工作

每发现一次 Agent / 人类的犯错 → 沉淀到 `mechanized-constraints.md` 的"加新规则的流程"。Harness 第二支柱的本质：**让正确行为自然发生，不依赖记忆力和自觉性**。

## 命名约定

- `<topic>.md`，例如：`mechanized-constraints.md`、`release-checklist.md`、`secret-handling.md`
