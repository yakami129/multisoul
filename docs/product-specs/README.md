# `product-specs/` — 产品规格

回答 **"要做什么、为什么做"**。

## 内容范围

- 产品总规格（整个 MultiSoul 的目标、范围、模块划分）
- 单 feature 的产品规格（用户场景、验收标准、非目标）
- 不包含具体技术方案（那是 `../design-docs/` 的事）

## 命名约定

- 总规格：`SPEC.md`
- 单 feature：`SPEC-<kebab-case-feature>.md`，例如 `SPEC-list-refresh.md`

**Superpowers**（如 `writing-plans`）产出的「规格 / PRD / 要做什么」**必须**写入本目录上述命名，**不得**默认写入 `docs/specs/` 或 `docs/superpowers/specs/`。规约总述：[`../superpowers/README.md`](../superpowers/README.md)。

## 现有文档

| 文件 | 说明 |
|------|------|
| [`SPEC.md`](./SPEC.md) | MultiSoul 主产品规格 |
| [`SPEC-list-refresh.md`](./SPEC-list-refresh.md) | 列表刷新行为规格 |
| [`SPEC-task-notification.md`](./SPEC-task-notification.md) | Agent 任务完成通知规格 |
| [`SPEC-github-actions-cicd.md`](./SPEC-github-actions-cicd.md) | GitHub Actions CI/CD 规格（自 `docs/specs/github-actions-cicd-spec.md` 迁入） |
