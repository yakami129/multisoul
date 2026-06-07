# SPEC: mark-spec-done — 标记规格实施完成

**日期**: 2026-06-06
**状态**: draft
**作者**: AI Interview (Claude)

---

## 1. 背景与目标

`SpecArtifact` 已定义 `done` 状态，但目前没有任何入口可将规格标记为实施完成。Agent 完成实现后，spec 的状态停留在 `implementing` 或 `ready`，无法反映真实进度。

**目标**: 新增 `msctl mark-spec-done --spec-id <id>` CLI 命令，Agent 实施完成后调用，将对应 `SpecArtifact` 的状态更新为 `done`，并通过 `spec_changed` 事件实时推送到手机端。

设计参考: `msctl save-spec` 的 CLI → REST API → DB 模式。

---

## 2. 范围

### 2.1 在范围内

| 层 | 变更 |
|----|------|
| CLI (`cli/src/commands/`) | 新增 `mark_spec_done.rs`，实现 `msctl mark-spec-done` 命令 |
| REST API (`cli/src/serve/routes/`) | 新增 `POST /api/v1/specs/:id/done` 路由处理函数 |
| 路由注册 (`cli/src/serve/router.rs`) | 注册新路由，Bearer 鉴权 |
| DB | 只执行 `UPDATE spec_artifacts SET status='done', updated_at=? WHERE id=?`，无 schema 变更 |
| Mobile — 实时更新 | `spec_changed` 事件触发 `refreshAssets`，SpecDetailScreen 自动显示 done 状态 |

### 2.2 不在范围内

- 手机端手动「Mark as Done」按钮（保留 Agent-only 入口，后续可扩展）
- `done` 状态回退（暂不支持重新开工）
- 状态前置校验（任意状态均可转为 done）
- Mobile UI 新增视觉元素（现有 `done` 禁用逻辑已满足需求）

---

## 3. 主要流程

```
Agent 完成实施
    │
    ▼
msctl spec mark-done --spec-id <spec-uuid>
    │  (HTTP POST /api/v1/specs/<id>/done, Bearer auth)
    ▼
Server: 校验 spec 存在 → UPDATE status='done' → emit_spec_changed
    │
    ▼
Mobile: spec_changed 事件 → refreshAssets → SpecDetailScreen 更新
    └── 主按钮 disabled（已有 done 判断逻辑）
```

---

## 4. CLI 命令规格

### 命令签名

```bash
msctl spec mark-done \
  --spec-id <uuid>   \
  [--token <token>]  \
  [--port <port>]    \
  [--host <host>]
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--spec-id` | ✅ | 目标 `SpecArtifact` 的 UUID |
| `--token` | 否 | 覆盖本地保存的 Bearer token |
| `--port` | 否 | 覆盖本地保存的端口（默认 8765） |
| `--host` | 否 | 服务器 host（默认 `127.0.0.1`） |

### 输出（text 模式）

```
marked done: <spec_id> status=done
```

### 错误码

| HTTP | 含义 |
|------|------|
| 200 | 成功（含幂等：已是 done） |
| 404 | spec_id 不存在 |
| 401 | 未授权 |
| 500 | 内部错误 |

---

## 5. REST API 规格

### 端点

```
POST /api/v1/specs/:id/done
Authorization: Bearer <token>
```

### 请求体

无（spec_id 在路径中）。

### 响应体（200）

```json
{
  "spec_id": "<uuid>",
  "status": "done"
}
```

### 服务端行为

1. 验证 `spec_id` 存在于 `spec_artifacts` 表
2. `UPDATE spec_artifacts SET status = 'done', updated_at = <now_ms> WHERE id = ?`
3. 调用 `emit_spec_changed(state, spec_id, "")` 广播事件
4. 返回 `{ spec_id, status: "done" }`

---

## 6. 边界情况

| 情况 | 处理方式 |
|------|---------|
| spec 不存在 | 返回 404 |
| spec 已是 `done` | 幂等，返回 200 |
| spec 为其他状态 | 直接更新为 done，不校验前置状态 |
| 并发更新 | SQLite 串行锁，安全 |

---

## 7. Mobile UI 影响

`SpecDetailScreen` 已有逻辑（`SpecDetailScreen.tsx:103`）：

```tsx
const primaryDisabled =
  isStartingImplementation ||
  (!implementationChatId && ['blocked', 'done', 'failed'].includes(currentSpec.status));
```

当 spec 状态变为 `done` 后，主按钮自动禁用，状态 pill 显示「Done」。**无需修改 Mobile 代码**，只需 `spec_changed` 事件触发 `refreshAssets` 即可。

验证 `specUiModels.ts` 中 `specStatusLabel('done')` 有正确标签。

---

## 8. 验收标准

- [ ] `msctl spec mark-done --spec-id <uuid>` 成功调用后，`spec_artifacts` 表中对应行 `status = 'done'`
- [ ] 重复调用同一 spec_id 返回 200，状态保持 done（幂等）
- [ ] 不存在的 spec_id 返回 404
- [ ] 调用后手机端 SpecDetailScreen 在下次刷新时显示 done 状态，主按钮 disabled
- [ ] Bearer 鉴权不通过时返回 401
- [ ] 新增路由有对应的 Rust 单元测试

---

## 9. 实施参考

- CLI 模板: `cli/src/commands/save_spec.rs`
- 路由模板: `cli/src/serve/routes/specs.rs` (`save_from_path`)
- 事件广播: `emit_spec_changed` in `cli/src/serve/routes/activity_events.rs`
- 路由注册: `cli/src/serve/router.rs`
