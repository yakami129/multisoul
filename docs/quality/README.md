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

## 现状

本目录暂为占位。当前规则仍散落在：

- [`../../CLAUDE.md`](../../CLAUDE.md) — UI 设计系统、env vars
- [`../../mobile/docs/design.md`](../../mobile/docs/design.md) — Vault-Tec PIP-BOY 视觉规范
- [`../../mobile/docs/rules/ui-pitfalls.md`](../../mobile/docs/rules/ui-pitfalls.md) — RN UI 常见坑
- `.husky/`、`.github/workflows/` — 自动化 enforcement

未来工作（Harness 第二支柱"机械化约束"）：把这些约束沉淀为 lint 规则 + CI check，本目录写人类可读的 spec。

## 命名约定

- `<topic>.md`，例如：`code-conventions.md`、`release-checklist.md`、`secret-handling.md`
