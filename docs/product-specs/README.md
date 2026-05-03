# `product-specs/` — 产品规格

回答 **"要做什么、为什么做"**。

## 内容范围

- 产品总规格（整个 MultiSoul 的目标、范围、模块划分）
- 单 feature 的产品规格（用户场景、验收标准、非目标）
- 不包含具体技术方案（那是 `../design-docs/` 的事）

## 命名约定

- 总规格：`SPEC.md`
- 单 feature：`SPEC-<kebab-case-feature>.md`，例如 `SPEC-list-refresh.md`
- **目录清单（机器可读）**：[`index.json`](index.json) + [`index.schema.json`](index.schema.json) —— 新增/重命名规格文件后必须更新 `index.json`；[`scripts/check-docs-indices.py`](../../scripts/check-docs-indices.py) 与 CI 会校验磁盘与清单双射（注册见 [`scripts/docs-indices.json`](../../scripts/docs-indices.json)）

**Superpowers**（如 `writing-plans`）产出的「规格 / PRD / 要做什么」**必须**写入本目录上述命名，**不得**默认写入 `docs/specs/` 或 `docs/superpowers/specs/`。规约总述：[`../superpowers/README.md`](../superpowers/README.md)。

## 现有文档

人类可读标题与文件名对照见 [`index.json`](index.json) 的 `documents` 数组（按文件名升序）。**不要**在本节维护重复表格，以免与磁盘漂移。
