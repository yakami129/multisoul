# Agent 任务完成通知 SPEC

## 1. 背景与目标

用户在 MultiSoul 中运行 agent 任务时，常常切换到其他 app 或锁屏等待。当前没有任何提醒机制，用户需要主动回来查看进度。本功能通过系统通知（后台）和音效（前台）在任务完成时主动告知用户，减少轮询等待的心智负担。

## 2. 范围

### In Scope
- Agent 任务状态变为 completed 时触发提醒
- 前台：播放系统内置音效（不弹通知横幅）
- 后台：推送本地通知 + 支持 APNs 远程推送
- 通知内容：标题含 agent 名称，正文含任务摘要
- 点击通知跳转到对应任务详情页
- 首次打开 app 时申请通知权限

### Out of Scope
- 用户控制开关（默认全开，不提供设置项）
- 按 agent 粒度配置通知
- 任务失败、agent 出错、需要用户决策等其他事件的通知（架构预留，暂不实现）
- 通知去重 / 频率限制

## 3. 用户与使用场景

**典型用户**：在 iOS 上运行 agent 任务后切换到其他 app 或锁屏等待结果的用户。

**核心场景**：
1. 用户启动一个 agent 任务 → 切换到微信 → 任务完成 → 收到通知横幅 + 声音 → 点击跳转到任务详情
2. 用户在 app 内等待 → 任务完成 → 听到提示音，无通知横幅打扰

## 4. 业务流程

```
任务状态变为 completed
    ↓
判断 app 状态（前台 / 后台）
    ├── 前台 → 播放系统音效（AVAudioSession）
    └── 后台 → 调度本地通知（UNUserNotificationCenter）
                  ↓
              通知内容：
                标题：「[Agent名称] 任务完成」
                正文：任务摘要（截断至 ~100 字符）
                userInfo：{ agentId, taskId }
                  ↓
              用户点击通知 → 跳转任务详情页
```

**权限申请流程**：
```
App 首次启动
    ↓
requestAuthorization(options: [.alert, .sound, .badge])
    ├── 用户允许 → 注册 APNs（获取 device token）
    └── 用户拒绝 → 静默降级（仅前台音效）
```

## 5. 数据模型与接口

**本地通知 payload**：
```json
{
  "title": "[AgentName] 任务完成",
  "body": "任务摘要（最多100字符）",
  "sound": "default",
  "userInfo": {
    "agentId": "string",
    "taskId": "string",
    "type": "task_completed"
  }
}
```

**APNs 远程推送 payload**（后端发送）：
```json
{
  "aps": {
    "alert": {
      "title": "[AgentName] 任务完成",
      "body": "任务摘要"
    },
    "sound": "default"
  },
  "agentId": "string",
  "taskId": "string",
  "type": "task_completed"
}
```

**后端接口预留**（本期不实现，架构预留）：
- `POST /api/v1/devices/token` — 注册 APNs device token

## 6. 技术实现概览

- **前台音效**：`AVAudioSession` + `AudioServicesPlaySystemSound`，使用系统内置音效
- **后台本地通知**：`UNUserNotificationCenter`，任务状态变更时调度 `UNNotificationRequest`（trigger 为 nil，立即触发）
- **通知点击处理**：实现 `UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:)`，从 `userInfo` 取 `agentId` / `taskId`，通过 React Navigation 导航到任务详情页
- **APNs 远程推送**：本期在 `AppDelegate` 中实现 `didRegisterForRemoteNotificationsWithDeviceToken`，将 token 存储到本地（Zustand / AsyncStorage），后端集成留到下一期
- **状态检测**：通过 `UIApplication.shared.applicationState` 判断前台/后台

## 7. 状态、错误与边界情况

| 场景 | 处理方式 |
|------|----------|
| 用户拒绝通知权限 | 静默降级，前台仍播音效，后台无通知 |
| 任务摘要为空 | 正文显示「点击查看详情」 |
| 点击通知时 app 已被杀死 | 通过 `launchOptions` 恢复导航到任务详情 |
| 多个任务同时完成 | 每个任务各发一条通知，不合并 |
| APNs token 获取失败 | 仅降级为本地通知，不影响主流程 |

## 8. 非功能性需求

- 音效播放延迟 < 200ms（任务状态变更后）
- 通知调度延迟 < 500ms
- 不影响 app 主线程性能（音效播放在后台线程）

## 9. 风险与权衡

- **本地通知 vs APNs**：本期优先本地通知（可靠、无需后端），APNs 架构预留。风险：app 被系统彻底终止时本地通知仍可触发，但若任务在服务端完成而 app 未在运行则无法感知——这是 APNs 要解决的问题，下期处理。
- **不做用户控制**：简化首版，用户可通过 iOS 系统设置关闭通知。

## 10. 验收标准

- [ ] 首次启动 app 弹出通知权限申请
- [ ] app 在前台时任务完成 → 播放音效，不弹通知横幅
- [ ] app 在后台时任务完成 → 收到系统通知（含 agent 名称和任务摘要）
- [ ] 点击通知 → 跳转到对应任务详情页
- [ ] 用户拒绝通知权限 → 前台音效正常，后台无通知，app 不崩溃
- [ ] app 被杀死后点击通知 → 正确启动并导航到任务详情
