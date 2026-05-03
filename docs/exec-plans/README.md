# `exec-plans/` — 执行计划

回答 **"怎么落地、做到哪了"**。

## 内容范围

- 某 feature 的步骤化施工计划（任务分解、依赖、checkpoint）
- 每一步的验收方式（跑哪个测试、看哪个日志）
- 完成后保留作为历史档案，便于复盘和追溯

## 命名约定

- `YYYY-MM-DD-<kebab-case-feature>.md`
- 日期是计划开始日期
- **目录清单（机器可读）**：[`index.json`](index.json) + [`index.schema.json`](index.schema.json) —— 新增/重命名计划文件后必须更新 `index.json`；[`scripts/check-docs-indices.py`](../../scripts/check-docs-indices.py) 与 CI 会校验磁盘与清单双射（注册见 [`scripts/docs-indices.json`](../../scripts/docs-indices.json)）

**Superpowers**（如 `executing-plans`、`writing-plans` 中的施工拆解）产出的执行计划**必须**写入本目录上述命名，**不得**默认写入 `docs/superpowers/plans/` 作为权威落点。规约总述：[`../superpowers/README.md`](../superpowers/README.md)。

## 与 `design-docs/` 的区别

设计先行，执行其后。一个 feature 通常先有 `design-docs/<X>-design.md` 拍板方案，再有 `exec-plans/<X>.md` 拆步骤施工。两者通过 feature 名互链。

## 现有文档

人类可读标题与文件名对照见 [`index.json`](index.json) 的 `documents` 数组（按文件名降序，即新→旧）。**不要**在本节维护重复列表，以免与磁盘漂移。
