# Fix-Bug-Bot SPEC

## 1. 背景与目标

### 背景

团队使用飞书项目管理缺陷，GitLab 管理代码。低价值、重复性 bug 占用工程师大量精力，从缺陷发现到修复提交的链路长、响应慢，且不同工程师处理方式不一致。

### 业务目标

- 将低价值 bug 的修复从工程师手中解放出来，让 bot 先跑
- 打通「飞书缺陷 → 代码分析 → Draft MR」全链路自动化
- 工程师只在关键节点（Review、合并）介入，减少上下文切换

---

## 2. 范围

### 2.1 In Scope

- 飞书项目缺陷 Webhook 监听与触发
- 缺陷信息充分性 AI 评估
- 飞书缺陷 → GitLab Issue 同步（所有缺陷）
- Claude Code Agent 代码分析与定位
- 强制 TDD 修复循环（先写失败测试，再修代码）
- git worktree 隔离（每 bug 独立工作空间）
- Draft MR 自动创建（固定模板）
- 飞书 bot 通知（MR 就绪、阻塞告警）
- 重试机制（最多 5 次，超限降级为阻塞）
- 阻塞状态管理（GitLab Issue 阻塞 + 飞书通知）

### 2.2 Out of Scope

- MR 合并（人工操作）
- CI 运行（开 MR 后由 GitLab CI 自动触发）
- 人力资源调度与优先级排序
- 需求变更类 Issue 处理
- 多租户/多 GitLab 实例支持（MVP 阶段）

---

## 3. 用户与使用场景

### 典型用户角色

| 角色 | 描述 |
|------|------|
| 测试工程师 | 在飞书项目提交缺陷，需规范填写以下字段供 AI 评估：**标题**（必填）、**描述**（必填）、**复现步骤**（必填）、**日志/错误信息**（必填）、截图（可选）、负责人（必填） |
| 开发工程师 | 收到 bot 通知，Review Draft MR，决定是否合并 |
| 研发效能/平台 | 维护 bot 配置、监控运行状态 |

### 关键使用场景

**场景 A：正常修复流程**
测试提交规范缺陷 → bot 自动分析定位 → TDD 修复 → 开 Draft MR → 飞书通知工程师 → 工程师 Review 合并

**场景 B：信息不足阻塞**
测试提交缺陷但信息不完整 → bot AI 评估信息不足 → GitLab Issue 置阻塞 → 飞书评论 @负责人列出缺失信息 → 开发补充后重新触发

**场景 C：修复失败降级**
bot 尝试修复 5 次均失败 → GitLab Issue 置阻塞 → 飞书通知工程师人工介入

---

## 4. 业务流程与信息架构

### 4.1 高层流程

```
飞书项目缺陷（新建/状态变更为"待修复"）
    │ Webhook → msctl serve /webhook/feishu
    ▼
[阶段 1：信息评估 + GitLab Issue 同步]
  AI 判断缺陷信息是否足够定位和修复 bug
  创建 GitLab Issue，关联飞书缺陷 ID（无论评估结果）
  ├─ 充足 → GitLab Issue 状态 open，继续
  └─ 不足 → GitLab Issue 加 bot:blocked 标签
            飞书缺陷评论：列出缺失信息 + @负责人
            等待工程师手动移除 GitLab bot:blocked 标签后重新触发
    │
    ▼
[阶段 2：Claude Code Agent 分析]
  git worktree 创建隔离工作空间（fix/bug-<缺陷ID>）
  subprocess 调用 claude CLI 分析缺陷内容 + 搜索代码仓库 → 定位根因
    │
    ▼
[阶段 3：强制 TDD 修复循环]
  ① 先写复现 bug 的失败测试（提交到 worktree）
  ② 修改代码让测试通过
  ③ 分层验证：目标失败测试 → 相关模块测试 → typecheck/build/lint
    ├─ 通过 → 进入阶段 4
    └─ 失败 → 重试（最多 5 次）
              超 5 次 → GitLab Issue 标记「阻塞」+ 飞书通知工程师
    │
    ▼
[阶段 4：Draft MR 创建]
  开 Draft MR（固定模板，见 §7）
  飞书 bot 通知工程师：「MR 已就绪，请 Review」+ MR 链接
    │
    ▼
[阶段 5：人工 Review]
  工程师在 GitLab MR 评论确认
  去掉 Draft 标记 → CI 运行 → 人工合并
```

### 4.1.1 完整运行流程图（文本版）

```
飞书缺陷创建/状态变更为"待修复"
  |
  v
Feishu Webhook -> msctl serve
  |
  v
Webhook 验签
  |
  +-- 验签失败
  |     |
  |     v
  |   记录安全日志，丢弃事件
  |
  +-- 验签成功
        |
        v
      按 feishu_issue_id 查找 BugTask
        |
        +-- 不存在
        |     |
        |     v
        |   创建 BugTask，状态 = 待评估
        |
        +-- 已存在
              |
              v
            加载已有 BugTask，做幂等判断
              |
              v
            当前状态是否允许重新处理？
              |
              +-- 否
              |     |
              |     v
              |   忽略重复事件，记录 event log
              |
              +-- 是
                    |
                    v
                  提取缺陷信息
                  标题 / 描述 / 复现步骤 / 日志 / 截图 / 负责人
                    |
                    v
                  信息充分性评估
                    |
                    +-- 信息不足
                    |     |
                    |     v
                    |   创建或更新 GitLab Issue
                    |     |
                    |     v
                    |   设置阻塞状态/标签
                    |     |
                    |     v
                    |   飞书评论缺失信息清单，并 @负责人
                    |     |
                    |     v
                    |   BugTask 状态 = 信息不足/阻塞
                    |     |
                    |     v
                    |   等待飞书补充信息或人工解除阻塞
                    |
                    +-- 信息充足
                          |
                          v
                        创建或同步 GitLab Issue
                          |
                          v
                        创建 MultiSoul conversation
                          |
                          v
                        创建独立 git worktree
                        branch = fix/bug-xxx
                          |
                          v
                        BugTask 状态 = 分析中
                          |
                          v
                        Agent 读取上下文
                        缺陷信息 / repo / issue / 日志
                          |
                          v
                        Fault Localization
                        定位候选文件、函数、测试
                          |
                          v
                        Reproducer 阶段
                          |
                          +-- 无法复现
                          |     |
                          |     v
                          |   判断是否仍然信息不足
                          |     |
                          |     +-- 是
                          |     |     |
                          |     |     v
                          |     |   回到"信息不足"阻塞流程
                          |     |
                          |     +-- 否
                          |           |
                          |           v
                          |         记录无法复现原因
                          |           |
                          |           v
                          |         BugTask 状态 = 无法复现/阻塞
                          |           |
                          |           v
                          |         通知工程师人工介入
                          |
                          +-- 可以复现
                                |
                                v
                              写入或确认失败测试
                                |
                                v
                              失败测试是否按预期失败？
                                |
                                +-- 否
                                |     |
                                |     v
                                |   修正测试或重新定位
                                |     |
                                |     v
                                |   回到 Reproducer 阶段
                                |
                                +-- 是
                                      |
                                      v
                                    BugTask 状态 = 修复中
                                      |
                                      v
                                    生成最小 patch
                                    禁止顺手重构
                                      |
                                      v
                                    运行目标失败测试
                                      |
                                      +-- 不通过
                                      |     |
                                      |     v
                                      |   记录失败原因
                                      |     |
                                      |     v
                                      |   retry_count < 5？
                                      |     |
                                      |     +-- 是
                                      |     |     |
                                      |     |     v
                                      |     |   retry_count + 1
                                      |     |     |
                                      |     |     v
                                      |     |   回到 Fault Localization / Patch
                                      |     |
                                      |     +-- 否
                                      |           |
                                      |           v
                                      |         BugTask 状态 = 修复失败/阻塞
                                      |           |
                                      |           v
                                      |         GitLab Issue 标记阻塞
                                      |           |
                                      |           v
                                      |         飞书通知工程师人工介入
                                      |
                                      +-- 通过
                                            |
                                            v
                                          运行相关模块测试
                                            |
                                            +-- 不通过
                                            |     |
                                            |     v
                                            |   进入 retry 流程
                                            |
                                            +-- 通过
                                                  |
                                                  v
                                                运行 typecheck / build / lint
                                                  |
                                                  +-- 不通过
                                                  |     |
                                                  |     v
                                                  |   进入 retry 流程
                                                  |
                                                  +-- 通过
                                                        |
                                                        v
                                                      生成修复报告
                                                      根因 / diff / 测试结果 / 风险
                                                        |
                                                        v
                                                      提交 worktree 分支
                                                        |
                                                        v
                                                      创建 Draft GitLab MR
                                                        |
                                                        v
                                                      更新 BugTask
                                                      gitlab_mr_id
                                                      状态 = 待 Review
                                                        |
                                                        v
                                                      飞书通知工程师
                                                      MR 链接 + 摘要
                                                        |
                                                        v
                                                      GitLab CI 运行
                                                        |
                                                        +-- CI 失败
                                                        |     |
                                                        |     v
                                                        |   GitLab CI failure webhook
                                                        |     |
                                                        |     v
                                                        |   读取失败日志
                                                        |     |
                                                        |     v
                                                        |   失败类型是否可自动修复？
                                                        |     |
                                                        |     +-- 是
                                                        |     |     |
                                                        |     |     v
                                                        |     |   进入 retry 流程
                                                        |     |
                                                        |     +-- 否
                                                        |           |
                                                        |           v
                                                        |         BugTask 状态 = CI 阻塞
                                                        |           |
                                                        |           v
                                                        |         飞书通知工程师
                                                        |         附失败 job 和日志摘要
                                                        |
                                                        +-- CI 通过
                                                              |
                                                              v
                                                            保持 Draft MR 待人工 Review
                                                              |
                                                              v
                                                            工程师 Review
                                                              |
                                                              +-- 需要修改
                                                              |     |
                                                              |     v
                                                              |   MR 评论修改意见
                                                              |     |
                                                              |     v
                                                              |   bot 是否可处理？
                                                              |     |
                                                              |     +-- 是：回到 Fault Localization / Patch
                                                              |     +-- 否：通知工程师人工介入
                                                              |
                                                              +-- Review 通过
                                                                    |
                                                                    v
                                                                  工程师去掉 Draft
                                                                    |
                                                                    v
                                                                  人工合并 MR
                                                                    |
                                                                    v
                                                                  MR merged webhook
                                                                    |
                                                                    v
                                                                  清理 worktree
                                                                    |
                                                                    v
                                                                  BugTask 状态 = 已完成
```

### 4.2 状态流转

| 状态 | 触发条件 |
|------|---------|
| 待评估 | 飞书缺陷 Webhook 到达 |
| 信息不足（阻塞） | AI 判断信息不足 |
| 分析中 | 信息充足，Agent 开始分析 |
| 修复中 | TDD 循环进行中 |
| 待 Review | Draft MR 已开，等待工程师 |
| 修复失败（阻塞） | 重试超 5 次 |
| 已完成 | 工程师合并 MR |

---

## 5. 数据模型与接口

### 5.1 核心实体

**BugTask**（存储于 multisoul SQLite）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，UUID |
| feishu_issue_id | TEXT | 飞书缺陷 ID |
| gitlab_issue_id | INTEGER | 同步后的 GitLab Issue ID |
| gitlab_mr_id | INTEGER | Draft MR ID（可空） |
| worktree_path | TEXT | git worktree 路径 |
| branch_name | TEXT | fix/bug-\<feishu_issue_id\>（可空） |
| status | TEXT | 见状态流转表 |
| pipeline_stage | TEXT | 当前所在阶段（intake/reproducer/patch/verifier/publisher） |
| retry_count | INTEGER | 当前重试次数，默认 0 |
| claude_session_id | TEXT | 当前 claude session ID，用于 --resume 复用（可空） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最后更新时间 |

### 5.2 外部集成接口

| 系统 | 接口方向 | 说明 |
|------|---------|------|
| 飞书项目 | 入站 Webhook | 缺陷状态变更事件 |
| 飞书 IM | 出站 | 发送通知消息给工程师 |
| 飞书项目 | 出站 | 在缺陷评论中回复 |
| GitLab API | 出站 | 创建 Issue、开 MR、设置阻塞状态 |
| GitLab Repo | 本地 | git worktree 操作 |
| Claude Code | 本地 | subprocess 调用 claude CLI，直接调度 Agent |

---

## 6. 技术实现概览

### 6.1 整体架构

```
飞书 Webhook
    │
    ▼
msctl serve（新增 /webhook/feishu 路由）
    │
    ├─ 信息评估：调用 Claude API 判断信息充分性
    ├─ GitLab Issue 同步：调用 GitLab API
    ├─ 创建 MultiSoul conversation
    └─ 调度 Claude Code Agent（via 现有 runtime）
           │
           ├─ git worktree 隔离（每 bug 独立）
           ├─ 代码仓库分析
           ├─ TDD 修复循环
           └─ Draft MR 创建
```

### 6.2 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发方式 | msctl serve 扩展 webhook 端点 | 复用现有架构，零额外服务 |
| Conversation 结构 | 每 bug 独立 conversation | 可追溯，手机端 Inbox 可按 bug 跟踪 |
| 并行隔离 | git worktree（每 bug 独立） | 多 bug 并行修复互不干扰 |
| 修复质量保障 | 强制 TDD（先写失败测试） | 确保修复有测试覆盖，防止无效 patch |
| 状态持久化 | multisoul SQLite（现有 DB） | 无需引入新依赖 |
| GitLab 阻塞状态 | Label 方式（`bot:blocked`） | 使用 CE 版，不依赖 EE blocking issues 功能 |
| Worktree 清理 | MR 合并/关闭后自动清理 | 监听 GitLab MR Webhook 事件触发清理 |
| 多 Repo 支持 | 模块→Repo 映射配置文件 | 飞书缺陷「所属模块」字段映射到对应 repo 路径 |
| Webhook 安全 | 飞书标准 Token 验签 | 校验请求 header 中的签名，防止伪造请求 |

### 6.2.1 修复 Pipeline 阶段职责

主流程按以下阶段推进：

```
Bug Intake
  -> Reproducer
  -> Fault Localizer
  -> Patch Generator
  -> Verifier
  -> Review Summarizer
  -> PR Publisher
```

| 阶段 | 做什么 | 输入 | 输出 | 失败出口 |
|------|--------|------|------|----------|
| Bug Intake | 接收飞书缺陷事件，验签，幂等去重，抽取缺陷上下文，判断信息是否足够，创建/同步 GitLab Issue | 飞书 Webhook、缺陷字段、历史 BugTask | BugTask、GitLab Issue、信息充分性结论 | 验签失败丢弃；信息不足则阻塞并飞书评论缺失项 |
| Reproducer | 证明 bug 存在。优先找到现有失败测试；没有则新增一个失败测试；测试必须在修复前按预期失败 | BugTask、缺陷复现步骤、日志、候选测试目录 | `reproducer_test_path`、失败命令、失败日志摘要 | 无法复现则阻塞；测试没有失败则回到定位或要求补充信息 |
| Fault Localizer | 定位最小相关代码区域，避免全仓库盲改。结合 stack trace、日志关键词、测试失败、代码搜索、历史提交定位候选文件/函数 | 缺陷上下文、失败测试、repo 搜索结果、日志 | 候选文件/函数列表、根因假设、修复范围 | 候选范围过大或证据不足则阻塞/要求人工补充 |
| Patch Generator | 生成最小修复 diff。只修 bug，不做顺手重构；必须保留或新增回归测试 | 根因假设、候选代码、失败测试 | 代码 patch、测试 patch、变更文件列表 | 生成 patch 后测试仍失败则进入重试；超过 5 次阻塞 |
| Verifier | 分层验证 patch：目标失败测试、相关模块测试、typecheck/build/lint；MR 后继续接收 GitLab CI 结果 | patch、测试命令、项目验证配置、CI webhook | verification_summary、通过/失败结论、失败日志摘要 | 可自动修复的失败回到 Patch；不可自动修复则 CI 阻塞或修复失败 |
| Review Summarizer | 把机器执行过程转换成人可 Review 的报告：根因、修复摘要、新增测试、验证命令、风险点 | diff、验证结果、Agent 分析记录 | MR 描述内容、飞书通知摘要、风险等级 | 报告缺少根因/测试证据时不允许进入 PR Publisher |
| PR Publisher | 提交 worktree 分支，创建 Draft MR，关联飞书缺陷和 GitLab Issue，通知工程师 Review | MR 描述、分支、BugTask、GitLab token | Draft MR、飞书通知、BugTask 状态 = 待 Review | MR 创建失败则阻塞并记录 API 错误；不自动合并 |

### 6.2.2 分层验证策略

每次 patch 后按从小到大的顺序验证：

1. **目标失败测试**：`Reproducer` 阶段确认失败的测试必须通过。
2. **相关模块测试**：运行同包、同 crate、同 feature 或同目录的测试。
3. **静态验证**：运行项目约定的 typecheck、build、lint、format check。
4. **GitLab CI**：Draft MR 创建后由 GitLab CI 做最终验证；CI 失败事件回流到同一个 BugTask。

验证失败时必须记录命令、退出码、关键日志和归因结论。只有可归因为 lint/type/fmt/测试回归等可自动修复问题时才进入下一轮自动重试；权限、网络、环境、需求不明确等问题直接阻塞。

### 6.3 约束与假设

- 飞书项目需配置 Webhook，指向 msctl serve 的公网地址（Tailscale Funnel）
- GitLab 需提供具有 Issue 写权限、Label 管理权限和 MR 创建权限的 Access Token
- GitLab 版本为 CE（不依赖 EE 功能）
- **GitLab 需在项目设置中启用以下 Webhook 事件**：Pipeline events（CI 失败回流）、Merge request events（MR 合并/关闭后清理 worktree）
- 代码仓库需在本机 clone，bot 通过本地路径操作
- 飞书 bot 需有对应缺陷的评论权限
- 模块→Repo 映射通过配置文件维护（`~/.config/msctl/bugfix-bot.toml`）

### 6.4 模块→Repo 映射配置示例

```toml
# ~/.config/msctl/bugfix-bot.toml

[module_repo_map]
"用户中心" = { repo_url = "git@gitlab.example.com/user-service.git", local_path = "~/repos/user-service" }
"订单系统" = { repo_url = "git@gitlab.example.com/order-service.git", local_path = "~/repos/order-service" }
"前端" = { repo_url = "git@gitlab.example.com/frontend.git", local_path = "~/repos/frontend" }

[feishu]
webhook_token = ""   # 飞书 Webhook 验签 Token，从飞书项目配置获取
bot_app_id = ""      # 飞书自建应用 App ID，用于发送消息和评论
bot_app_secret = ""  # 飞书自建应用 App Secret

[gitlab]
base_url = "https://gitlab.example.com"
access_token = ""  # 从 msctl config 读取，不在此硬编码
blocked_label = "bot:blocked"
```

---

## 7. Draft MR 固定模板

```markdown
## [AutoFix] <飞书缺陷ID> - <缺陷标题>

### 根因分析
<AI 分析的根本原因，含涉及文件/函数>

### 修复摘要
<具体修改了什么，为什么这样改>

### 新增测试
- [ ] `<测试文件路径>` - `<测试函数名>`：验证 <bug 复现场景>

### 关联
- 飞书缺陷：<飞书缺陷链接>
- GitLab Issue：#<issue_id>

---
> 此 MR 由 bugfix-bot 自动生成，请 Review 后去掉 Draft 标记。
```

---

## 8. 状态、错误与边界情况

### 8.1 信息不足处理

- **判断方式**：AI 阅读缺陷内容，判断是否能定位到代码层面的根因
- **触发阻塞**：GitLab Issue 加 `bot:blocked` 标签 + 飞书缺陷评论列出缺失信息 + @负责人
- **解除阻塞**：工程师在 GitLab Issue 手动移除 `bot:blocked` 标签，然后在飞书缺陷上重新变更状态为"待修复"以触发 Webhook 重新处理

### 8.2 修复失败处理

- 最多重试 5 次（含 CI 失败触发的重试）
- 超限后：GitLab Issue 标记阻塞 + 飞书通知工程师人工介入
- 重试计数存储于 BugTask.retry_count

### 8.3 并发处理

- 多个 bug 同时到达时，每个 bug 独立 worktree，互不干扰
- 同一 bug 重复触发（如飞书状态多次变更）需做幂等处理（按 feishu_issue_id 去重）

### 8.4 CI 失败

- Draft MR 开启后，CI 失败通知 bot
- bot 收到 CI 失败通知 → 计入重试次数 → 重新进入 TDD 修复循环

---

## 9. 非功能性需求

| 维度 | 要求 |
|------|------|
| 可追溯性 | 每个 bug 有独立 conversation，飞书/GitLab 双向关联 |
| 安全性 | GitLab Token 存储于 msctl config，不硬编码；Webhook 需验签 |
| 可运维性 | 运行日志通过 msctl logs 查看；阻塞状态在 GitLab 可见 |
| 幂等性 | 同一飞书缺陷重复触发不创建重复 Issue/MR |

---

## 10. 风险、权衡与未决问题

### 已知风险

| 风险 | 应对 |
|------|------|
| AI 修复质量不稳定 | 强制 TDD + 全量测试 + 人工 Review 三重保障 |
| worktree 残留 | MR 合并/关闭后自动清理 worktree |
| 飞书 Webhook 丢失 | 可补充轮询机制作为兜底（MVP 后期） |

### 已做的 trade-off

- 全量尝试（不按优先级过滤）：接受低优先级 bug 也消耗 AI 资源，换取覆盖率
- 信息不足由 AI 判断（非硬性字段校验）：更灵活，但判断标准不透明

### 未决问题

~~- [ ] 飞书 Webhook 验签方式（需确认飞书项目 Webhook 签名机制）~~  ✅ 飞书标准 Token 验签
~~- [ ] GitLab 阻塞状态的具体实现方式（label 还是 blocking issue 功能）~~  ✅ Label 方式（CE 兼容）
~~- [ ] worktree 清理时机（MR 合并后？关闭后？超时后？）~~  ✅ MR 合并/关闭后自动清理
~~- [ ] 多 repo 支持（当前假设单 repo，多 repo 需扩展模块→repo 映射配置）~~  ✅ 模块→Repo 映射配置文件

---

## 11. 验收标准

### MVP 验收 Checklist

- [ ] 飞书缺陷状态变更 → GitLab Issue 同步链路通
- [ ] 信息不足的缺陷被正确阻塞，飞书评论通知提交者
- [ ] 信息充足的缺陷触发 Claude Code Agent 分析
- [ ] TDD 流程：先有失败测试，再有修复代码，Draft MR 包含测试文件
- [ ] Draft MR 安全生成，不影响主分支
- [ ] 重试超 5 次正确降级为阻塞 + 飞书通知
- [ ] 无法复现的缺陷被正确阻塞，飞书通知工程师人工介入
- [ ] 同一缺陷重复触发不创建重复 Issue/MR（幂等）
- [ ] 飞书 bot 在 MR 就绪时通知工程师

### 代表性验收场景

1. **正常路径**：提交含完整字段的 P1 bug → 5 分钟内收到飞书通知「MR 已就绪」
2. **信息不足**：提交缺少复现步骤的 bug → 飞书评论提示补充 → 工程师移除 GitLab blocked 标签并重新触发后自动处理
3. **无法复现**：提交一个 bot 无法在本地复现的 bug → 飞书通知工程师人工介入
4. **修复失败**：提交一个 bot 无法修复的复杂 bug → 5 次重试后收到「请人工介入」通知
5. **并行处理**：同时提交 3 个 bug → 3 个独立 worktree 并行运行，互不干扰
