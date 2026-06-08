# Idea 快速采集与附件支持 SPEC

## 1. 背景与目标

当前 New Idea 的 Add Link / Add Log / Add Screenshot 按钮是占位符，点击后只创建空附件项，无法采集真实内容。用户希望通过 **iOS 系统分享** 低成本捕捉截图、URL，快速创建 Idea；同时在 App 内简化附件流程，保留核心的截图采集能力。

**目标**：
- iOS 系统分享直达 MultiSoul，快速创建 Idea
- 编辑器去除 Link / Log 按钮，只保留 Image 采集
- 图片附件支持选图、拍照、压缩上传
- 编辑器完成后跳转到 Ideas 列表

---

## 2. 范围

### 2.1 In Scope

| 模块 | 内容 |
|------|------|
| **iOS Share Extension** | 接受图片（仅取第一张）、URL，打开 New Idea 编辑器预填附件 |
| **编辑器简化** | 去除 Add Link / Add Log 按钮；保留 Add Screenshot（选图 + 拍照） |
| **图片上传** | 复用 Chat 上传逻辑（`POST /api/v1/uploads`，客户端压缩 ≤2MB JPEG） |
| **附件列表** | 显示缩略图、kind、删除按钮；URL 附件显示 host |
| **错误处理** | 上传失败显示 inline 错误 + 重试；删除支持滑动删除（iOS 标准） |
| **URL 校验** | 仅允许 http(s) scheme |
| **分享后跳转** | New Idea 编辑器 → Done → Specs Tab Ideas 列表 |

### 2.2 Out of Scope

- 纯文本分享（需要时手动粘贴到 Body）
- 文档/文件分享（PDF、.log 等）
- 多图分享时全部添加（V1 仅取第一张）
- 剪贴板自动检测链接
- 附件批量选择/批量删除
- Share Extension 内显示 Target 选择器

---

## 3. 用户场景与流程

### 3.1 场景 A：截图后分享（最关键验收场景）

```
1. 用户截图
2. 点击分享按钮，选择 MultiSoul
3. 打开 New Idea 编辑器
4. 图片附件已预填（显示缩略图）
5. 用户补充文字描述（可选）
6. 点击 Done 保存
7. 跳转到 Specs Tab Ideas 列表，看到新建 Idea
```

### 3.2 场景 B：Safari URL 分享

```
1. Safari 点击分享按钮
2. 选择 MultiSoul
3. 打开 New Idea 编辑器
4. URL 附件已预填（显示 host）
5. 用户补充上下文文字
6. Done 保存 → Ideas 列表
```

### 3.3 场景 C：App 内选图

```
1. Specs Tab 首页
2. 点击 "Image" mini action（Link/Log 已去除）
3. 弹出照片选择器（选相册图或拍照）
4. 选定后打开 New Idea 编辑器，预填图片
5. Done 保存 → Ideas 列表
```

---

## 4. 数据模型与接口

### 4.1 SpecIdeaAttachment（已有字段复用）

```typescript
interface SpecIdeaAttachment {
  id: string;
  kind: 'link' | 'image';
  title?: string;
  uri?: string;        // link: URL, image: file_id or local path
  fileId?: string;     // image: upload 后的 file_id
  createdAt: number;
}
```

### 4.2 新增 REST 端点

**Idea 附件上传**
```
POST /api/v1/ideas/:id/attachments
Authorization: Bearer <token>
Content-Type: multipart/form-data
Body: file (image/jpeg | image/png, ≤2MB after compression)
Response 201: { attachment_id: string, file_id: string, uri: string }
Response 413: 文件过大
Response 415: 不支持的媒体类型
```

### 4.3 复用端点

- `POST /api/v1/uploads` — 复用 Chat 图片上传
- `POST /api/v1/spec-ideas` — 创建 Idea（已有，扩展支持 `attachments` 字段）

---

## 5. iOS Share Extension

### 5.1 Info.plist 配置

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.share-services</string>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>NSExtensionActivationRule</key>
    <dict>
      <key>NSExtensionActivationSupportsImageWithMaxCount</key>
      <integer>1</integer>
      <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
      <integer>1</integer>
    </dict>
  </dict>
</dict>
```

### 5.2 分享处理逻辑

| 分享类型 | 行为 |
|----------|------|
| 单张图片 | 获取 UIImage → 压缩 ≤2MB → 临时保存 → 打开主 App → 传入 image 路径 |
| URL | 获取 NSURL.absoluteString → 校验 http(s) → 打开主 App → 传入 URL |
| 同时有图和 URL | 优先图片（仅取第一张） |
| 多图 | 仅取第一张 |
| 纯文本 | 不处理（不显示在分享列表） |

### 5.3 主 App 接收参数

```typescript
// App 启动/唤醒时解析 URL scheme
// multisoul://new-idea?type=image&path=temp/xxx.jpg
// multisoul://new-idea?type=link&url=https://example.com
```

---

## 6. UI/UX 需求

### 6.1 Specs Home 首页

**Mini Actions 简化**
```diff
- Link (remove)
- Log (remove)
  Text (保留)
  Image (保留)
```

**Image mini action**
- 点击 → 弹出 `expo-image-picker` ActionSheet（选相册 / 拍照）
- 选定后打开 `IdeaEditorSheet`，预填图片附件

### 6.2 IdeaEditorSheet

**Attachments Section 简化**
```diff
- Add Link button (remove)
- Add Log Snippet button (remove)
  Add Screenshot button (保留，支持选图/拍照)
  附件列表（新增交互）
```

**附件列表**
- 图片：左侧 48×48 圆角缩略图，中间文件名/时间戳，右侧状态
- Link：Link 图标，中间 host 名，右侧删除
- 状态：上传中（spinner）、失败（红色 error icon + 重试按钮）、成功（无标记）

**删除交互**
- 附件行支持向右滑动删除（iOS 标准 swipe-to-delete）
- 显示 Delete 红色背景按钮

**上传失败状态**
```typescript
type AttachmentStatus = 'pending' | 'uploading' | 'done' | 'error';

// 失败时显示：
// [error icon] Upload failed  [Retry button]
```

### 6.3 附件详情（Idea Detail）

- 图片附件：点击全屏预览
- Link 附件：点击用 `Linking.openURL` 打开

---

## 7. 边界情况

| 场景 | 预期行为 |
|------|----------|
| 分享时无网络 | 图片先本地暂存，编辑器显示 "Upload pending"，有网络后自动上传 |
| 图片 >2MB | 客户端压缩至 ≤2MB JPEG；压缩后仍 >2MB 提示 "Image too large" |
| 上传失败 | 附件行显示 error icon + "Retry"，点击重试；Done 保存时提醒有失败附件 |
| 无效的 URL | 校验非 http(s) 时过滤，不添加附件 |
| 分享后杀 App | 下次启动时检查是否有未完成的分享意图，恢复编辑器 |
| 删除正在上传的附件 | 取消上传请求，从列表移除 |

---

## 8. 非功能性需求

| 项 | 要求 |
|----|------|
| 图片压缩 | ≤2MB JPEG，质量 0.8，复用 Chat 压缩逻辑 |
| 上传并发 | 单附件串行，多附件按添加顺序排队 |
| 本地缓存 | 未上传成功的图片保留在 App 沙盒，下次打开编辑器时恢复 |
| Share Extension | 冷启动到主 App < 1s，内存占用 < 50MB |

---

## 9. 验收标准

### 9.1 关键场景（按优先级）

| # | 场景 | 验收标准 |
|---|------|----------|
| 1 | **截图分享到 MultiSoul 并保存** | 截图 → 分享 → 选 MultiSoul → 编辑器有缩略图 → Done → Ideas 列表出现该 Idea |
| 2 | Safari URL 分享并显示 host | Safari 分享 → 编辑器 URL 附件行显示域名 → Done 保存 |
| 3 | App 内选图显示缩略图 | 首页 Image → 选图 → 编辑器显示 48×48 缩略图 → Done |
| 4 | 上传失败重试成功 | 断网时选图 → 显示 error → 恢复网络 → 点击 Retry → 上传成功 |

### 9.2 Checklist

- [ ] Share Extension 在 iOS 分享列表显示
- [ ] Share Extension 仅接受图片和 URL
- [ ] 编辑器去除 Link / Log 按钮
- [ ] Add Screenshot 支持相册选图和拍照
- [ ] 图片压缩 ≤2MB JPEG 后上传
- [ ] 附件列表支持滑动删除
- [ ] 上传失败显示 inline error + 重试
- [ ] URL 仅允许 http(s)
- [ ] Done 后跳转 Specs Tab Ideas 列表
- [ ] Idea Detail 可预览图片附件

---

## 10. 风险与权衡

| 风险 | 缓解策略 |
|------|----------|
| Share Extension 内存限制 | 图片压缩在主 App 完成，Extension 只做传递 |
| 多图分享需求 | V1 仅取第一张，明确告知用户，后续版本支持多附件 |
| 上传失败数据丢失 | 本地沙盒保留未上传文件，下次进入编辑器时恢复 |
| URL scheme 冲突 | 使用 `multisoul://` 自定义 scheme，避免常见前缀 |

---

*创建于 2026-06-07，采访会话 dfa5648b-3082-4cc4-bbe3-1ac0338bdea7*
