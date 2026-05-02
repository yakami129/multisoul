# `docs/superpowers/` — 遗留路径（勿再作为权威落点）

本目录及 `docs/specs/` 下曾存放由 **Superpowers** 等插件工作流产出的规格/计划草稿，与仓库正式约定 **`docs/product-specs/`**、**`docs/exec-plans/`** 重复。`mobile/docs/superpowers/` 同理：新计划请落到仓库根侧 `docs/exec-plans/`（或 `docs/product-specs/`），勿在 `mobile/docs/superpowers/` 堆新的权威施工稿。

## 强制约定（含 Superpowers skills）

- **功能 / 产品规格**（要做什么、为什么做、验收）→ 只写入 [`../product-specs/`](../product-specs/)，命名见该目录 `README.md`（如 `SPEC-<feature>.md`）。
- **实施 / 执行计划**（步骤、checkpoint、依赖）→ 只写入 [`../exec-plans/`](../exec-plans/)，命名见该目录 `README.md`（如 `YYYY-MM-DD-<feature>.md`）。
- 使用 **`writing-plans`**、**`executing-plans`**、**`brainstorming`** 等 Superpowers skill 在本仓库落盘时，**必须**使用上述路径与命名，**不得**新建到 `docs/superpowers/` 或 `docs/specs/`。
- 方案权衡、接口形状 → 仍用 [`../design-docs/`](../design-docs/)（与 `AGENTS.md` 地图一致）。

## 已迁出（正文不再保留在本目录）

| 原路径 | 现位置 |
|--------|--------|
| `plans/2025-07-14-github-actions-cicd.md` | [`../exec-plans/2025-07-14-github-actions-cicd.md`](../exec-plans/2025-07-14-github-actions-cicd.md) |
| `plans/2026-04-30-task-notification.md` | [`../exec-plans/2026-04-30-task-notification.md`](../exec-plans/2026-04-30-task-notification.md) |
| `specs/2026-04-30-task-notification-design.md` | [`../design-docs/2026-04-30-task-notification-design.md`](../design-docs/2026-04-30-task-notification-design.md) |

`mobile/docs/superpowers/plans/` 下两份计划已迁至 [`../exec-plans/2026-04-19-mobile-ui-redesign.md`](../exec-plans/2026-04-19-mobile-ui-redesign.md) 与 [`../exec-plans/2026-04-19-mobile-code-structure-refactor.md`](../exec-plans/2026-04-19-mobile-code-structure-refactor.md)，见 [`mobile/docs/superpowers/README.md`](../mobile/docs/superpowers/README.md)。

## 存量文件

`plans/`、`specs/` 子目录已清空，仅保留本 README 作指针。新工作请在 canonical 位置新建并互链。
