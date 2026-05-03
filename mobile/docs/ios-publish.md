# iOS 发布指南

## 本地发布（本机 Xcode，日常推荐）

在仓库中于 **`mobile` 目录执行一条命令** 即可走完本地打包（及可选上传）；脚本内已包含 `pnpm install`、`pod install`、Xcode archive / export 等步骤，**无需**再单独执行 `eas login` 或把 `pnpm typecheck` 当作发布流程的固定前置（合并前质量闸仍以 `CLAUDE.md` / AGENTS 中的验证表为准）。

```bash
cd mobile
./scripts/publish-ios-local.sh
```

- **仅构建 IPA**：`./scripts/publish-ios-local.sh --build-only`
- **仅上传已有 IPA**：`./scripts/publish-ios-local.sh --submit-only --ipa=/path/to/MultiSoul.ipa`
- **上传 App Store Connect** 所需 API Key 环境变量、签名与 workspace 说明：见 [`scripts/publish-ios-local.sh`](../scripts/publish-ios-local.sh) 文件头注释。

须在 **macOS** 上运行，且本机已安装 Xcode / CocoaPods 等脚本会检查的工具链。

---

## 云端发布（EAS Build + TestFlight）

以下流程在 Expo 云端构建，不依赖本机完整 Xcode 工程（与本地脚本二选一或按需混用）。

### 前提条件

- Apple Developer 账号（$99/年）：[developer.apple.com](https://developer.apple.com)
- Expo 账号：[expo.dev](https://expo.dev)
- EAS CLI：`npm install -g eas-cli`

---

### 配置说明

| 文件 | 关键字段 |
|------|---------|
| `app.json` | `ios.bundleIdentifier = com.yakami0129.multisoul` |
| `app.json` | `extra.eas.projectId = 3555d4e1-4ac3-4e0c-9816-4383af1872e9` |
| `eas.json` | `build.production.autoIncrement = true`、`submit.production` |

`eas.json` 的 `submit.production.ios` 中需填入：

```json
{
  "appleId": "your-apple-id@example.com",
  "ascAppId": "App Store Connect 中的 Apple ID（数字）",
  "appleTeamId": "Apple Developer Team ID"
}
```

---

### 发布流程

#### 第一步：登录

```bash
cd mobile
eas login
```

#### 第二步：构建生产包

```bash
eas build --platform ios --profile production
```

- 首次运行会引导配置证书，选 **Automatically manage credentials**
- 构建约 15-20 分钟，在 EAS 云端完成（无需 Mac/Xcode）

#### 第三步：提交到 TestFlight

```bash
eas submit --platform ios --profile production --latest
```

提交后苹果会进行审核（通常几小时～1 天）。

#### 第四步：邀请测试者

1. 登录 [App Store Connect](https://appstoreconnect.apple.com)
2. 选择 App → **TestFlight**
3. 邀请测试者（发邮件），最多支持 10,000 人

---

### 一键脚本（云端）

```bash
cd mobile
./scripts/publish-ios.sh
```

等价于按仓库脚本封装好的 EAS 构建 + 提交流程（见脚本内说明）。

---

### 后续更新

每次发新版本只需重复第二、三步：

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

同一个 `version` 下每次提交都需要不同的 iOS build number，`eas.json` 中的 `build.production.autoIncrement = true` 会在生产构建时自动递增。发布新的 App Store 版本时，再在 `app.json` 中更新 `version` 字段。
