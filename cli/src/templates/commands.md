<!-- msctl-inject-start -->
## msctl — Agent 控制台命令参考

> **Agent ID:** {{agent_id}}
> **Endpoint:** {{endpoint}}
> **Auth:** `Authorization: Bearer {{token}}`

### 启动 / 停止服务

```bash
# 启动本地 serve（默认端口 8765）
msctl serve

# 查看运行日志
msctl logs
```

### Agent 管理

```bash
# 列出所有已注册 agent
msctl agent list

# 查看当前 agent 详情
msctl agent get {{agent_id}}

# 注册新 agent（claude-code runtime）
msctl agent register --name <name> --project <path> --runtime claude-code

# 注册新 agent（codex runtime）
msctl agent register --name <name> --project <path> --runtime codex

# 删除 agent
msctl agent delete <id>
```

### 对话 / 消息

```bash
# 向当前 agent 发起对话
msctl agent invoke {{agent_id}} --message "帮我修复这个 bug"

# 查看 agent 的对话列表（需要 serve 运行）
curl -H "Authorization: Bearer {{token}}" \
  {{endpoint}}/api/v1/agents/{{agent_id}}/conversations

# 查看对话消息
curl -H "Authorization: Bearer {{token}}" \
  {{endpoint}}/api/v1/conversations/<conv_id>/messages
```

### 健康检查

```bash
# 无需 token
curl {{endpoint}}/api/v1/healthz
```

<!-- msctl-inject-end -->
