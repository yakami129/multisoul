# Agent 快速注册模式 SPEC

## 1. 背景与目标

### 背景

当前 `msctl agent register` 面向完整配置场景，需要用户显式填写 agent 名称、项目路径、runtime、mode 等参数。对于最常见的使用方式：用户已经站在项目目录里，只想把当前项目注册到 MultiSoul，这条路径偏重。

### 目标

提供 `msctl agent <runtime>` 快速注册模式。用户只输入 runtime，CLI 自动使用当前目录作为工作空间、使用目录名生成 agent 名称，并在名称冲突时自动选择可用名称。

## 2. 范围

### 2.1 In Scope

- 新增 `msctl agent <runtime>` 快速注册入口。
- Runtime 与现有 runtime agent 注册能力保持一致：`claude-code`、`codex`、`cursor-cli`。
- 工作空间固定为执行命令时的当前目录。
- Agent 基础名称固定为当前目录的最后一级目录名。
- Agent 名称按现有数据约束全局唯一；发生冲突时自动尝试 `name-2`、`name-3`，直到找到可用名称。
- 快速注册沿用 runtime agent 的默认 mode：`full-auto`。
- 快速注册保留普通 `msctl agent register` 的注册副作用，包括向工作空间注入 msctl 命令速查上下文。
- 成功输出必须包含新 agent 的 name、id、workspace、runtime，方便用户后续 `list` / `delete <id>`。

### 2.2 Out of Scope

- 不支持自定义 agent 名称；需要自定义时继续使用 `msctl agent register --name ...`。
- 不支持指定工作空间路径；快速模式只使用当前目录。
- 不支持自定义 mode；快速模式固定使用 `full-auto`。
- 不做项目根目录探测，不向上查找 `.git`、`package.json`、`Cargo.toml` 等标记。
- 不警告当前目录是否为项目根目录。
- 不改变 `agents` 表结构，也不把名称唯一性改为按 workspace 分组。
- 不新增按 name 删除 agent 的能力；删除仍使用现有 `msctl agent delete <id>`。

## 3. 用户与使用场景

### 用户角色

- 开发者：在项目目录下快速注册本地 AI Agent，之后通过 MultiSoul 手机端控制。

### 场景 1：首次快速注册

```bash
cd ~/projects/multisoul
msctl agent codex
```

预期结果：

```text
Agent 'multisoul' registered successfully
ID: <uuid>
Workspace: /Users/alan/projects/multisoul
Runtime: codex
```

### 场景 2：名称冲突自动累加

```bash
cd ~/projects/multisoul
msctl agent codex
msctl agent codex
msctl agent codex
```

预期结果：

- 第一次注册为 `multisoul`。
- 第二次注册为 `multisoul-2`。
- 第三次注册为 `multisoul-3`。
- 冲突判断基于全局 agent 名称，而不是基于同一个 workspace。

### 场景 3：非法 runtime

```bash
msctl agent unknown
```

预期结果：

```text
Error: Invalid runtime 'unknown'. Valid values: claude-code, codex, cursor-cli
```

## 4. 行为契约

### 命令解析

- `msctl agent register`、`list`、`get`、`update`、`delete`、`invoke`、`install`、`uninstall`、`restart` 等现有子命令行为不变。
- 当 `msctl agent` 收到一个不是现有子命令的单个参数时，将其解释为快速注册 runtime。
- 当快速注册收到 0 个或多于 1 个 runtime 参数时，显示 clap 帮助或明确错误，不进入注册流程。

### Runtime 校验

有效 runtime：

- `claude-code`
- `codex`
- `cursor-cli`

无效 runtime 必须失败，不写入数据库，不注入上下文。

### 工作空间与名称推断

- 工作空间取 `std::env::current_dir()` 的结果，并以绝对路径入库。
- 用户可见文案使用 `Workspace`，数据层仍映射到现有 `agents.project_path` 字段。
- Agent 基础名称取当前目录最后一级目录名。
- 如果无法读取当前目录或无法从路径推断名称，命令失败，不写入数据库。

### 名称冲突

- 当前 schema 中 `agents.name` 是全局唯一，因此快速注册必须按全局名称检查冲突。
- 候选顺序为：`base`、`base-2`、`base-3`、依此类推。
- 只要某个候选名称已经存在，无论它来自哪个 `project_path`，都继续尝试下一个后缀。

### 成功后的状态

- `agents` 表新增一条 runtime agent 记录。
- 新记录的 `project_path` 等于命令执行时的当前目录。
- 新记录的 `runtime` 等于用户传入的 runtime。
- 新记录的 `mode` 为 `full-auto`。
- 工作空间收到与 `msctl agent register` 相同的 msctl 命令速查上下文注入。

## 5. 错误与边界

| 场景 | 预期行为 |
| --- | --- |
| 当前目录不可读 | 失败，输出可诊断错误，不写 DB |
| 当前目录无法推断目录名 | 失败，输出可诊断错误，不写 DB |
| runtime 非法 | 失败，列出合法 runtime，不写 DB |
| 数据库插入失败 | 失败，透传可诊断错误 |
| 名称已有大量后缀 | 按顺序继续尝试，直到找到可用名称 |
| 用户在非项目目录执行 | 允许注册，不做项目根判断 |

## 6. 非功能性需求

- 快速注册应保持本地命令响应，正常情况下 100ms 内完成。
- 不引入网络请求。
- 不读取或修改 `~/.config/msctl/*` 之外的用户数据，工作空间注入行为沿用既有注册流程。
- 不新增数据库 schema migration。

## 7. 验收标准

### 基础功能

- [ ] 在 git 仓库根目录执行 `msctl agent codex`，成功注册，入库 runtime 为 `codex`。
- [ ] 在普通目录执行 `msctl agent claude-code`，成功注册，入库 runtime 为 `claude-code`。
- [ ] 在普通目录执行 `msctl agent cursor-cli`，成功注册，入库 runtime 为 `cursor-cli`。
- [ ] 上述三个快速注册路径都使用当前目录作为 `project_path`，并使用目录名作为基础 agent name。
- [ ] 注册后的 `msctl agent list` 能看到新 agent，且 PROJECT/Workspace 为执行命令时的当前目录。
- [ ] 成功输出包含 name、id、workspace、runtime。
- [ ] 成功注册后可使用输出的 id 执行 `msctl agent delete <id>`。

### 名称冲突

- [ ] 当基础名称未被占用时，使用目录名作为 agent name。
- [ ] 当基础名称已存在时，使用 `name-2`。
- [ ] 当 `name` 与 `name-2` 都已存在时，使用 `name-3`。
- [ ] 即使已有同名 agent 来自不同 `project_path`，也继续生成后缀，避免违反全局唯一约束。

### 参数与错误

- [ ] `msctl agent unknown` 失败，并提示合法 runtime：`claude-code, codex, cursor-cli`。
- [ ] 非法 runtime 不会写入 `agents` 表。
- [ ] 当前目录不可读时失败，不会写入 `agents` 表。
- [ ] 当前目录无法推断目录名时失败，不会写入 `agents` 表。

### 兼容性

- [ ] `msctl agent --help` 能展示快速注册用法，同时保留现有子命令。
- [ ] 快速注册不改变已有 agent 记录。
- [ ] 快速注册保留普通注册流程的工作空间上下文注入行为。
- [ ] `msctl agent register --name legacy-codex --project <path> --runtime codex` 仍按原方式注册 runtime agent。
- [ ] `msctl agent register --name legacy-claude --project <path> --runtime claude-code` 仍按原方式注册 runtime agent。
- [ ] `msctl agent register --name legacy-cursor --project <path> --runtime cursor-cli` 仍按原方式注册 runtime agent。
- [ ] `msctl agent register --name legacy-mode --project <path> --runtime codex --mode suggest` 仍保存用户显式指定的 mode，不被快速模式默认值影响。
- [ ] `msctl agent register --type plugin --name <name>` 的 plugin agent 注册分支不受快速模式影响。
- [ ] `msctl agent register --name missing-project --runtime codex` 对 runtime agent 仍按原逻辑要求 `--project`，不会因为快速模式而隐式使用当前目录。
