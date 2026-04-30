# `design-docs/` — 单 feature 设计文档

回答 **"为什么这么实现"**。

## 内容范围

- 某 feature 的方案权衡（A vs B，为什么选 A）
- 数据结构、状态机、关键算法
- 与既有系统的边界、契约
- 不写步骤化施工（那是 `../exec-plans/` 的事）

## 命名约定

- `YYYY-MM-DD-<kebab-case-feature>-design.md`
- 日期是文档创建/定稿日期，不是 feature 上线日期

## 与 `exec-plans/` 的区别

| 维度 | `design-docs/` | `exec-plans/` |
|------|----------------|---------------|
| 关注点 | "为什么这样做" | "下一步做什么" |
| 时效 | 长期参考 | 完成即可归档 |
| 粒度 | 方案级 | 任务级 |

## 现有文档

按时间倒序：

- `2026-04-29-codex-runtime-integration-design.md` — Codex runtime 集成方案
- `2026-04-28-inbox-delete-design.md` — Inbox 删除交互设计
- `2026-04-27-askquestion-sync-design.md` — AskQuestion 同步协议设计
- `2026-04-26-chat-waiting-typewriter-design.md` — Chat 等待态打字机效果设计
