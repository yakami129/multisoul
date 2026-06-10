# Spec Idea 同步修复 SPEC

## 1. 背景与目标

在 **CLI `serve.db` 为 Idea 权威** 的前提下，修复移动端归档/删除后数据复活、离线队列未生效等问题。

设计依据：[`docs/design-docs/2026-06-09-spec-idea-cli-authority-design.md`](../design-docs/2026-06-09-spec-idea-cli-authority-design.md)。

## 2. 范围

### In Scope

- Mobile `flushPendingIdeas`：按 `pending_mutation` 重放 create/update/archive/delete。
- 归档、删除、开始采访前强制 flush 该 idea（或 endpoint 级队列）。
- 删除流程：CLI 未归档时先 PATCH archive，再 DELETE。
- `replaceIdeasForEndpoint` 改为合并策略，尊重 `pending_mutation` 与 delete tombstone。
- 同步失败写入 `last_sync_error`，禁止静默 `catch {}` 吞掉归档/删除错误（可 best-effort 重试，但须记录）。
- CLI / REST / `msctl spec idea` 形状不变；save-spec 仍在 CLI 更新 idea → `converted`。

### Out of Scope

- Idea 权威迁到 iOS。
- 多手机并发冲突 UI（除 `last_sync_error` 提示外）。
- Idea 详情页 Delete 按钮（仍仅 Archived 区）。

## 3. 验收标准

1. 用户归档 Idea 后，CLI `spec_ideas.status` 为 `archived`（联网条件下 5s 内）。
2. 用户删除已归档 Idea 后，CLI 无该 id；重装 App 并 refresh 后仍不出现。
3. 离线归档 → 联网后 CLI 为 archived；再删除成功。
4. 离线删除已归档 Idea → 联网后 CLI 删除成功；期间 UI 不展示该行。
5. 开始采访前，未同步的 create/update 必须先到达 CLI，否则采访 prompt 与手机展示一致。
6. `save-spec` 后 CLI 将 source idea 标为 `converted`；iOS refresh 后一致。
7. CLI DELETE 对非 archived 返回 409；Mobile 不得向非 archived 展示 Delete。

## 4. E2E 功能测试用例

### E2E-1 在线归档后删除不复活

| 项 | 内容 |
|----|------|
| 关联验收 | §3.1–3.2 |
| 场景 | 归档并删除后等待 refresh |
| 前置 | endpoint 在线；idea status=open |
| 步骤 | Archive → 等待 flush → 展开 Archived → Delete 确认 → 等待 refresh |
| 预期 | UI 无该 idea；`GET /api/v1/spec-ideas` 无该 id |
| 层级 | Mobile + REST |
| 自动化 | mock DELETE 成功；断言 `replaceIdeasForEndpoint` 后 store 无 id |

### E2E-2 未同步归档导致 DELETE 409 的回归

| 项 | 内容 |
|----|------|
| 关联验收 | §3.2 |
| 场景 | 修复前：本地 archived、CLI open，DELETE 失败复活 |
| 前置 | PATCH archive 未执行 |
| 步骤 | 本地 archive → delete |
| 预期 | flush 先 PATCH archive，再 DELETE 成功；无复活 |
| 层级 | Mobile |
| 自动化 | jest：mock PATCH 后 DELETE；断言调用顺序 |

### E2E-3 离线删除 tombstone

| 项 | 内容 |
|----|------|
| 关联验收 | §3.4 |
| 场景 | 断网删除 archived idea |
| 前置 | idea 已在 CLI archived；网络 offline |
| 步骤 | Delete → 恢复网络 |
| 预期 | 离线 UI 已隐藏；联网后 CLI DELETE；refresh 仍无 |
| 层级 | Mobile |
| 自动化 | 单元：tombstone 行 `pending_mutation=delete` 不出现在列表 mapper |

### E2E-4 save-spec converted 由 CLI 维护

| 项 | 内容 |
|----|------|
| 关联验收 | §3.6 |
| 场景 | 采访后 agent save-spec |
| 前置 | idea interviewing，conversation_id 已关联 |
| 步骤 | `POST save-from-path` → mobile `refreshAssets` |
| 预期 | CLI idea `converted` + `converted_spec_id`；iOS 一致 |
| 层级 | CLI + Mobile |
| 自动化 | cli integration test 已有；mobile merge 测试 |

### E2E-5 采访前 flush create

| 项 | 内容 |
|----|------|
| 关联验收 | §3.5 |
| 场景 | 离线新建 idea 后立刻开始采访 |
| 前置 | pending create |
| 步骤 | Start interview |
| 预期 | POST create 先于 interview；CLI prompt 含最新 body |
| 层级 | Mobile + REST |
| 自动化 | mock 调用顺序断言 |
