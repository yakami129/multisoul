# `exec-plans/` — 执行计划

回答 **"怎么落地、做到哪了"**。

## 内容范围

- 某 feature 的步骤化施工计划（任务分解、依赖、checkpoint）
- 每一步的验收方式（跑哪个测试、看哪个日志）
- 完成后保留作为历史档案，便于复盘和追溯

## 命名约定

- `YYYY-MM-DD-<kebab-case-feature>.md`
- 日期是计划开始日期

## 与 `design-docs/` 的区别

设计先行，执行其后。一个 feature 通常先有 `design-docs/<X>-design.md` 拍板方案，再有 `exec-plans/<X>.md` 拆步骤施工。两者通过 feature 名互链。

## 现有文档

按时间倒序：

- `2026-04-29-codex-runtime-integration.md`
- `2026-04-28-inbox-delete.md`
- `2026-04-27-swipe-to-delete-recent.md`
- `2026-04-27-recent-conversation-preview.md`
- `2026-04-27-msctl-daemon.md`
- `2026-04-27-askquestion-sync.md`
- `2026-04-27-ask-question-multiselect.md`
- `2026-04-26-multisoul-runtime-longrunning.md`
- `2026-04-26-multisoul-phase2.md`
- `2026-04-26-mobile-refactor.md`
- `2026-04-26-cli-serve.md`
- `2026-04-26-chat-waiting-typewriter.md`
