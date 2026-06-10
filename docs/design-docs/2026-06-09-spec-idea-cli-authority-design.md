# Spec Idea CLI 权威存储与同步设计

## 1. 背景

Ideas to Specs 重构后，Idea 与 Spec artifact 同时存在于：

- **CLI** `~/.config/msctl/serve.db`（`spec_ideas`、`spec_artifacts` 等）
- **iOS** expo-sqlite（`spec_ideas`、`spec_artifacts` 镜像表）

产品规格原定义为「CLI 持久化 + REST 权威读取 + 本地镜像」。用户在实际使用中出现：**归档后删除，数据仍会复活**；根因是移动端离线队列未落地、归档未同步、刷新覆盖与远端删除失败被静默吞掉。

经 2026-06-09 决策卡片确认：

| 维度 | 决策 |
|------|------|
| Idea 权威存储 | **CLI `serve.db`**（维持现状，不改为 iOS 唯一真相） |
| Spec / Idea 关联（save-spec → converted） | **CLI 维护**（`find_source_idea_id` + UPDATE `spec_ideas`） |
| 推进方式 | 先设计文档 + 规格补丁，再实施 |
| CLI API 形态 | REST 为协议契约；`msctl spec idea` 为 HTTP facade（见 §4） |

本文回答「为什么这么分层」以及「如何修掉当前同步缺陷」，不写施工步骤（见 [`docs/exec-plans/`](../exec-plans/)）。

## 2. 存储分层（定稿）

```text
┌─────────────────────────────────────────────────────────────┐
│ iOS (expo-sqlite)                                           │
│  • spec_ideas / spec_artifacts：缓存 + 离线草稿队列          │
│  • pending_mutation / last_sync_error / tombstone 删除标记   │
│  • 不宣称权威；冷启动与冲突以 CLI 为准                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST + WS (spec_changed)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ msctl serve (CLI)                                           │
│  • serve.db：Idea / Spec artifact / Conversation 权威        │
│  • repo 内 docs/product-specs/*.md：Spec 内容权威（文件）     │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 各资产权威源

| 资产 | 权威 | iOS 角色 |
|------|------|----------|
| `SpecIdea` | CLI `spec_ideas` (+ notes/attachments 子表) | 镜像；离线可编辑；联网后 flush 队列 |
| `SpecArtifact` | CLI `spec_artifacts` + repo `.md` | 镜像；`save-spec` 后 REST/WS 刷新 |
| `Conversation` / `Message` | CLI | Chat 模块按需拉取，非 Spec 镜像范围 |
| Inbox | iOS only | 已是手机本地，不变 |

### 2.2 为什么 Idea 留在 CLI

1. **采访与 save-spec 已在 CLI 闭环**：`start_interview` 从 `spec_ideas` 拼 prompt；`save_spec_from_path` 经 `interview_conversation_id` 反查 idea 并标记 `converted`。
2. **多入口一致**：手机 App、`msctl spec idea`、未来 Agent 脚本读同一库，避免 iOS 与 Mac 两份真相。
3. **与「零中心后端」一致**：数据仍在用户本机（Mac），手机是遥控端 + 离线缓存，不是第二套持久化中心。

### 2.3 iOS 仍需本地表的原因

- 离线创建/编辑 Idea（规格：「手机离线：Idea 本地草稿仍可编辑」）。
- 列表首屏不阻塞网络。
- `pending_mutation` 队列在断网时保留用户意图，恢复后推送到 CLI。

## 3. 当前缺陷与修复原则

### 3.1 缺陷对照

| 现象 | 根因 |
|------|------|
| 删除后复活 | 本地硬删 + CLI DELETE 409（未归档）失败被 `catch {}` 吞掉 → `refreshAssets` 从 CLI 拉回 |
| 归档不同步 | `archiveIdea` 只写本地 `pending_mutation: 'archive'`，未 flush 到 CLI |
| 队列无效 | `loadPendingIdeas` 存在但无后台 flush；删除未用 `pending_mutation: 'delete'` tombstone |
| 刷新覆盖 | `replaceIdeasForEndpoint` 用 CLI 列表覆盖 `pending_mutation IS NULL` 行，未考虑本地待删/待改 |

### 3.2 修复原则（Mobile）

1. **写操作必经队列**：`create` / `update` / `archive` / `delete` 均标记 `pending_mutation`，并记录 `updated_at`。
2. **主动 flush**：每次写后、App 前台、`spec_changed`、endpoint 恢复时调用 `flushPendingIdeas(endpoint)`。
3. **删除语义**：
   - 在线：先确保 CLI 侧 `status === 'archived'`（必要时先 PATCH archive），再 `DELETE`；成功后本地硬删。
   - 离线：本地 tombstone（`pending_mutation: 'delete'`，行保留至 CLI 确认）；UI 不展示 tombstone 行。
4. **刷新合并**（替代盲目 `DELETE ... pending_mutation IS NULL`）：
   - CLI 返回的 id 集合与本地合并；
   - 本地 `pending_mutation` 非空且 `updated_at` 新于服务端 → **保留本地**，不覆盖；
   - 本地 `pending_mutation === 'delete'` → 即使 CLI 仍有记录，继续重试 DELETE，且 UI 隐藏；
   - CLI 有、本地无、且无待删 → INSERT；
   - CLI 无、本地有待删且已确认 → 本地 DELETE。
5. **错误可见**：`last_sync_error` 写入 SQLite；Specs 列表可对失败行展示轻量提示（V1 可仅 detail/debug）。

### 3.3 修复原则（CLI）

- **不变**：`DELETE` 仅允许 `archived`；`save-spec` 继续 UPDATE idea → `converted`。
- **可选增强**（实施阶段评估）：`PATCH` 支持显式 `archived_at`；DELETE 幂等（已删返回 204）。

## 4. CLI API 怎么做合适（REST vs `msctl spec idea`）

沿用 [`2026-06-09-msctl-spec-cli-design.md`](2026-06-09-msctl-spec-cli-design.md) 的分层，**不新增第四套实现**：

```text
serve.db repository (Rust, 唯一写库路径)
        ▲
        │ 仅 axum handlers 调用
        │
 REST /api/v1/spec-ideas*  ←── Mobile axios
        ▲
        │ HTTP（同 host/port/token）
        │
 msctl spec idea *          ←── 终端 / Agent 脚本
```

| 层 | 职责 | 是否保留 |
|----|------|----------|
| `serve.db` + `cli/src/serve/spec/ideas.rs` | 权威持久化、采访上下文、save-spec 反查 | ✅ 保留 |
| `GET/POST/PATCH/DELETE /api/v1/spec-ideas` | Mobile 与协议契约；冷启动权威读 | ✅ 保留 |
| `POST .../interview` | 建 conversation + 读 idea 拼 instruction | ✅ 保留 |
| `msctl spec idea list/create/...` | 薄 HTTP 封装，**不直写 DB** | ✅ 保留（调试与自动化） |

**不采纳的方案：**

- ❌ 废弃 REST，仅留 `msctl`：Mobile 无法调用。
- ❌ `msctl spec idea` 直写 DB 绕过 REST：双写路径、事件广播不一致。
- ❌ Idea 改 iOS 权威：与 save-spec / interview 现有耦合冲突，需大改 CLI。

**`msctl spec idea` 与 Mobile 的分工：**

- Mobile：面向用户的 CRUD + 离线队列 + UI。
- `msctl spec idea`：运维/脚本/Agent 侧只读或批量操作；不替代 Mobile 离线体验。

## 5. 关键流程（定稿）

### 5.1 归档

```text
用户 Archive
  → iOS: status=archived, pending_mutation=archive, save local
  → flush: PATCH /api/v1/spec-ideas/:id { status, archived_at }
  → CLI: UPDATE spec_ideas, emit spec_changed
  → iOS: clear pending_mutation, merge refresh
```

### 5.2 删除（已归档）

```text
用户 Delete（archived）
  → iOS: 若 pending archive 未 flush，先 flush archive
  → DELETE /api/v1/spec-ideas/:id
  → CLI: 校验 archived → 级联删子表 → spec_changed
  → iOS: 硬删本地行（或清 tombstone）
```

### 5.3 开始采访

```text
用户 Start Interview
  → flush 该 idea 全部 pending（create/update/archive）
  → POST /api/v1/spec-ideas/:id/interview
  → CLI: 读 spec_ideas → 建 conversation → mark interviewing
  → iOS: 保存返回的 idea + conversation_id
```

### 5.4 save-spec → converted

```text
Agent: msctl spec save --path ... --conversation-id ...
  → CLI: save artifact; find_source_idea_id(conversation_id)
  → CLI: UPDATE spec_ideas SET converted, archived_at, converted_spec_id
  → WS: spec_changed
  → iOS: refresh specs + merge ideas（CLI 行覆盖本地，因无 pending）
```

## 6. 与既有文档的关系

| 文档 | 处理 |
|------|------|
| [`2026-06-06-SPEC-ideas-to-specs-refactor.md`](../product-specs/2026-06-06-SPEC-ideas-to-specs-refactor.md) | 权威分层表述不变；补充同步队列验收 |
| [`2026-06-06-SPEC-archived-idea-delete.md`](../product-specs/2026-06-06-SPEC-archived-idea-delete.md) | 离线删除 tombstone 与 flush 顺序以本设计为准 |
| [`2026-06-09-SPEC-spec-idea-sync-fix.md`](../product-specs/2026-06-09-SPEC-spec-idea-sync-fix.md) | 本设计的可验收规格补丁 |
| [`2026-06-09-msctl-spec-cli-design.md`](2026-06-09-msctl-spec-cli-design.md) | `msctl spec idea` 继续作为 REST facade，无变更 |

## 7. 非目标

- 不把 Idea 权威迁到 iOS。
- 不改动 Spec artifact 权威模型（repo + CLI snapshot）。
- 不在本阶段改 `msctl spec idea` 命令面形状。

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 多设备同时改同一 Idea | V1 仍以 endpoint 为单位；冲突时 `updated_at` + `last_sync_error` 提示用户 |
| flush 失败用户不知 | `last_sync_error` + 可选列表角标 |
| 历史本地脏数据 | 首次升级后全量 `refreshAssets` + 重放 pending |
