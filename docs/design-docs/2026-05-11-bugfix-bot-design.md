# bugfix-bot 技术设计

> 回答"为什么这么实现"。产品规格见 [`docs/product-specs/SPEC-bugfix-bot.md`](../product-specs/SPEC-bugfix-bot.md)。

---

## 1. 定位与边界

bugfix-bot 是一个**独立 Rust 二进制**，以 msctl plugin agent 身份运行。它不是 msctl 的一部分，也不加入 msctl 的 Cargo workspace。

**它做什么：**
- 接收飞书缺陷事件 → 执行 TDD 修复 pipeline → 开 Draft MR → 通知工程师
- 接收 GitLab MR 事件 → CI 失败回流重试 / MR 合并后清理 worktree

**它不做什么：**
- 不合并 MR（人工操作）
- 不管理 msctl 的 agents/conversations 表（有自己的 DB）
- 不通过 msctl HTTP API 调度 Claude（直接 subprocess 调用 claude CLI）

---

## 2. 为什么选择独立二进制 + plugin 协议

**备选方案：**
- A. 加入 msctl Cargo workspace，共享 lib crate
- B. 独立目录，独立 Cargo 项目（**选择此方案**）
- C. 通过 msctl HTTP API 通信，不直接操作 DB

**选 B 的理由：**
- msctl 当前是 bin-only crate，没有 lib 可共享；加入 workspace 需要先重构 msctl，引入不必要的耦合
- plugin 协议（stdin/stdout NDJSON）已经是 msctl 定义的扩展点，bugfix-bot 完全符合这个模型
- 独立目录意味着独立的 `cargo build`、独立的测试、独立的发布节奏
- 未来可以打包为 `.tar.gz` 通过 `msctl agent install <url>` 安装，符合 plugin 生态设计

**为什么不通过 msctl HTTP API 调度 Claude：**
- msctl 的 `send_to_session` 是进程内 API，外部无法直接调用
- 通过 HTTP API 创建 conversation 可行，但 bugfix-bot 的修复流程需要精确控制 Claude 的 prompt 和输出解析，直接 subprocess 调用 `claude --print --output-format stream-json` 更可控
- 减少对 msctl 服务状态的依赖（bugfix-bot 启动时 msctl 可能还没完全就绪）

---

## 3. 仓库结构

```
bugfix-bot/
├── Cargo.toml
├── bugfix-bot.toml          # plugin manifest，安装时复制到 ~/.config/msctl/agents/
└── src/
    ├── main.rs               # stdin 读取循环，分发 TaskMessage
    ├── config.rs             # ~/.config/msctl/bugfix-bot.toml 读写
    ├── db.rs                 # bugfix-bot.db，BugTask 表
    ├── claude.rs             # subprocess 调用 claude CLI，解析 stream-json 输出
    ├── gitlab.rs             # GitLab API client
    ├── feishu.rs             # 飞书 API client（发消息、评论缺陷）
    ├── worktree.rs           # git worktree 创建/清理
    └── pipeline/
        ├── mod.rs            # Pipeline 入口，串联各阶段
        ├── intake.rs         # 阶段1: 信息评估 + GitLab Issue 同步
        ├── reproducer.rs     # 阶段2: 复现测试（找到或新增失败测试）
        ├── patch.rs          # 阶段3: Fault Localize + Patch Generator
        ├── verifier.rs       # 阶段4: 分层验证（目标测试→模块测试→静态检查）
        └── publisher.rs      # 阶段5: Draft MR + 飞书通知
```

单文件 ≤ 500 行约束同样适用于 `bugfix-bot/src`。

---

## 4. Plugin Manifest

```toml
# bugfix-bot.toml（安装到 ~/.config/msctl/agents/bugfix-bot.toml）
[agent]
version = "0.1.0"
executable = "bugfix-bot"

[[triggers]]
event = "feishu.issue.updated"

[[triggers]]
event = "gitlab.merge_request_hook"
```

注册命令：
```bash
msctl agent install ./bugfix-bot.tar.gz
msctl agent register --type plugin --name bugfix-bot
```

---

## 5. 主循环设计

```
stdin (line-by-line NDJSON)
  │
  ▼
TaskMessage { event, payload, task_id, conversation_id }
  │
  ├─ "feishu.issue.updated"      → pipeline::run(ctx)
  └─ "gitlab.merge_request_hook" → handle_mr_event(ctx)
       ├─ action = "merge"        → cleanup_worktree + mark_done
       └─ action = "close"        → cleanup_worktree + mark_cancelled
       └─ CI failure event        → retry_pipeline(ctx)

stdout (line-by-line NDJSON)
  AgentEvent::Progress { task_id, conversation_id, message }
  AgentEvent::Result   { task_id, conversation_id, status, data, error }
  AgentEvent::Error    { task_id, conversation_id, code, message }
```

主循环是同步的（`std::io::stdin().lock().lines()`），每个 TaskMessage 在独立 `tokio::task::spawn_blocking` 中执行，允许多 bug 并行处理。

---

## 6. Claude 调用设计

bugfix-bot 直接 subprocess 调用 `claude` CLI：

```bash
claude --print --output-format stream-json -p "<prompt>" <project_path>
```

每个 pipeline 阶段构造专用 prompt，调用 claude，解析 `stream-json` 输出提取 `result` 类型的行。

**为什么用 `--print` 而不是交互模式：**
- 每个阶段是一次独立的 Claude 调用，prompt 包含完整上下文
- 不需要维护长对话状态（阶段间状态由 BugTask 持久化）
- 输出可预测，便于解析

**Claude session 复用：**
- Reproducer/Patch/Verifier 阶段在同一 worktree 内，可通过 `--resume <session_id>` 复用 session，减少重复上下文
- Intake 阶段（信息评估）使用一次性调用，不复用 session

---

## 7. 数据模型

### BugTask（bugfix-bot.db）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID 主键 |
| feishu_issue_id | TEXT | 飞书缺陷 ID，唯一索引（幂等去重） |
| gitlab_issue_id | INTEGER | 同步后的 GitLab Issue ID（可空） |
| gitlab_mr_id | INTEGER | Draft MR ID（可空） |
| worktree_path | TEXT | git worktree 路径（可空） |
| branch_name | TEXT | fix/bug-\<feishu_issue_id\>（可空） |
| status | TEXT | 见状态机 §8 |
| pipeline_stage | TEXT | 当前所在阶段（intake/reproducer/patch/verifier/publisher） |
| retry_count | INTEGER | 重试次数，默认 0 |
| claude_session_id | TEXT | 当前 claude session ID（可空，用于 --resume） |
| created_at | INTEGER | Unix ms |
| updated_at | INTEGER | Unix ms |

### 配置（bugfix-bot.toml）

```toml
[feishu]
webhook_token = ""      # 验签 token（从 msctl 传入的 payload 已验签，此处备用）
bot_app_id = ""
bot_app_secret = ""

[gitlab]
base_url = "https://gitlab.example.com"
access_token = ""
blocked_label = "bot:blocked"

[module_repo_map]
"用户中心" = { local_path = "~/repos/user-service" }
"订单系统" = { local_path = "~/repos/order-service" }
```

---

## 8. 状态机

```
待评估
  │ 信息充足
  ▼
分析中（intake 完成，reproducer 开始）
  │ 复现成功
  ▼
修复中（patch + verifier 循环）
  │ 验证通过
  ▼
待 Review（Draft MR 已开）
  │ MR 合并
  ▼
已完成

任意阶段 → 信息不足（阻塞）  [飞书评论 @负责人]
任意阶段 → 修复失败（阻塞）  [retry_count >= 5]
待 Review → CI 阻塞          [CI 失败且不可自动修复]
```

状态转换必须原子写入 DB（`UPDATE bug_tasks SET status=?, updated_at=? WHERE id=?`），不允许内存状态与 DB 不一致。

---

## 9. 幂等性设计

飞书缺陷可能多次触发 `feishu.issue.updated`（状态变更、评论更新等）。

**去重策略：**
1. 按 `feishu_issue_id` 查找已有 BugTask
2. 若不存在 → 创建，状态 = 待评估
3. 若已存在：
   - 状态 = 信息不足（阻塞）→ 重新评估（用户可能补充了信息）
   - 状态 = 已完成 / 修复失败（阻塞）→ 忽略，记录日志
   - 状态 = 分析中 / 修复中 / 待 Review → 忽略，记录日志（正在处理中）

---

## 10. 错误处理与重试

**重试计数（retry_count）覆盖：**
- Patch 生成后验证失败 → retry_count + 1
- CI 失败回流且可自动修复 → retry_count + 1
- 上限 5 次，超限 → 状态 = 修复失败（阻塞）

**不计入重试的失败：**
- 信息不足（等待用户补充，不消耗重试次数）
- 无法复现（独立阻塞状态，不消耗重试次数）
- GitLab API / 飞书 API 网络错误（记录日志，不改变 BugTask 状态，等待下次触发）

**Claude 调用失败：**
- 非零退出码 → 记录 stderr，计入重试
- 输出解析失败 → 记录原始输出，计入重试

---

## 11. 安全约束

- GitLab access token 和飞书 app secret 存储于 `~/.config/msctl/bugfix-bot.toml`，不硬编码，不写入 DB
- bugfix-bot 进程以当前用户权限运行，git worktree 操作限于 `module_repo_map` 配置的路径
- 飞书 Webhook 验签已由 msctl 完成（`/webhook/feishu` 路由），bugfix-bot 收到的 payload 已通过验签
- GitLab Webhook 验签同上

---

## 12. 与 msctl 的边界

| 职责 | msctl | bugfix-bot |
|------|-------|-------------|
| Webhook 接收与验签 | ✓ | — |
| Plugin 进程生命周期管理 | ✓ | — |
| TaskMessage 路由 | ✓ | — |
| BugTask 持久化 | — | ✓ |
| Claude Code 调度 | — | ✓（直接 subprocess） |
| GitLab API 调用 | — | ✓ |
| 飞书 API 调用 | — | ✓ |
| git worktree 管理 | — | ✓ |

bugfix-bot 不读写 msctl 的 `serve.db`，不调用 msctl 的内部 API。两者唯一的通信通道是 stdin/stdout NDJSON。
