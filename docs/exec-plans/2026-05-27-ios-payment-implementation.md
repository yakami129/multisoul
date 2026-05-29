# iOS 付费机制实施计划

**创建日期**: 2026-05-27  
**更新日期**: 2026-05-27  
**目标**: 为 MultiSoul iOS 应用添加 14 天试用 + $12.99 买断制付费机制，并成功上架 App Store  
**参考规格**: `docs/product-specs/SPEC-ios-payment.md`

---

## 实施概览

**总体策略**: 一次性完成所有步骤（RevenueCat 集成 → IAP 配置 → Mobile 开发 → TestFlight 测试 → App Store 审核）

**核心付费模式**:
- **免费版**: 用户需要自己配置内网穿透（Tailscale/ngrok 等）才能让 iOS 连接到本地 msctl serve
- **付费版**: msctl 自动通过 Cloudflare Tunnel 建立隧道，iOS 直接连接隧道地址，无需配置
- **试用期**: 14 天内可以使用自动隧道，到期后必须付费或切换回自建内网穿透

**关键决策**:
- 试用期：14 天（从**首次成功连接自动隧道**时开始计时）
- 买断价格：$12.99
- 试用到期行为：自动隧道不可用，需要付费或切换到自建内网穿透
- 付费验证：仅在 iOS 端验证（方案 A - 快速上线）
- 中继实现：**Cloudflare Tunnel（MVP 阶段）** - msctl 自动启动 cloudflared，iOS 连接隧道地址
- 隧道地址分发：通过轻量状态服务（Cloudflare Workers KV）
- 免费版体验：显示自动隧道选项但置灰 + 付费提示
- 连接方式：付费用户默认使用自动隧道
- 本地存储：缓存付费状态（trial_start_time + is_paid + last_checked_at）
- UI 风格：极简（价格 + 购买按钮 + 恢复购买）

---

## 阶段 1: RevenueCat 账号注册与配置

### 1.1 注册 RevenueCat 账号
- [ ] 访问 https://app.revenuecat.com/signup
- [ ] 使用开发者邮箱注册账号
- [ ] 验证邮箱并登录

### 1.2 创建 iOS 应用项目
- [ ] 在 RevenueCat Dashboard 创建新项目
- [ ] 项目名称：`MultiSoul`
- [ ] 平台：iOS
- [ ] Bundle ID：与 App Store Connect 中的一致（从 `mobile/app.json` 获取）

### 1.3 配置 App Store Connect 集成
- [ ] 在 App Store Connect 生成 In-App Purchase Key
  - 登录 https://appstoreconnect.apple.com
  - Users and Access → Keys → In-App Purchase
  - 生成新 Key 并下载 `.p8` 文件
  - 记录 Key ID 和 Issuer ID
- [ ] 在 RevenueCat 中上传 App Store Connect API Key
  - Dashboard → Project Settings → Apple App Store
  - 上传 `.p8` 文件，填写 Key ID 和 Issuer ID

### 1.4 获取 RevenueCat API Key
- [ ] 在 RevenueCat Dashboard → API Keys 获取 iOS API Key
- [ ] 记录 API Key（格式：`appl_xxxxxxxxxx`）
- [ ] 将 API Key 添加到 `mobile/.env` 或安全存储（不提交到 Git）

**验收标准**:
- RevenueCat Dashboard 显示 iOS 应用已连接
- API Key 已安全存储

---

## 阶段 2: App Store Connect IAP 产品配置

### 2.1 创建 IAP 产品
- [ ] 登录 App Store Connect
- [ ] 进入 MultiSoul 应用 → Features → In-App Purchases
- [ ] 点击 "+" 创建新产品
  - 类型：**Non-Consumable**（买断制）
  - Product ID：`multisoul_lifetime_unlock`（建议命名）
  - Reference Name：`MultiSoul Lifetime Unlock`
  - Price：$12.99（Tier 13）

### 2.2 填写本地化信息
- [ ] 添加英文本地化
  - Display Name：`Lifetime Access`
  - Description：`Unlock all features of MultiSoul with a one-time purchase. No subscription required.`
- [ ] 添加中文本地化（可选）
  - Display Name：`终身访问`
  - Description：`一次性购买解锁 MultiSoul 所有功能，无需订阅。`

### 2.3 提交 IAP 产品审核
- [ ] 上传产品截图（可选，但建议提供）
- [ ] 点击 "Submit for Review"
- [ ] 等待 Apple 审核通过（通常 24-48 小时）

**验收标准**:
- IAP 产品状态为 "Ready to Submit" 或 "Waiting for Review"
- Product ID 已记录：`multisoul_lifetime_unlock`

---

## 阶段 3: RevenueCat 产品与 Entitlement 配置

### 3.1 在 RevenueCat 中创建 Product
- [ ] RevenueCat Dashboard → Products
- [ ] 点击 "Add Product"
  - Product ID：`multisoul_lifetime_unlock`（与 App Store Connect 一致）
  - Type：Non-Consumable
  - Store：Apple App Store

### 3.2 创建 Entitlement
- [ ] RevenueCat Dashboard → Entitlements
- [ ] 点击 "Add Entitlement"
  - Identifier：`pro`（代码中会检查此标识）
  - Display Name：`Pro Access`
- [ ] 将 `multisoul_lifetime_unlock` 产品关联到 `pro` Entitlement

### 3.3 创建 Offering（可选但推荐）
- [ ] RevenueCat Dashboard → Offerings
- [ ] 创建 Default Offering
  - Package Type：Lifetime
  - Product：`multisoul_lifetime_unlock`

**验收标准**:
- RevenueCat 中 Product、Entitlement、Offering 配置完成
- Entitlement ID 确认为 `pro`

---

## 阶段 4: Mobile 端集成 RevenueCat SDK

### 4.1 安装依赖
```bash
cd mobile
pnpm add react-native-purchases
cd ios && pod install && cd ..
```

### 4.2 配置 iOS 权限
- [ ] 编辑 `mobile/ios/MultiSoul/Info.plist`，添加：
```xml
<key>SKAdNetworkItems</key>
<array>
  <!-- RevenueCat 推荐的 SKAdNetwork IDs -->
</array>
```

### 4.3 创建 RevenueCat 配置模块
- [ ] 创建 `mobile/src/services/revenuecat.ts`
  - 初始化 SDK：`Purchases.configure({ apiKey })`
  - 导出 `initRevenueCat()` 函数
  - 导出 `checkSubscriptionStatus()` 函数
  - 导出 `purchasePackage()` 函数
  - 导出 `restorePurchases()` 函数

### 4.4 在 App 启动时初始化
- [ ] 编辑 `mobile/app/_layout.tsx`
  - 在 `useEffect` 中调用 `initRevenueCat()`
  - 处理初始化错误

**验收标准**:
- `pnpm typecheck` 通过
- 运行 `pnpm ios`，控制台显示 RevenueCat SDK 初始化成功

---

## 阶段 5: Cloudflare Tunnel 集成（msctl 端）

**技术方案**: msctl 在 `--relay` 模式下自动启动 cloudflared，建立隧道并上报地址到状态服务

### 5.1 msctl 集成 cloudflared
- [ ] 在 `cli/src/commands/serve.rs` 添加 `--relay` 参数
- [ ] 实现 cloudflared 自动启动逻辑：
  ```rust
  // 伪代码
  if args.relay {
      let tunnel_url = spawn_cloudflared(local_port).await?;
      report_tunnel_url(config.user_token, tunnel_url).await?;
  }
  ```
- [ ] cloudflared 二进制分发策略：
  - **选项 A**：要求用户自行安装 cloudflared（文档说明）
  - **选项 B**：msctl 首次运行时自动下载 cloudflared（推荐）
  - **选项 C**：将 cloudflared 打包进 msctl 发行版

### 5.2 创建隧道地址状态服务（Cloudflare Workers KV）
- [ ] 创建 Cloudflare Worker：`multisoul-tunnel-state`
- [ ] 实现两个端点：
  ```typescript
  // POST /tunnel — msctl 上报隧道地址
  // Body: { user_token, tunnel_url }
  // 存储到 KV: user_token → { tunnel_url, updated_at }
  
  // GET /tunnel/:user_token — iOS App 获取隧道地址
  // 返回: { tunnel_url, status: "active" }
  ```
- [ ] 设置 KV TTL：30 分钟（msctl 断开后自动清理）
- [ ] 部署到 `tunnel.multisoul.app`

### 5.3 msctl 心跳保活
- [ ] msctl 每 5 分钟向状态服务发送心跳（更新 `updated_at`）
- [ ] cloudflared 进程退出时，msctl 清理状态（DELETE `/tunnel/:user_token`）

**验收标准**:
- msctl serve --relay 启动后，cloudflared 自动建立隧道
- 隧道地址成功上报到 Cloudflare Workers KV
- iOS App 可以通过 `GET /tunnel/:user_token` 获取隧道地址并连接

---

## 阶段 6: iOS 端隧道地址获取

---

## 阶段 6: iOS 端隧道地址获取

### 6.1 创建隧道地址获取服务
- [ ] 创建 `mobile/src/services/tunnelService.ts`
  - `fetchTunnelUrl(userToken)`: 从状态服务获取隧道地址
  - 轮询策略：每 10 秒查询一次，最多重试 30 次（5 分钟超时）
  - 缓存隧道地址到内存（不持久化，因为 msctl 重启后地址会变）

### 6.2 连接流程集成
- [ ] 在连接设置页面添加"Auto Tunnel"选项
  - 试用期内或已付费：显示"Connecting to auto tunnel..."
  - 点击连接时：
    1. 调用 `fetchTunnelUrl(userToken)` 获取隧道地址
    2. 连接成功后，记录 `trial_start_time`（首次连接时）
    3. 显示连接状态："Connected via auto tunnel"

### 6.3 错误处理
- [ ] 隧道地址获取超时（5 分钟）：提示"msctl serve --relay 未启动"
- [ ] 隧道连接失败：提示"隧道不可用，请检查 msctl 状态"

**验收标准**:
- iOS App 可以成功获取 msctl 上报的隧道地址
- 连接隧道后可以正常发送请求和接收 WebSocket 消息

---

## 阶段 7: 试用期管理实现

### 6.1 创建本地数据库表
- [ ] 编辑 `mobile/src/db/schema.ts`（或等效文件）
  - 创建 `payment_status` 表
  - 字段：`trial_start_time`, `is_paid`, `last_checked_at`

### 6.2 实现试用期逻辑
- [ ] 创建 `mobile/src/features/payment/trialManager.ts`
  - `startTrial()`: 记录试用开始时间（首次连接 msctl serve 时调用）
  - `getTrialStatus()`: 返回 `{ isTrialActive, daysRemaining }`
  - `isTrialExpired()`: 检查是否超过 14 天

### 6.3 集成到连接流程
- [ ] 在首次成功连接**中继服务器**时调用 `startTrial()`
  - 位置：`mobile/src/features/settings/` 或连接成功回调
  - 仅在 `trial_start_time` 为空时记录（不重复计时）

**验收标准**:
- 首次连接后，数据库中 `trial_start_time` 已记录
- `getTrialStatus()` 返回正确的剩余天数

---

## 阶段 7: 试用期管理实现

### 7.1 创建本地数据库表
- [ ] 编辑 `mobile/src/db/schema.ts`（或等效文件）
  - 创建 `payment_status` 表
  - 字段：`trial_start_time`, `is_paid`, `last_checked_at`

### 7.2 实现试用期逻辑
- [ ] 创建 `mobile/src/features/payment/trialManager.ts`
  - `startTrial()`: 记录试用开始时间（首次连接自动隧道时调用）
  - `getTrialStatus()`: 返回 `{ isTrialActive, daysRemaining }`
  - `isTrialExpired()`: 检查是否超过 14 天

### 7.3 集成到连接流程
- [ ] 在首次成功连接**自动隧道**时调用 `startTrial()`
  - 位置：`mobile/src/services/tunnelService.ts` 连接成功回调
  - 仅在 `trial_start_time` 为空时记录（不重复计时）

**验收标准**:
- 首次连接自动隧道后，数据库中 `trial_start_time` 已记录
- `getTrialStatus()` 返回正确的剩余天数

---

## 阶段 8: 付费状态检查与访问控制

### 7.1 实现付费状态同步
- [ ] 创建 `mobile/src/features/payment/paymentStatus.ts`
  - `syncPaymentStatus()`: 调用 RevenueCat SDK 检查 `entitlements.active['pro']`
  - 更新本地数据库 `is_paid` 和 `last_checked_at`
  - 返回 `{ isPaid: boolean }`

### 7.2 在 App 启动时检查
- [ ] 编辑 `mobile/app/_layout.tsx`
  - 在 RevenueCat 初始化后调用 `syncPaymentStatus()`
  - 每次启动时同步一次

### 7.3 实现连接方式控制逻辑
- [ ] 创建 `mobile/src/features/payment/accessControl.ts`
  - `canUseRelayServer()`: 检查是否可以使用中继服务器
    - 逻辑：`(isTrialActive || isPaid) === true`
  - `getServerUrl()`: 返回应该使用的服务器地址
    - 试用期内或已付费：返回中继服务器地址
    - 试用到期且未付费：返回 `null`（需要自建内网穿透）

**验收标准**:
- 试用期内：`canUseRelayServer()` 返回 `true`
- 试用到期且未付费：`canUseRelayServer()` 返回 `false`
- 已付费：`canUseRelayServer()` 返回 `true`

---

## 阶段 8: 付费状态检查与访问控制

### 8.1 实现付费状态同步
- [ ] 创建 `mobile/src/features/payment/paymentStatus.ts`
  - `syncPaymentStatus()`: 调用 RevenueCat SDK 检查 `entitlements.active['pro']`
  - 更新本地数据库 `is_paid` 和 `last_checked_at`
  - 返回 `{ isPaid: boolean }`

### 8.2 在 App 启动时检查
- [ ] 编辑 `mobile/app/_layout.tsx`
  - 在 RevenueCat 初始化后调用 `syncPaymentStatus()`
  - 每次启动时同步一次

### 8.3 实现访问控制逻辑
- [ ] 创建 `mobile/src/features/payment/accessControl.ts`
  - `canUseAutoTunnel()`: 检查是否可以使用自动隧道
    - 逻辑：`(isTrialActive || isPaid) === true`
  - `getConnectionMode()`: 返回应该使用的连接模式
    - 试用期内或已付费：返回 `"auto_tunnel"`
    - 试用到期且未付费：返回 `"manual"`（需要自建内网穿透）

**验收标准**:
- 试用期内：`canUseAutoTunnel()` 返回 `true`
- 试用到期且未付费：`canUseAutoTunnel()` 返回 `false`
- 已付费：`canUseAutoTunnel()` 返回 `true`

---

## 阶段 9: 购买页面 UI 实现

### 8.1 创建购买页面组件
- [ ] 创建 `mobile/src/features/payment/PurchaseScreen.tsx`
  - 极简设计：
    - 标题："Unlock MultiSoul"
    - 副标题："Use relay server without manual setup"
    - 价格显示：`$12.99`（从 RevenueCat Offering 动态获取）
    - 购买按钮："Purchase"
    - 恢复购买按钮："Restore Purchase"（底部小字链接）
  - 遵循 `mobile/docs/design.md` 设计规范
    - 背景色：`#0D0D0D`
    - 卡片背景：`#1A1A1A`
    - 主按钮：`#FF6B35`
    - 文字：`#FFFFFF`

### 8.2 实现购买逻辑
- [ ] 在 "Purchase" 按钮点击时：
  - 调用 `purchasePackage(offering.lifetime)`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()` 更新本地状态
  - 导航回主页面

### 8.3 实现恢复购买逻辑
- [ ] 在 "Restore Purchase" 按钮点击时：
  - 调用 `restorePurchases()`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()`
  - 失败时显示 Toast："未找到购买记录"

### 8.4 错误处理
- [ ] 购买失败时显示 Toast："购买失败，请重试"
- [ ] 用户取消购买时不显示错误（静默处理）

**验收标准**:
- 购买页面 UI 符合设计规范
- 点击购买按钮触发 Apple IAP 流程
- 恢复购买功能正常工作

---

## 阶段 9: 购买页面 UI 实现

### 9.1 创建购买页面组件
- [ ] 创建 `mobile/src/features/payment/PurchaseScreen.tsx`
  - 极简设计：
    - 标题："Unlock MultiSoul"
    - 副标题："Auto tunnel without manual setup"
    - 价格显示：`$12.99`（从 RevenueCat Offering 动态获取）
    - 购买按钮："Purchase"
    - 恢复购买按钮："Restore Purchase"（底部小字链接）
  - 遵循 `mobile/docs/design.md` 设计规范
    - 背景色：`#0D0D0D`
    - 卡片背景：`#1A1A1A`
    - 主按钮：`#FF6B35`
    - 文字：`#FFFFFF`

### 9.2 实现购买逻辑
- [ ] 在 "Purchase" 按钮点击时：
  - 调用 `purchasePackage(offering.lifetime)`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()` 更新本地状态
  - 导航回主页面

### 9.3 实现恢复购买逻辑
- [ ] 在 "Restore Purchase" 按钮点击时：
  - 调用 `restorePurchases()`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()`
  - 失败时显示 Toast："未找到购买记录"

### 9.4 错误处理
- [ ] 购买失败时显示 Toast："购买失败，请重试"
- [ ] 用户取消购买时不显示错误（静默处理）

**验收标准**:
- 购买页面 UI 符合设计规范
- 点击购买按钮触发 Apple IAP 流程
- 恢复购买功能正常工作

---

## 阶段 10: 连接方式 UI 实现

### 9.1 创建连接设置页面
- [ ] 编辑 `mobile/src/features/settings/SettingsScreen.tsx`
  - 添加 "Connection" 区域
  - 显示当前连接方式：
    - 试用期内或已付费：显示 "Relay Server (Active)"
    - 试用到期且未付费：显示 "Custom Server (Manual Setup Required)"

### 9.2 实现中继服务器选项
- [ ] 添加 "Use Relay Server" 选项
  - 试用期内或已付费：显示为可选状态，默认选中
  - 试用到期且未付费：显示为置灰状态 + 锁定图标
  - 点击置灰选项时弹窗："Relay server requires purchase"

### 9.3 实现自定义服务器选项
- [ ] 添加 "Custom Server" 输入框
  - 所有用户都可以使用
  - 输入自建内网穿透地址（如 Tailscale URL）
  - 保存到本地配置

### 9.4 添加试用期倒计时
- [ ] 在设置页面顶部显示试用状态
  - 试用中：`Trial: X days remaining`
  - 已付费：`Lifetime Access ✓`
  - 试用到期：`Trial Expired - Purchase to use relay server`

**验收标准**:
- 付费用户可以在中继服务器和自定义服务器之间切换
- 未付费用户看到中继选项置灰 + 锁定图标
- 试用期倒计时显示正确

---

## 阶段 10: 连接方式 UI 实现

### 10.1 创建连接设置页面
- [ ] 编辑 `mobile/src/features/settings/SettingsScreen.tsx`
  - 添加 "Connection" 区域
  - 显示当前连接方式：
    - 试用期内或已付费：显示 "Auto Tunnel (Active)"
    - 试用到期且未付费：显示 "Manual Setup Required"

### 10.2 实现自动隧道选项
- [ ] 添加 "Use Auto Tunnel" 选项
  - 试用期内或已付费：显示为可选状态，默认选中
  - 试用到期且未付费：显示为置灰状态 + 锁定图标
  - 点击置灰选项时弹窗："Auto tunnel requires purchase"

### 10.3 实现自定义服务器选项
- [ ] 添加 "Custom Server" 输入框
  - 所有用户都可以使用
  - 输入自建内网穿透地址（如 Tailscale URL）
  - 保存到本地配置

### 10.4 添加试用期倒计时
- [ ] 在设置页面顶部显示试用状态
  - 试用中：`Trial: X days remaining`
  - 已付费：`Lifetime Access ✓`
  - 试用到期：`Trial Expired - Purchase to use auto tunnel`

**验收标准**:
- 付费用户可以在自动隧道和自定义服务器之间切换
- 未付费用户看到自动隧道选项置灰 + 锁定图标
- 试用期倒计时显示正确

---

## 阶段 11: 试用到期提示实现

### 10.1 创建到期提示弹窗
- [ ] 创建 `mobile/src/features/payment/TrialExpiredModal.tsx`
  - 标题："Trial Expired"
  - 内容："Your 14-day trial has ended. Purchase to continue using relay server, or set up manual connection."
  - 主按钮："Purchase Now"
  - 次要按钮："Set Up Manual Connection"（导航到设置页面）
  - 底部链接："Restore Purchase"

### 10.2 集成到主流程
- [ ] 在 App 启动时检查：
  - 如果 `isTrialExpired() && !isPaid && !hasCustomServer`，显示 `TrialExpiredModal`
  - 模态框可以关闭（用户可以选择稍后处理）
- [ ] 在尝试使用中继服务器时检查：
  - 如果 `!canUseRelayServer()`，显示 `TrialExpiredModal`

**验收标准**:
- 试用到期后打开 App，显示提示弹窗（可关闭）
- 试用到期后尝试使用中继服务器，显示提示弹窗
- 弹窗中的"恢复购买"按钮正常工作

---

## 阶段 11: 试用到期提示实现

### 11.1 创建到期提示弹窗
- [ ] 创建 `mobile/src/features/payment/TrialExpiredModal.tsx`
  - 标题："Trial Expired"
  - 内容："Your 14-day trial has ended. Purchase to continue using auto tunnel, or set up manual connection."
  - 主按钮："Purchase Now"
  - 次要按钮："Set Up Manual Connection"（导航到设置页面）
  - 底部链接："Restore Purchase"

### 11.2 集成到主流程
- [ ] 在 App 启动时检查：
  - 如果 `isTrialExpired() && !isPaid && !hasCustomServer`，显示 `TrialExpiredModal`
  - 模态框可以关闭（用户可以选择稍后处理）
- [ ] 在尝试使用自动隧道时检查：
  - 如果 `!canUseAutoTunnel()`，显示 `TrialExpiredModal`

**验收标准**:
- 试用到期后打开 App，显示提示弹窗（可关闭）
- 试用到期后尝试使用自动隧道，显示提示弹窗
- 弹窗中的"恢复购买"按钮正常工作

---

## 阶段 12: TestFlight 测试

### 11.1 构建 TestFlight 版本
```bash
cd mobile
./scripts/publish-ios-local.sh --build-only
```

### 11.2 上传到 TestFlight
- [ ] 使用 Xcode 或 `xcrun altool` 上传 IPA
- [ ] 在 App Store Connect 中提交 TestFlight 审核
- [ ] 等待 TestFlight 审核通过（通常几小时）

### 11.3 测试场景清单

#### 场景 1: 完整购买流程
- [ ] 安装 TestFlight 版本
- [ ] 首次连接 msctl serve（通过中继服务器），确认试用开始
- [ ] 验证可以正常使用中继服务器
- [ ] 修改设备时间到 15 天后（或等待真实时间）
- [ ] 重启 App，确认显示到期提示
- [ ] 点击 "Purchase Now"，完成沙盒购买
- [ ] 确认购买后可以继续使用中继服务器

#### 场景 2: 恢复购买流程
- [ ] 在设备 A 完成购买
- [ ] 在设备 B 安装 TestFlight 版本
- [ ] 点击 "Restore Purchase"
- [ ] 确认设备 B 显示已付费状态，可以使用中继服务器

#### 场景 3: UI/UX 完整性
- [ ] 购买页面 UI 符合设计规范
- [ ] 到期提示弹窗显示正确
- [ ] 设置页面连接方式显示正确
- [ ] 试用期倒计时显示正确
- [ ] 中继服务器选项在未付费时置灰 + 锁定图标
- [ ] 所有按钮响应正常

#### 场景 4: 自定义服务器
- [ ] 试用到期后，可以在设置中配置自定义服务器地址
- [ ] 配置自定义服务器后，可以正常连接到自建内网穿透

**验收标准**:
- 所有测试场景通过
- 无 UI 错误或崩溃

---

## 阶段 12: TestFlight 测试

### 12.1 构建 TestFlight 版本
```bash
cd mobile
./scripts/publish-ios-local.sh --build-only
```

### 12.2 上传到 TestFlight
- [ ] 使用 Xcode 或 `xcrun altool` 上传 IPA
- [ ] 在 App Store Connect 中提交 TestFlight 审核
- [ ] 等待 TestFlight 审核通过（通常几小时）

### 12.3 测试场景清单

#### 场景 1: 完整购买流程
- [ ] 安装 TestFlight 版本
- [ ] 在本地运行 `msctl serve --relay`，确认 cloudflared 启动成功
- [ ] iOS App 连接自动隧道，确认试用开始
- [ ] 验证可以正常使用（发送消息、WebSocket 流式响应）
- [ ] 修改设备时间到 15 天后（或等待真实时间）
- [ ] 重启 App，确认显示到期提示
- [ ] 点击 "Purchase Now"，完成沙盒购买
- [ ] 确认购买后可以继续使用自动隧道

#### 场景 2: 恢复购买流程
- [ ] 在设备 A 完成购买
- [ ] 在设备 B 安装 TestFlight 版本
- [ ] 点击 "Restore Purchase"
- [ ] 确认设备 B 显示已付费状态，可以使用自动隧道

#### 场景 3: UI/UX 完整性
- [ ] 购买页面 UI 符合设计规范
- [ ] 到期提示弹窗显示正确
- [ ] 设置页面连接方式显示正确
- [ ] 试用期倒计时显示正确
- [ ] 自动隧道选项在未付费时置灰 + 锁定图标
- [ ] 所有按钮响应正常

#### 场景 4: 自定义服务器
- [ ] 试用到期后，可以在设置中配置自定义服务器地址
- [ ] 配置自定义服务器后，可以正常连接到自建内网穿透

#### 场景 5: msctl 端测试
- [ ] `msctl serve --relay` 启动后，cloudflared 自动建立隧道
- [ ] 隧道地址成功上报到 Cloudflare Workers KV
- [ ] iOS App 可以获取隧道地址并连接
- [ ] msctl 退出后，隧道状态自动清理

**验收标准**:
- 所有测试场景通过
- 无 UI 错误或崩溃

---

## 阶段 13: App Store 审核准备

### 12.1 审核材料清单

#### 必需材料
- [ ] **App 截图**（至少 3 张）
  - 展示核心功能（Agent 对话界面）
  - 展示购买页面截图
  - 展示连接设置页面
  - 尺寸符合 App Store 要求
- [ ] **App 描述**
  - 清晰说明 14 天试用 + 买断制
  - 说明付费版提供中继服务，免费版需要自建内网穿透
  - 列出核心功能
  - 提及"无订阅"
- [ ] **隐私政策 URL**
  - 必须包含 IAP 相关条款
  - 说明不收集支付信息（由 Apple 处理）
  - 说明中继服务器的数据处理方式
- [ ] **支持 URL**
  - GitHub Issues 或官方网站
- [ ] **审核备注**（App Review Information）
  - 提供测试账号（如果需要连接 msctl serve）
  - 说明如何触发购买流程
  - 说明试用期为 14 天
  - 说明中继服务器的作用（简化连接配置）

#### IAP 特定要求
- [ ] **恢复购买按钮**
  - 必须在购买页面或设置页面可见
  - 按钮文字清晰（"Restore Purchase" 或 "恢复购买"）
- [ ] **试用期说明**
  - 在购买页面明确标注"14-day free trial"
  - 在 App 描述中说明试用条款
- [ ] **价格显示**
  - 购买页面必须显示准确价格（从 RevenueCat 动态获取）
  - 不能硬编码价格文字

### 12.2 常见拒审原因与预防

| 拒审原因 | 预防措施 |
|---------|---------|
| 缺少恢复购买按钮 | 在购买页面和到期提示中都添加"Restore Purchase" |
| 试用期说明不清 | 在购买页面和 App 描述中明确标注"14-day free trial" |
| 无法测试购买流程 | 在审核备注中提供详细测试步骤 |
| 使用第三方支付 | 确认仅使用 Apple IAP，无其他支付入口 |
| 隐私政策缺失 | 提供完整隐私政策 URL |
| 功能不完整 | 确保免费版（自建内网穿透）也可以正常使用 |

### 12.3 提交审核
- [ ] 在 App Store Connect 中填写所有必需信息
- [ ] 上传截图和 App 预览视频（可选）
- [ ] 填写审核备注
- [ ] 点击 "Submit for Review"
- [ ] 等待审核结果（通常 1-3 天）

**验收标准**:
- 所有审核材料准备完毕
- 提交审核成功

---

## 阶段 13: App Store 审核准备

### 13.1 审核材料清单

#### 必需材料
- [ ] **App 截图**（至少 3 张）
  - 展示核心功能（Agent 对话界面）
  - 展示购买页面截图
  - 展示连接设置页面
  - 尺寸符合 App Store 要求
- [ ] **App 描述**
  - 清晰说明 14 天试用 + 买断制
  - 说明付费版提供自动隧道，免费版需要自建内网穿透
  - 列出核心功能
  - 提及"无订阅"
- [ ] **隐私政策 URL**
  - 必须包含 IAP 相关条款
  - 说明不收集支付信息（由 Apple 处理）
  - 说明 Cloudflare Tunnel 的数据处理方式
- [ ] **支持 URL**
  - GitHub Issues 或官方网站
- [ ] **审核备注**（App Review Information）
  - 提供测试账号（如果需要）
  - 说明如何触发购买流程
  - 说明试用期为 14 天
  - **重要**：说明需要在本地运行 `msctl serve --relay` 才能测试完整功能
  - 提供 msctl 下载链接和快速启动指南

#### IAP 特定要求
- [ ] **恢复购买按钮**
  - 必须在购买页面或设置页面可见
  - 按钮文字清晰（"Restore Purchase" 或 "恢复购买"）
- [ ] **试用期说明**
  - 在购买页面明确标注"14-day free trial"
  - 在 App 描述中说明试用条款
- [ ] **价格显示**
  - 购买页面必须显示准确价格（从 RevenueCat 动态获取）
  - 不能硬编码价格文字

### 13.2 常见拒审原因与预防

| 拒审原因 | 预防措施 |
|---------|---------|
| 缺少恢复购买按钮 | 在购买页面和到期提示中都添加"Restore Purchase" |
| 试用期说明不清 | 在购买页面和 App 描述中明确标注"14-day free trial" |
| 无法测试购买流程 | 在审核备注中提供详细测试步骤 + msctl 快速启动指南 |
| 使用第三方支付 | 确认仅使用 Apple IAP，无其他支付入口 |
| 隐私政策缺失 | 提供完整隐私政策 URL |
| 功能不完整 | 确保免费版（自建内网穿透）也可以正常使用 |

### 13.3 提交审核
- [ ] 在 App Store Connect 中填写所有必需信息
- [ ] 上传截图和 App 预览视频（可选）
- [ ] 填写审核备注
- [ ] 点击 "Submit for Review"
- [ ] 等待审核结果（通常 1-3 天）

**验收标准**:
- 所有审核材料准备完毕
- 提交审核成功

---

## 阶段 14: 审核后处理

### 13.1 审核通过
- [ ] 在 App Store Connect 中设置发布方式
  - 选项 1：立即发布
  - 选项 2：手动发布
- [ ] 发布到 App Store
- [ ] 监控用户反馈和崩溃报告

### 13.2 审核被拒
- [ ] 阅读拒审理由
- [ ] 根据反馈修复问题
- [ ] 重新提交审核
- [ ] 在 Resolution Center 中与审核团队沟通（如需要）

**验收标准**:
- App 成功上架 App Store
- 用户可以搜索并下载

---

## 风险应对方案

### 风险 1: RevenueCat 收据验证失败
**症状**: 购买成功但 App 仍显示未付费  
**排查步骤**:
1. 检查 RevenueCat Dashboard 是否收到购买事件
2. 检查 App Store Connect API Key 配置是否正确
3. 查看 RevenueCat SDK 日志（`Purchases.setLogLevel(.debug)`）
4. 确认 Entitlement ID 为 `pro`

**应对方案**:
- 在 `syncPaymentStatus()` 中添加重试逻辑（最多 3 次）
- 提供手动同步按钮（设置页面）

### 风险 2: 试用期计时不准确
**症状**: 试用期提前或延后到期  
**排查步骤**:
1. 检查 `trial_start_time` 是否正确记录
2. 检查设备时区设置
3. 确认使用 UTC 时间而非本地时间

**应对方案**:
- 使用 `Date.now()` 记录 Unix 时间戳
- 在计算剩余天数时使用 `Math.floor((now - start) / (24 * 60 * 60 * 1000))`

### 风险 3: 恢复购买跨设备失败
**症状**: 在新设备上恢复购买后仍显示未付费  
**排查步骤**:
1. 确认两台设备使用同一 Apple ID
2. 检查 RevenueCat 是否识别为同一用户（通过 `original_transaction_id`）
3. 查看 RevenueCat Dashboard 中的用户历史记录

**应对方案**:
- 在 `restorePurchases()` 后强制调用 `syncPaymentStatus()`
- 提供"联系支持"入口，手动处理边缘情况

### 风险 4: 远程配置获取失败
**症状**: App 无法获取中继服务器地址  
**排查步骤**:
1. 检查网络连接
2. 检查远程配置 API 是否正常
3. 查看本地缓存是否存在

**应对方案**:
- 使用缓存的配置（如果存在）
- 提供内置的默认中继服务器地址作为 fallback
- 在设置页面显示配置获取状态

### 风险 5: 中继服务器不可用
**症状**: 付费用户无法连接到中继服务器  
**排查步骤**:
1. 检查中继服务器健康状态
2. 检查网络连接
3. 查看服务器日志

**应对方案**:
- 在 App 中显示服务器状态（可用/不可用）
- 允许付费用户临时切换到自定义服务器
- 提供服务器状态页面 URL（如 status.multisoul.app）

---

## 验证清单（最终上线前）

### 代码质量
- [ ] `cd mobile && pnpm typecheck` 通过
- [ ] `cd mobile && pnpm test -- --watchAll=false` 通过
- [ ] 无 console.log（仅允许 console.warn/error）
- [ ] 遵循 `mobile/docs/design.md` 设计规范

### 功能完整性
- [ ] 试用期计时正确
- [ ] 购买流程完整
- [ ] 恢复购买功能正常
- [ ] 到期提示显示正确
- [ ] 连接方式切换正常（中继服务器 vs 自定义服务器）
- [ ] 远程配置获取正常
- [ ] 免费版（自定义服务器）可以正常使用

### 审核合规
- [ ] 恢复购买按钮可见
- [ ] 试用期说明清晰
- [ ] 隐私政策 URL 有效
- [ ] 审核备注完整
- [ ] 免费版功能完整（不强制付费）

### 用户体验
- [ ] 购买页面 UI 美观
- [ ] 错误提示友好
- [ ] 无明显性能问题
- [ ] 支持深色模式（如适用）
- [ ] 试用期倒计时清晰可见

---

## 时间估算

| 阶段 | 预计时间 |
|------|---------|
| RevenueCat 注册与配置 | 1-2 小时 |
| IAP 产品配置 | 1 小时 |
| RevenueCat 产品配置 | 30 分钟 |
| Mobile SDK 集成 | 2-3 小时 |
| 远程配置服务实现 | 2-3 小时 |
| 试用期管理实现 | 2-3 小时 |
| 付费状态检查 | 2 小时 |
| 购买页面 UI | 3-4 小时 |
| 连接方式 UI | 3-4 小时 |
| 到期提示实现 | 1-2 小时 |
| TestFlight 测试 | 2-4 小时 |
| 审核材料准备 | 2-3 小时 |
| **总计** | **22-32 小时** |

**注**: 不包括等待 Apple 审核的时间（IAP 产品审核 1-2 天 + App 审核 1-3 天）

---

## 参考资料

- RevenueCat 官方文档: https://docs.revenuecat.com/
- React Native Purchases SDK: https://github.com/RevenueCat/react-native-purchases
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- In-App Purchase 最佳实践: https://developer.apple.com/in-app-purchase/
- MultiSoul 设计规范: `mobile/docs/design.md`
- MultiSoul 产品规格: `docs/product-specs/SPEC-ios-payment.md`

---

## 阶段 14: 审核后处理

### 14.1 审核通过
- [ ] 在 App Store Connect 中设置发布方式
  - 选项 1：立即发布
  - 选项 2：手动发布
- [ ] 发布到 App Store
- [ ] 监控用户反馈和崩溃报告

### 14.2 审核被拒
- [ ] 阅读拒审理由
- [ ] 根据反馈修复问题
- [ ] 重新提交审核
- [ ] 在 Resolution Center 中与审核团队沟通（如需要）

**验收标准**:
- App 成功上架 App Store
- 用户可以搜索并下载

---

## 风险应对方案

### 风险 1: RevenueCat 收据验证失败
**症状**: 购买成功但 App 仍显示未付费  
**排查步骤**:
1. 检查 RevenueCat Dashboard 是否收到购买事件
2. 检查 App Store Connect API Key 配置是否正确
3. 查看 RevenueCat SDK 日志（`Purchases.setLogLevel(.debug)`）
4. 确认 Entitlement ID 为 `pro`

**应对方案**:
- 在 `syncPaymentStatus()` 中添加重试逻辑（最多 3 次）
- 提供手动同步按钮（设置页面）

### 风险 2: 试用期计时不准确
**症状**: 试用期提前或延后到期  
**排查步骤**:
1. 检查 `trial_start_time` 是否正确记录
2. 检查设备时区设置
3. 确认使用 UTC 时间而非本地时间

**应对方案**:
- 使用 `Date.now()` 记录 Unix 时间戳
- 在计算剩余天数时使用 `Math.floor((now - start) / (24 * 60 * 60 * 1000))`

### 风险 3: 恢复购买跨设备失败
**症状**: 在新设备上恢复购买后仍显示未付费  
**排查步骤**:
1. 确认两台设备使用同一 Apple ID
2. 检查 RevenueCat 是否识别为同一用户（通过 `original_transaction_id`）
3. 查看 RevenueCat Dashboard 中的用户历史记录

**应对方案**:
- 在 `restorePurchases()` 后强制调用 `syncPaymentStatus()`
- 提供"联系支持"入口，手动处理边缘情况

### 风险 4: cloudflared 启动失败
**症状**: msctl serve --relay 启动后无法建立隧道  
**排查步骤**:
1. 检查 cloudflared 是否已安装（`which cloudflared`）
2. 检查网络连接（Cloudflare 服务是否可达）
3. 查看 cloudflared 日志

**应对方案**:
- msctl 首次运行时自动下载 cloudflared（如果不存在）
- 提供清晰的错误提示："cloudflared not found, please install it"
- 在文档中提供 cloudflared 安装指南

### 风险 5: 隧道地址获取超时
**症状**: iOS App 无法获取隧道地址  
**排查步骤**:
1. 检查 msctl serve --relay 是否正在运行
2. 检查 Cloudflare Workers KV 中是否有对应的 user_token
3. 查看 msctl 日志，确认隧道地址是否成功上报

**应对方案**:
- iOS App 显示友好提示："Waiting for msctl serve --relay to start..."
- 提供"刷新"按钮，手动重试获取隧道地址
- 超时后提示用户检查 msctl 状态

### 风险 6: Cloudflare Tunnel 稳定性问题
**症状**: 隧道频繁断开或延迟高  
**排查步骤**:
1. 检查 cloudflared 版本（是否为最新稳定版）
2. 检查网络质量（延迟、丢包率）
3. 查看 Cloudflare 服务状态页面

**应对方案**:
- msctl 实现 cloudflared 进程监控和自动重启
- 在 iOS App 中显示连接质量指标（延迟、重连次数）
- 提供"切换到自定义服务器"的快速入口

---

## 验证清单（最终上线前）

### 代码质量
- [ ] `cd mobile && pnpm typecheck` 通过
- [ ] `cd mobile && pnpm test -- --watchAll=false` 通过
- [ ] 无 console.log（仅允许 console.warn/error）
- [ ] 遵循 `mobile/docs/design.md` 设计规范

### 功能完整性
- [ ] 试用期计时正确
- [ ] 购买流程完整
- [ ] 恢复购买功能正常
- [ ] 到期提示显示正确
- [ ] 连接方式切换正常（自动隧道 vs 自定义服务器）
- [ ] msctl serve --relay 可以正常启动 cloudflared
- [ ] iOS App 可以获取隧道地址并连接
- [ ] 免费版（自定义服务器）可以正常使用

### 审核合规
- [ ] 恢复购买按钮可见
- [ ] 试用期说明清晰
- [ ] 隐私政策 URL 有效
- [ ] 审核备注完整（包含 msctl 启动指南）
- [ ] 免费版功能完整（不强制付费）

### 用户体验
- [ ] 购买页面 UI 美观
- [ ] 错误提示友好
- [ ] 无明显性能问题
- [ ] 支持深色模式（如适用）
- [ ] 试用期倒计时清晰可见

---

## 时间估算

| 阶段 | 预计时间 |
|------|---------|
| RevenueCat 注册与配置 | 1-2 小时 |
| IAP 产品配置 | 1 小时 |
| RevenueCat 产品配置 | 30 分钟 |
| Mobile SDK 集成 | 2-3 小时 |
| Cloudflare Tunnel 集成（msctl） | 1-2 天 |
| Cloudflare Workers KV 状态服务 | 2-3 小时 |
| iOS 端隧道地址获取 | 2-3 小时 |
| 试用期管理实现 | 2-3 小时 |
| 付费状态检查 | 2 小时 |
| 购买页面 UI | 3-4 小时 |
| 连接方式 UI | 3-4 小时 |
| 到期提示实现 | 1-2 小时 |
| TestFlight 测试 | 2-4 小时 |
| 审核材料准备 | 2-3 小时 |
| **总计** | **3-4 天** |

**注**: 不包括等待 Apple 审核的时间（IAP 产品审核 1-2 天 + App 审核 1-3 天）

---

## 参考资料

- RevenueCat 官方文档: https://docs.revenuecat.com/
- React Native Purchases SDK: https://github.com/RevenueCat/react-native-purchases
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- In-App Purchase 最佳实践: https://developer.apple.com/in-app-purchase/
- Cloudflare Tunnel 文档: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- MultiSoul 设计规范: `mobile/docs/design.md`
- MultiSoul 产品规格: `docs/product-specs/SPEC-ios-payment.md`

---

## 附录：msctl Cloudflare Tunnel 集成技术细节

### A.1 cloudflared 自动下载与管理

```rust
// cli/src/tunnel/cloudflared.rs
pub async fn ensure_cloudflared() -> Result<PathBuf> {
    let bin_path = get_cloudflared_path();
    if !bin_path.exists() {
        download_cloudflared(&bin_path).await?;
    }
    Ok(bin_path)
}

fn get_cloudflared_path() -> PathBuf {
    // ~/.multisoul/bin/cloudflared
    dirs::home_dir()
        .unwrap()
        .join(".multisoul/bin/cloudflared")
}

async fn download_cloudflared(dest: &Path) -> Result<()> {
    let url = match std::env::consts::OS {
        "macos" => "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64",
        "linux" => "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
        _ => bail!("Unsupported OS"),
    };
    // 下载并设置可执行权限
    // ...
}
```

### A.2 隧道启动与地址上报

```rust
// cli/src/tunnel/manager.rs
pub async fn start_tunnel(local_port: u16, user_token: String) -> Result<()> {
    let cloudflared = ensure_cloudflared().await?;
    
    // 启动 cloudflared tunnel
    let mut child = Command::new(cloudflared)
        .args(&["tunnel", "--url", &format!("http://localhost:{}", local_port)])
        .stdout(Stdio::piped())
        .spawn()?;
    
    // 解析输出获取隧道 URL
    let tunnel_url = parse_tunnel_url(&mut child).await?;
    
    // 上报到状态服务
    report_tunnel_url(&user_token, &tunnel_url).await?;
    
    // 启动心跳任务
    tokio::spawn(heartbeat_loop(user_token.clone(), tunnel_url.clone()));
    
    Ok(())
}

async fn parse_tunnel_url(child: &mut Child) -> Result<String> {
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    
    while let Some(line) = lines.next_line().await? {
        // 匹配 "https://xxx.trycloudflare.com"
        if let Some(url) = extract_url(&line) {
            return Ok(url);
        }
    }
    bail!("Failed to get tunnel URL")
}
```

### A.3 状态服务 API 调用

```rust
// cli/src/tunnel/state_service.rs
pub async fn report_tunnel_url(user_token: &str, tunnel_url: &str) -> Result<()> {
    let client = reqwest::Client::new();
    client
        .post("https://tunnel.multisoul.app/tunnel")
        .json(&serde_json::json!({
            "user_token": user_token,
            "tunnel_url": tunnel_url,
        }))
        .send()
        .await?;
    Ok(())
}

async fn heartbeat_loop(user_token: String, tunnel_url: String) {
    let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));
    loop {
        interval.tick().await;
        let _ = report_tunnel_url(&user_token, &tunnel_url).await;
    }
}
```

### A.4 未来升级路径（自研反向隧道）

当 Cloudflare Tunnel 成为瓶颈时（费用、限制、稳定性），可以迁移到自研反向隧道（方案 A）：

**核心改动**：
- msctl 侧：用 `yamux` 替换 cloudflared，建立 TLS over TCP 隧道
- 中继服务器：用 axum 实现隧道注册和流量转发
- 路由策略：`https://relay.multisoul.app/t/{user_id}/api/v1/...`

**迁移成本**：约 1-2 周开发 + 测试，但用户体验无感知（iOS App 无需改动）。
