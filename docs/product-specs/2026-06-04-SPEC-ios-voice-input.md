# iOS Voice Input SPEC

## 1. 背景与目标

MultiSoul Chat 输入栏已有语音按钮，但当前行为只是提示“语音功能即将上线”。用户希望用最低对接成本先获得可用的语音输入能力：在 iPhone 上说话，系统完成语音识别，识别文本进入现有输入框，由用户确认后再发送给 Agent。

本功能的目标不是做音频消息或实时语音对话，而是把语音作为一种更快的文本输入方式，复用现有 Chat 文本发送链路。

## 2. 已确认决策

以下决策来自 2026-06-04 的问答卡片：

- 识别路线：iOS 系统语音识别
- 转写结果：填入输入框，用户确认发送
- 语言策略：跟随系统语言
- 平台范围：只做 iOS，其他平台禁用
- MVP 必须覆盖：麦克风权限和拒绝态、录音开始/停止/取消、转写成功填入输入框、网络/超时/空音频错误态、组件测试与 typecheck

## 3. 范围

### In Scope

- iOS Chat 输入栏启用语音输入按钮
- 首次使用时请求麦克风权限与 iOS 语音识别权限
- 用户可以开始录音、停止录音、取消本次录音
- 识别文本写入当前输入框，但不自动发送
- 默认识别语言跟随系统语言，不在 MVP 中提供语言选择器
- 非 iOS 平台保留入口但置为禁用状态
- 覆盖权限拒绝、识别不可用、网络/超时、空音频/无识别文本等失败态
- 不保存原始音频，不上传音频到 MultiSoul CLI 或第三方转写 API

### Out of Scope

- Android 语音识别
- Web 语音识别
- OpenAI/Whisper/云端转写
- CLI 本地转写服务
- 自动发送识别文本
- 实时语音对话、边说边由 Agent 回复
- 保存、回放、发送音频文件
- 聊天页语言手动切换
- 说话人识别、标点高级设置、自定义词表

## 4. 用户场景

### 4.1 正常语音输入

1. 用户进入某个 Chat conversation
2. 用户点击输入栏右侧麦克风按钮
3. iOS 请求必要权限，或在已授权时直接开始听写
4. 输入栏进入录音中状态
5. 用户点击停止
6. App 将识别到的文本填入输入框
7. 用户检查、编辑文本
8. 用户点击发送，复用现有文本消息发送流程

### 4.2 取消录音

1. 用户开始录音
2. 用户点击取消
3. App 停止当前识别任务
4. 输入框保持原内容不变
5. 不产生任何消息，不触发 Agent runtime

### 4.3 权限拒绝

1. 用户点击麦克风
2. 用户拒绝麦克风权限或语音识别权限
3. App 明确提示需要开启权限
4. 本次语音输入结束
5. 输入框内容不变

### 4.4 非 iOS 平台

1. 用户在 Android/Web 上进入 Chat
2. 麦克风入口显示为禁用状态
3. 用户无法启动语音识别
4. 不展示“即将上线”的占位弹窗作为主要行为

## 5. 产品语义

### 5.1 文本写入规则

识别结果写入现有输入框，不绕过用户确认。

- 如果输入框为空，写入识别文本
- 如果输入框已有文本，MVP 默认把识别文本追加到末尾，中间补一个空格
- 如果识别结果为空或只有空白字符，输入框保持原样并提示未识别到语音
- 识别文本写入后，发送按钮按现有 `canSend` 规则出现

MVP 不要求按光标位置插入文本，因为当前 Chat 输入栏没有稳定暴露 selection 语义；光标插入可作为后续体验优化。

### 5.2 状态与按钮行为

语音输入至少包含以下状态：

| 状态 | 用户可见行为 |
|------|--------------|
| idle | 麦克风按钮可点击 |
| requesting_permission | 防重复点击，等待系统权限结果 |
| recording | 展示录音中状态，可停止或取消 |
| transcribing | 防重复点击，等待最终识别结果 |
| unavailable | 非 iOS 或设备不支持时禁用 |
| error | 提示错误后回到 idle |

当 conversation 正在运行、输入栏被禁用、或平台不是 iOS 时，语音输入入口应禁用。

### 5.3 语言策略

MVP 跟随系统语言。

- 不提供聊天页语言选择器
- 不固定为中文普通话或英文
- 如果底层语音识别 API 需要显式 locale，应使用设备当前 locale
- 如果系统语言不受支持，展示“当前语言不可用于语音识别”一类错误

### 5.4 隐私与数据处理

- App 不应持久化原始音频
- App 不应把原始音频上传到 MultiSoul CLI
- App 不应调用 OpenAI、Whisper 或其他第三方转写 API
- 语音识别权限文案必须说明会使用系统语音识别能力将语音转换为文本
- 诊断日志不得记录原始音频路径或未发送的识别草稿

Apple 文档说明，使用 `SFSpeechRecognizer.requestAuthorization` 前必须在 Info.plist 中提供 `NSSpeechRecognitionUsageDescription`，否则调用会导致 app crash。

## 6. 错误态

MVP 必须处理以下错误：

| 场景 | 用户体验 |
|------|----------|
| 麦克风权限拒绝 | 提示需要麦克风权限，可引导去设置 |
| 语音识别权限拒绝 | 提示需要语音识别权限，可引导去设置 |
| 设备或系统不支持 | 语音入口禁用或提示当前设备不可用 |
| 网络不可用或系统识别失败 | 提示语音识别失败，请稍后重试 |
| 识别超时 | 自动结束本次录音并提示超时 |
| 用户未说话或结果为空 | 提示未识别到语音，输入框保持原样 |
| 录音被中断 | 停止录音并提示本次语音输入已中断 |

## 7. 验收标准

### 7.1 功能验收

- [ ] iOS 上点击麦克风后能请求并处理麦克风权限
- [ ] iOS 上点击麦克风后能请求并处理语音识别权限
- [ ] 已授权时，点击麦克风进入录音中状态
- [ ] 录音中可以停止，停止后识别文本填入输入框
- [ ] 录音中可以取消，取消后输入框保持原样
- [ ] 识别文本填入后不会自动发送消息
- [ ] 识别文本填入后，用户点击发送才触发现有 `postMessage` 流程
- [ ] 输入框已有文本时，识别文本追加到末尾且不破坏原草稿
- [ ] 空音频或空识别结果不会清空输入框
- [ ] conversation 运行中或输入栏 disabled 时，语音入口不可用
- [ ] Android/Web 上语音入口禁用，不启动识别

### 7.2 错误态验收

- [ ] 麦克风权限拒绝时展示明确提示
- [ ] 语音识别权限拒绝时展示明确提示
- [ ] 系统语音识别不可用时展示明确提示
- [ ] 网络失败或系统识别失败时展示明确提示
- [ ] 超时时展示明确提示并回到 idle
- [ ] 未识别到有效文本时展示明确提示并保留原输入
- [ ] 取消录音不展示错误提示

### 7.3 质量验收

- [ ] 新增依赖或 iOS 权限后，`mobile/app.json` 包含 `NSSpeechRecognitionUsageDescription`
- [ ] 权限守护脚本覆盖语音识别所需 plist key
- [ ] 不新增硬编码 token 或 API key
- [ ] 不新增 `console.log`
- [ ] 不使用 `// eslint-disable`、`@ts-ignore` 或其他诊断压制作为实现手段
- [ ] 不让 `mobile/src|app` 下单文件超过 500 行
- [ ] Chat 输入栏相关测试覆盖成功、取消、权限拒绝、错误态、非 iOS 禁用
- [ ] 执行 `cd mobile && pnpm typecheck` 通过
- [ ] 执行 `cd mobile && pnpm test -- --watchAll=false` 通过

## 8. 实现约束提示

本规格不指定最终技术方案；具体依赖选择和组件拆分应在设计文档或执行计划中展开。但实现时应遵守以下约束：

- 不能把大量语音状态直接塞进 `ChatInputBar.tsx`
- 当前 `ChatInputBar.test.tsx` 已接近 500 行，新增测试应拆到新测试文件
- 若新增 native speech recognition 依赖，需要确认 Expo config plugin、iOS build、权限文案和 CI 守护脚本一起更新
- 语音识别完成后应只调用输入框文本更新入口，不应直接调用发送逻辑

## 9. 参考资料

- Apple Developer Documentation：`SFSpeechRecognizer.requestAuthorization` 要求先请求语音识别权限，并依赖 `NSSpeechRecognitionUsageDescription`
- Apple Info.plist Key Reference：`NSSpeechRecognitionUsageDescription` 描述为什么 app 需要发送用户语音数据给 Apple 语音识别服务
- Expo Speech 文档：`expo-speech` 是 Text-to-speech，不提供本需求所需的 Speech-to-text
- `expo-speech-recognition` README：第三方 Expo speech recognition 模块，目标是封装 iOS `SFSpeechRecognizer`、Android `SpeechRecognizer` 与 Web `SpeechRecognition`
