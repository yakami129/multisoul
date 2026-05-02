# `docs/` — MultiSoul 文档索引

本目录是 MultiSoul 的结构化知识库，遵循 Harness Engineering "AGENTS.md as map, not encyclopedia" 模式。

入口在仓库根目录的 [`AGENTS.md`](../AGENTS.md)（约 100 行的导航地图）。本 `docs/` 提供按需深入的细节内容。

## 子目录速查

| 目录 | 用途 | 何时来这里 |
|------|------|------------|
| [`product-specs/`](./product-specs/) | 产品规格（要做什么、为什么做） | 想知道某个功能的目标、用户场景、验收标准 |
| [`design-docs/`](./design-docs/) | 单 feature 设计文档（怎么设计的） | 想知道某次实现的方案权衡、数据结构、状态机 |
| [`exec-plans/`](./exec-plans/) | 执行计划（怎么落地的） | 想复盘历史步骤、或追溯某 feature 的实施顺序 |
| [`references/`](./references/) | API/协议/环境变量等机器可读契约 | 想查 REST/WS 路径、消息类型、env vars |
| [`quality/`](./quality/) | 规则、检查清单、code conventions（"法律"层） | 改动前要查的硬约束、UI/code 规范、release checklist |
| [`runbooks/`](./runbooks/) | 操作型 SOP（发布、调试、应急） | 要发版本、排查线上问题、操作运行时 |
| [`specs/`](./specs/) · [`superpowers/`](./superpowers/) | **遗留目录，非权威树** | 见 [`superpowers/README.md`](./superpowers/README.md)；新规格/计划勿写入 |

## 不在这里的

| 内容 | 实际位置 |
|------|---------|
| Mobile UI 设计系统 | [`mobile/docs/design.md`](../mobile/docs/design.md)（co-located，与代码就近） |
| Mobile UI 常见坑 | [`mobile/docs/rules/ui-pitfalls.md`](../mobile/docs/rules/ui-pitfalls.md) |
| iOS 发布流程 | [`mobile/docs/ios-publish.md`](../mobile/docs/ios-publish.md) |
| 系统架构总览 | [`ARCHITECTURE.md`](../ARCHITECTURE.md)（仓库根） |
| 面向人类的快速上手 | [`README.md`](../README.md)（仓库根） |
| Agent 入口与导航 | [`AGENTS.md`](../AGENTS.md)（仓库根） |

## 添加新文档时

- **产品决策 / 验收标准 / 功能规格** → `product-specs/SPEC-<feature>.md`（**不要**写到 `specs/` 或 `superpowers/`）
- **某次实现的方案权衡** → `design-docs/YYYY-MM-DD-<feature>-design.md`
- **多步骤施工计划** → `exec-plans/YYYY-MM-DD-<feature>.md`（**不要**写到 `superpowers/plans/` 作为权威落点）
- **Superpowers skills**（`writing-plans`、`executing-plans`、`brainstorming` 等）在本仓库落盘时**必须**遵守以上三行路径
- **稳定的契约/枚举** → `references/<topic>.md`
- **新增硬约束/check** → `quality/<topic>.md`
- **新发布或运维流程** → `runbooks/<topic>.md`
