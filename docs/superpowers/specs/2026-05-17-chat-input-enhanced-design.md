---
title: Chat Input Enhanced Design
date: 2026-05-17
status: approved
---

# Chat Input Enhanced Design

## 目标

将 MultiSoul 的 ChatInputBar 组件重构为完全对齐 Pencil Enhanced Input 设计的单一卡片式输入组件，整合图片预览、文本输入和工具栏功能。

## 背景

**当前实现：**
- ChatInputBar 组件：单层输入框 + 工具栏分离布局
- 图片预览 UI：独立的 ScrollView，位于 ChatInputBar 上方（chat/[id].tsx 第 429-459 行）
- 视觉风格：圆角 20px，背景 `#1A1A1A`，无边框

**Pencil Enhanced Input 设计：**
- 单一卡片容器，内部三层结构（图片预览行 + 文本输入行 + 工具栏行）
- 圆角 10px，背景 `#111111`，边框 `#222222` 1px
- 图片缩略图 52×52px，圆角 8px

**重构原因：**
- 完全对齐设计规范，提升视觉一致性
- 组件职责内聚，输入相关的所有 UI 和状态都在一个组件内
- 更易复用到其他场景（如 Agent 详情页的快速输入）

## 设计方案

### 方案选择

**方案 A（已选择）：完全内聚到 ChatInputBar**

将图片预览行整合进 ChatInputBar 组件内部，形成完整的 Enhanced Input 卡片。

**优点：**
- 完全对齐 Pencil 设计（单一卡片容器，内部三层结构）
- 组件职责清晰，输入相关的所有 UI 和状态都在一个组件内
- 更容易复用到其他场景

**缺点：**
- 需要将 `pendingImages` 状态和 `setPendingImages` 通过 props 传入 ChatInputBar
- 组件 props 会增加

**备选方案（已拒绝）：**
- 方案 B：保持分离，但统一视觉风格 — 不符合"单一卡片"理念
- 方案 C：混合方案（渐进式）— 需要两次迭代，周期更长

## 组件结构

### 整体布局

```
┌─────────────────────────────────────┐
│  [图片预览行]  (条件渲染)            │ ← 有图片时显示
├─────────────────────────────────────┤
│  [文本输入行]                        │ ← 始终显示
├─────────────────────────────────────┤
│  [工具栏行]                          │ ← 始终显示
└─────────────────────────────────────┘
```

**容器样式：**
- `backgroundColor: '#111111'`（深灰卡片背景）
- `borderRadius: 10px`
- `borderWidth: 1px`，`borderColor: '#222222'`
- `padding: [12, 14]`（垂直 12px，水平 14px）
- 三层之间 `gap: 10px`（图片预览行与文本行）/ `gap: 8px`（文本行与工具栏）

### 三层结构

#### 1. 图片预览行（imgStrip）

- 水平滚动容器（`ScrollView horizontal`）
- 每个缩略图：52×52px，`cornerRadius: 8px`，边框 `#2A2A2A` 1px
- 缩略图间距：`gap: 8px`
- 右上角删除按钮（X 图标，16×16px 圆形背景 `#000000CC`）
- 上传中显示 "..." 遮罩（背景 `#00000099`），失败显示 "!" 遮罩（背景 `#FF444499`）
- 条件渲染：`pendingImages.length > 0` 时显示

#### 2. 文本输入行（textRow）

- `TextInput` 占满宽度（`flex: 1`）
- 右侧动作按钮（发送/语音/停止）：36×36px 圆形
- 行内 `gap: 8px`
- 占位符颜色：`#3A3A3A`（比当前的 `#555555` 更浅）
- 字体：Inter，14px（当前 15px）

#### 3. 工具栏行（toolRow）

- 左侧：附件按钮（ImagePlus 图标，22×22px）+ Commands 按钮（pill 样式）
- 右侧：字符计数（`{value.length} / 4096`）
- `justifyContent: 'space-between'`
- 附件按钮尺寸：36×36px（当前无明确尺寸）

## 组件接口

### Props 接口

```typescript
interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}

interface ChatInputBarProps {
  // 现有 props
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onPickImage: () => void;
  onOpenCommands: () => void;
  disabled: boolean;
  isAgentRunning: boolean;
  onStop: () => void;
  placeholder?: string;
  
  // 新增 props（图片预览）
  pendingImages: PendingImage[];
  onRemoveImage: (index: number) => void;
}
```

### 父组件（chat/[id].tsx）变更

**移除：**
- 独立的图片预览 ScrollView（第 429-459 行）
- `styles.ts` 中的 `previewRow`、`previewRowContent`、`thumbWrapper`、`thumb`、`thumbOverlay`、`thumbFailed`、`thumbOverlayText`、`removeBadge` 样式

**新增：**
- 传递 `pendingImages` 给 ChatInputBar
- 传递 `onRemoveImage` 回调：`(index) => setPendingImages((prev) => prev.filter((_, i) => i !== index))`

**保持不变：**
- `pendingImages` 状态管理仍在 chat/[id].tsx
- `pickImage` 函数逻辑不变
- 图片上传逻辑不变

## 视觉规范

### 颜色映射（对齐 Pencil 设计）

| 元素 | 当前颜色 | 新颜色 | 说明 |
|------|---------|--------|------|
| 外层容器背景 | `#1A1A1A` | `#111111` | 更深的卡片背景 |
| 外层容器边框 | 无 | `#222222` 1px | 新增边框 |
| 输入框表面背景 | `#252525` | 移除 | 不再需要内层背景 |
| 占位符文字 | `#555555` | `#3A3A3A` | 更浅的灰色 |
| 工具栏分隔线 | `#252525` | 移除 | 不再需要分隔线 |
| 缩略图边框 | 无 | `#2A2A2A` 1px | 新增 |
| 删除按钮背景 | 无 | `#000000CC` | 半透明黑色 |
| 上传中遮罩 | `#00000099` | 保持 | 半透明黑色 |
| 失败遮罩 | `#FF444499` | 保持 | 半透明红色 |

### 尺寸规范

| 元素 | 当前尺寸 | 新尺寸 | 说明 |
|------|---------|--------|------|
| 外层容器圆角 | 20px | 10px | 对齐 Pencil 设计 |
| 外层容器内边距 | 12px 16px | 12px 14px | 水平内边距减小 |
| 缩略图 | 64×64px | 52×52px | 对齐 Pencil 设计 |
| 缩略图圆角 | 8px | 8px | 保持 |
| 删除按钮 | 无明确尺寸 | 16×16px | 圆形，X 图标 8×8px |
| 发送按钮 | 34×34px | 36×36px | 略微增大 |
| 输入框字体 | 15px | 14px | 对齐 Pencil 设计 |
| 附件按钮 | 36×36px | 36×36px | 保持 |

### 间距规范

| 位置 | 间距 |
|------|------|
| 图片预览行与文本行 | 10px |
| 文本行与工具栏行 | 8px |
| 缩略图之间 | 8px |
| 文本输入与动作按钮 | 8px |

## 实施步骤

### 1. 重构 ChatInputBar 组件

**文件：** `mobile/src/features/chat/components/ChatInputBar.tsx`

**变更：**
- 新增 `pendingImages` 和 `onRemoveImage` props
- 移除 `container` 样式（原外层容器），新增 `card` 样式（单一卡片容器）
- 移除 `inputSurface` 样式（原内层背景）
- 新增图片预览行渲染逻辑（条件渲染）
- 调整文本输入行和工具栏行的布局（移除分隔线）
- 更新所有相关样式以对齐 Pencil 设计

**关键代码结构：**
```tsx
<View style={s.card}>
  {pendingImages.length > 0 && (
    <ScrollView horizontal style={s.imgStrip}>
      {pendingImages.map((img, idx) => (
        <View key={img.localUri} style={s.thumbWrapper}>
          <Image source={{ uri: img.localUri }} style={s.thumb} />
          {/* 上传状态遮罩 */}
          <Pressable style={s.removeBadge} onPress={() => onRemoveImage(idx)}>
            <X size={8} color="#FFFFFF" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )}
  
  <View style={s.textRow}>
    <TextInput ... />
    {/* 动作按钮 */}
  </View>
  
  <View style={s.toolbar}>
    {/* 工具栏内容 */}
  </View>
</View>
```

### 2. 更新父组件（chat/[id].tsx）

**变更：**
- 移除独立的图片预览 ScrollView（第 429-459 行）
- 传递 `pendingImages` 和 `onRemoveImage` 给 ChatInputBar
- 移除 `inputArea` 样式中的 `backgroundColor`（由 ChatInputBar 自己管理）

**关键代码：**
```tsx
<ChatInputBar
  value={input}
  onChangeText={handleInputChange}
  onSend={() => { void handleSend(); }}
  onPickImage={() => { void pickImage(); }}
  onOpenCommands={() => setCommandPopupVisible(true)}
  disabled={composerDisabled}
  isAgentRunning={isAgentRunning}
  onStop={() => { /* ... */ }}
  pendingImages={pendingImages}
  onRemoveImage={(idx) => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
/>
```

### 3. 清理样式文件（chat/styles.ts）

**移除：**
- `previewRow`
- `previewRowContent`
- `thumbWrapper`
- `thumb`
- `thumbOverlay`
- `thumbFailed`
- `thumbOverlayText`
- `removeBadge`

**保留：**
- `inputArea`（但移除 `backgroundColor`）

### 4. 更新测试

**文件：** `mobile/src/features/chat/components/ChatInputBar.test.tsx`

**新增测试用例：**
- 图片预览行条件渲染（有图片时显示，无图片时隐藏）
- 删除按钮点击触发 `onRemoveImage`
- 上传中/失败状态的遮罩显示
- 多图片滚动显示

**更新现有测试：**
- 快照测试（视觉结构变化）
- 样式断言（新的容器样式）

## 验证标准

### 视觉验证

- [ ] 外层容器：圆角 10px，背景 `#111111`，边框 `#222222` 1px
- [ ] 图片预览行：缩略图 52×52px，圆角 8px，边框 `#2A2A2A` 1px
- [ ] 删除按钮：16×16px 圆形，右上角定位
- [ ] 文本输入：占位符颜色 `#3A3A3A`，字体 14px
- [ ] 工具栏：左右布局，无分隔线
- [ ] 间距：图片行与文本行 10px，文本行与工具栏 8px

### 功能验证

- [ ] 图片选择后显示缩略图
- [ ] 点击删除按钮移除对应图片
- [ ] 上传中显示 "..." 遮罩
- [ ] 上传失败显示 "!" 遮罩
- [ ] 多图片水平滚动
- [ ] 无图片时预览行隐藏
- [ ] 发送消息后图片预览清空
- [ ] 禁用状态下所有交互不可用

### 测试验证

- [ ] 所有现有测试通过
- [ ] 新增测试覆盖图片预览功能
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test -- --watchAll=false` 通过

## 风险与权衡

### 风险

1. **组件 props 增加** — 新增 `pendingImages` 和 `onRemoveImage`，增加组件复杂度
   - **缓解措施：** 保持接口简洁，状态管理仍在父组件

2. **现有测试需要更新** — 视觉结构变化会导致快照测试失败
   - **缓解措施：** 先更新测试，再重构组件

3. **样式迁移可能遗漏** — 从 chat/styles.ts 迁移到 ChatInputBar.tsx 可能遗漏样式
   - **缓解措施：** 逐一对照 Pencil 设计，确保所有样式都已迁移

### 权衡

- **内聚 vs 灵活性** — 将图片预览整合进 ChatInputBar 提升了内聚性，但如果未来需要在其他地方单独使用图片预览，需要额外抽取组件
  - **决策：** 优先内聚性，未来如有需要再抽取

- **视觉一致性 vs 改动成本** — 完全对齐 Pencil 设计需要较大改动，但长期收益是视觉一致性
  - **决策：** 一次性完成重构，避免渐进式改动带来的多次迭代

## 未来扩展

- **语音输入** — 当前语音按钮为占位，未来实现时需要调整工具栏布局
- **更多附件类型** — 如文件、视频等，可能需要扩展 `PendingImage` 接口为更通用的 `PendingAttachment`
- **图片编辑** — 点击缩略图可能需要支持裁剪、旋转等编辑功能
- **拖拽排序** — 多图片时支持拖拽调整顺序

## 参考

- Pencil Enhanced Input 设计：`/Users/alan/Documents/codes/yakami0129/pencli/multisoul-ui.pen` 节点 `gzaoM`
- MultiSoul Design System：`mobile/docs/design.md`
- 当前 ChatInputBar 实现：`mobile/src/features/chat/components/ChatInputBar.tsx`
- 当前图片预览实现：`mobile/app/chat/[id].tsx` 第 429-459 行
