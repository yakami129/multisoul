# `references/` — 机器可读契约

回答 **"接口/协议/枚举的精确定义是什么"**。

## 内容范围

- REST API 路径、方法、入参、返回（结构化表格）
- WebSocket 协议、消息帧定义
- 消息类型枚举（user_text / agent_text / tool_call / tool_result / ask_question / task_status）
- 环境变量清单
- 数据库 schema 摘要

## 命名约定

- `<topic>.md`，扁平不分子目录
- 例如：`api-rest.md`、`api-websocket.md`、`message-types.md`、`env-vars.md`、`db-schema.md`

## 内容风格

- **表格优先**，不写散文
- 每条 entry 必须有：名称 / 类型 / 默认值 / 说明 / 引用源（哪个文件定义）
- 如果某个枚举/接口在代码里有 single source of truth，本目录文档要标注 "Source of truth: `path/to/file.ts:NN`" 并由 lint/CI 校验同步（未来工作）

## 现状

本目录暂为占位。当前 API 信息仍散落在：

- 仓库根 [`README.md`](../../README.md) — REST API 概览表
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — 协议总览
- [`../../CLAUDE.md`](../../CLAUDE.md) — env vars 表

后续按需迁移到本目录，作为 single source of truth。
