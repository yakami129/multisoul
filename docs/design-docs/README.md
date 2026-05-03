# `design-docs/` — 单 feature 设计文档

回答 **"为什么这么实现"**。

## 内容范围

- 某 feature 的方案权衡（A vs B，为什么选 A）
- 数据结构、状态机、关键算法
- 与既有系统的边界、契约
- 不写步骤化施工（那是 `../exec-plans/` 的事）

若 **Superpowers** 产出的是方案权衡而非步骤清单，仍落在本目录（`-design.md`）；规格与计划分别见 [`../product-specs/`](../product-specs/)、[`../exec-plans/`](../exec-plans/) · [`../superpowers/README.md`](../superpowers/README.md)。

## 命名约定

- `YYYY-MM-DD-<kebab-case-feature>-design.md`（少数流程类可用 `-guide.md` 后缀）
- 日期是文档创建/定稿日期，不是 feature 上线日期
- **目录清单（机器可读）**：[`index.json`](index.json) + [`index.schema.json`](index.schema.json) —— 新增/重命名 `.md` 后必须更新 `index.json`；[`scripts/check-docs-indices.py`](../../scripts/check-docs-indices.py)（见 [`scripts/docs-indices.json`](../../scripts/docs-indices.json)）与 CI 会校验「磁盘上的 `*.md`（除 README）」与 `index.json` 一一对应

## 与 `exec-plans/` 的区别

| 维度 | `design-docs/` | `exec-plans/` |
|------|----------------|---------------|
| 关注点 | "为什么这样做" | "下一步做什么" |
| 时效 | 长期参考 | 完成即可归档 |
| 粒度 | 方案级 | 任务级 |

## 现有文档

人类可读标题与文件名对照见 [`index.json`](index.json) 的 `documents` 数组（按文件名降序，即新→旧）。**不要**在本节维护重复列表，以免与磁盘漂移。
