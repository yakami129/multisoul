# iOS 发布指南（EAS Build + TestFlight）

## 前提条件

- Apple Developer 账号（$99/年）：[developer.apple.com](https://developer.apple.com)
- Expo 账号：[expo.dev](https://expo.dev)
- EAS CLI：`npm install -g eas-cli`

---

## 配置说明

| 文件 | 关键字段 |
|------|---------|
| `app.json` | `ios.bundleIdentifier = com.yakami0129.multisoul` |
| `app.json` | `extra.eas.projectId = 3555d4e1-4ac3-4e0c-9816-4383af1872e9` |
| `eas.json` | `build.production`、`submit.production` |

`eas.json` 的 `submit.production.ios` 中需填入：

```json
{
  "appleId": "your-apple-id@example.com",
  "ascAppId": "App Store Connect 中的 Apple ID（数字）",
  "appleTeamId": "Apple Developer Team ID"
}
```

---

## 发布流程

### 第一步：登录

```bash
cd mobile
eas login
```

### 第二步：构建生产包

```bash
eas build --platform ios --profile production
```

- 首次运行会引导配置证书，选 **Automatically manage credentials**
- 构建约 15-20 分钟，在 EAS 云端完成（无需 Mac/Xcode）

### 第三步：提交到 TestFlight

```bash
eas submit --platform ios --profile production --latest
```

提交后苹果会进行审核（通常几小时～1 天）。

### 第四步：邀请测试者

1. 登录 [App Store Connect](https://appstoreconnect.apple.com)
2. 选择 App → **TestFlight**
3. 邀请测试者（发邮件），最多支持 10,000 人

---

## 后续更新

每次发新版本只需重复第二、三步：

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

记得先在 `app.json` 中更新 `version` 字段。
