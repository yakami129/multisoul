# iOS 权限声明守护设计

**日期：** 2026-05-03  
**状态：** 已批准

---

## 背景与根因

`feat(chat): multi-image upload` 引入了 `expo-image-picker`，调用了 `launchImageLibraryAsync`。iOS 系统规定：任何读取相册的 API 调用前，`Info.plist` 必须声明 `NSPhotoLibraryUsageDescription`；若缺失，iOS 直接终止进程（crash），无任何弹窗或错误日志。

该 key 在引入模块时被遗漏，导致点击上传图片按钮必崩。

---

## 目标

1. **R12**：在 pre-commit + CI 双层拦截「Expo 原生权限模块已安装，但 `Info.plist` 缺少对应 `NSXxxUsageDescription`」的情况。
2. **expo-doctor 接入**：在 CI `mobile-check` job 里加入 `expo-doctor` 检查，捕获 deps 版本漂移、Metro 配置问题、app.json schema 错误；同时修复当前已有的 3 个 warning。

---

## R12：`check-ios-permissions.sh`

### 映射表

| Expo 模块 | 必须存在的 plist key |
|---|---|
| `expo-image-picker` | `NSPhotoLibraryUsageDescription` |
| `expo-camera` | `NSCameraUsageDescription` |
| `expo-location` | `NSLocationWhenInUseUsageDescription` |
| `expo-media-library` | `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` |
| `expo-contacts` | `NSContactsUsageDescription` |
| `expo-calendar` | `NSCalendarsUsageDescription` |
| `expo-audio` | `NSMicrophoneUsageDescription` |
| `expo-speech-recognition` | `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` |

`expo-notifications` 无需 `UsageDescription`（走 APNs 授权，不在此检查范围内）。

### 脚本逻辑

```
输入：mobile/package.json（dependencies + devDependencies）
      mobile/ios/MultiSoul/Info.plist

步骤：
1. 从 package.json 提取所有已安装包名
2. 对映射表中每个 Expo 模块，若包名存在：
   a. 检查 Info.plist 是否包含每个必要的 NSXxxUsageDescription key
   b. 若缺失：输出错误行，记录 fail=1
3. 若 fail=1：exit 1
```

### 触发条件

| 层 | 触发条件 | 行为 |
|---|---|---|
| pre-commit | staged 文件含 `mobile/package.json` 或 `mobile/ios/**` | 运行脚本，失败则拒绝 commit |
| CI `repo-checks` | 无条件，全量 | 运行脚本，失败则阻塞 merge |

### 加新模块时的维护规范

新引入需要原生权限的 Expo 模块时：
1. 在 `scripts/check-ios-permissions.sh` 的映射表中添加对应条目
2. 在 `ios/MultiSoul/Info.plist` 添加对应的 `NSXxxUsageDescription`
3. 在 `docs/quality/mechanized-constraints.md` 的 R12 小节更新映射表

---

## expo-doctor 接入

### 接入位置

CI `mobile-check` job 中，在 `pnpm install` 之后、`pnpm typecheck` 之前，增加：

```yaml
- name: expo-doctor
  run: cd mobile && npx expo-doctor
```

`expo-doctor` 退出码非 0 时 job fail，阻塞 merge。

**不放入 pre-commit**：`npx` 会触发网络请求下载包，首次运行较慢，不适合本地每次 commit。

### 预修复现有 3 个 Warning

在接入前需先清零现有 warning，避免 CI 接入后立即失败：

| Warning | 修复方式 |
|---|---|
| `app.json` 有 `newArchEnabled` 额外字段 | 将其移入 `expo.newArchEnabled`（或删除，`Info.plist` 已有 `RCTNewArchEnabled: true`） |
| `expo-asset` peer dep 缺失（被 `expo-audio` 依赖） | `pnpm add expo-asset` |
| `expo`、`expo-notifications`、`react-native-gesture-handler` 版本漂移 | `npx expo install expo@~55.0.19 expo-notifications@~55.0.22`；`react-native-gesture-handler` minor 漂移（2.31.1 vs ~2.30.0）可通过 `expo.install.exclude` 豁免或升级 |

---

## mechanized-constraints.md 更新

在 `docs/quality/mechanized-constraints.md` 增加 **R12** 小节，格式与现有规则一致，包含：脚本路径、起因、检测方式、修复方式、映射表。

---

## 文件变更清单

| 文件 | 操作 |
|---|---|
| `scripts/check-ios-permissions.sh` | 新建 |
| `.husky/pre-commit` | 在 `staged_mobile` 分支增加条件调用 |
| `.github/workflows/ci.yml` | `repo-checks` job 增加一步 |
| `.github/workflows/ci.yml` | `mobile-check` job 增加 `expo-doctor` 步骤 |
| `mobile/package.json` | `pnpm add expo-asset`；可能调整版本 |
| `mobile/app.json` | 修复 `newArchEnabled` 位置 |
| `docs/quality/mechanized-constraints.md` | 增加 R12 小节 |
| `docs/design-docs/index.json` | 注册本文档 |
