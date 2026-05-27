# iOS 付费机制实施计划

**创建日期**: 2026-05-27  
**目标**: 为 MultiSoul iOS 应用添加 7 天试用 + $12.99 买断制付费机制，并成功上架 App Store  
**参考规格**: `docs/product-specs/SPEC-ios-payment.md`

---

## 实施概览

**总体策略**: 一次性完成所有步骤（RevenueCat 集成 → IAP 配置 → Mobile 开发 → TestFlight 测试 → App Store 审核）

**关键决策**:
- 试用期：14 天（从首次成功连接 msctl serve 开始计时）
- 买断价格：$12.99
- 试用到期行为：限制部分功能（允许查看历史记录，但不能发送新消息）
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

## 阶段 5: 试用期管理实现

### 5.1 创建本地数据库表
- [ ] 编辑 `mobile/src/db/schema.ts`（或等效文件）
  - 创建 `payment_status` 表
  - 字段：`trial_start_time`, `is_paid`, `last_checked_at`

### 5.2 实现试用期逻辑
- [ ] 创建 `mobile/src/features/payment/trialManager.ts`
  - `startTrial()`: 记录试用开始时间（首次连接 msctl serve 时调用）
  - `getTrialStatus()`: 返回 `{ isTrialActive, daysRemaining }`
  - `isTrialExpired()`: 检查是否超过 14 天

### 5.3 集成到连接流程
- [ ] 在首次成功连接 msctl serve 时调用 `startTrial()`
  - 位置：`mobile/src/features/settings/` 或 `mobile/src/api.ts`
  - 仅在 `trial_start_time` 为空时记录

**验收标准**:
- 首次连接后，数据库中 `trial_start_time` 已记录
- `getTrialStatus()` 返回正确的剩余天数

---

## 阶段 6: 付费状态检查与缓存

### 6.1 实现付费状态同步
- [ ] 创建 `mobile/src/features/payment/paymentStatus.ts`
  - `syncPaymentStatus()`: 调用 RevenueCat SDK 检查 `entitlements.active['pro']`
  - 更新本地数据库 `is_paid` 和 `last_checked_at`
  - 返回 `{ isPaid: boolean }`

### 6.2 在 App 启动时检查
- [ ] 编辑 `mobile/app/_layout.tsx`
  - 在 RevenueCat 初始化后调用 `syncPaymentStatus()`
  - 每次启动时同步一次

### 6.3 实现访问控制逻辑
- [ ] 创建 `mobile/src/features/payment/accessControl.ts`
  - `canSendMessage()`: 检查是否允许发送新消息
    - 逻辑：`(isTrialActive || isPaid) === true`
  - `canViewHistory()`: 检查是否允许查看历史记录
    - 逻辑：始终返回 `true`（试用到期后仍可查看）

**验收标准**:
- 试用期内：`canSendMessage()` 返回 `true`
- 试用到期且未付费：`canSendMessage()` 返回 `false`
- 已付费：`canSendMessage()` 返回 `true`

---

## 阶段 7: 购买页面 UI 实现

### 7.1 创建购买页面组件
- [ ] 创建 `mobile/src/features/payment/PurchaseScreen.tsx`
  - 极简设计：
    - 标题："Unlock MultiSoul"
    - 价格显示：`$12.99`（从 RevenueCat Offering 动态获取）
    - 购买按钮："Purchase"
    - 恢复购买按钮："Restore Purchase"（底部小字链接）
  - 遵循 `mobile/docs/design.md` 设计规范
    - 背景色：`#0D0D0D`
    - 卡片背景：`#1A1A1A`
    - 主按钮：`#FF6B35`
    - 文字：`#FFFFFF`

### 7.2 实现购买逻辑
- [ ] 在 "Purchase" 按钮点击时：
  - 调用 `purchasePackage(offering.lifetime)`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()` 更新本地状态
  - 导航回主页面

### 7.3 实现恢复购买逻辑
- [ ] 在 "Restore Purchase" 按钮点击时：
  - 调用 `restorePurchases()`
  - 显示 loading 状态
  - 成功后调用 `syncPaymentStatus()`
  - 失败时显示 Toast："未找到购买记录"

### 7.4 错误处理
- [ ] 购买失败时显示 Toast："购买失败，请重试"
- [ ] 用户取消购买时不显示错误（静默处理）

**验收标准**:
- 购买页面 UI 符合设计规范
- 点击购买按钮触发 Apple IAP 流程
- 恢复购买功能正常工作

---

## 阶段 8: 试用到期提示实现

### 8.1 创建到期提示弹窗
- [ ] 创建 `mobile/src/features/payment/TrialExpiredModal.tsx`
  - 标题："Trial Expired"
  - 内容："Your 14-day trial has ended. Purchase to continue using MultiSoul."
  - 按钮："Purchase Now"
  - 底部链接："Restore Purchase"

### 8.2 集成到主流程
- [ ] 在 App 启动时检查：
  - 如果 `isTrialExpired() && !isPaid`，显示 `TrialExpiredModal`
  - 模态框不可关闭（无 X 按钮）
- [ ] 在尝试发送消息时检查：
  - 如果 `!canSendMessage()`，显示 `TrialExpiredModal`

**验收标准**:
- 试用到期后打开 App，自动显示提示弹窗
- 试用到期后尝试发送消息，显示提示弹窗
- 弹窗中的"恢复购买"按钮正常工作

---

## 阶段 9: 设置页面集成（可选）

### 9.1 添加付费状态显示
- [ ] 编辑 `mobile/src/features/settings/SettingsScreen.tsx`
  - 添加 "Payment Status" 区域
  - 显示：
    - 试用中：`Trial: X days remaining`
    - 已付费：`Lifetime Access ✓`
    - 试用到期：`Trial Expired`

### 9.2 添加恢复购买入口（可选）
- [ ] 在设置页面添加 "Restore Purchase" 按钮
  - 仅在未付费时显示

**验收标准**:
- 设置页面正确显示付费状态

---

## 阶段 10: TestFlight 测试

### 10.1 构建 TestFlight 版本
```bash
cd mobile
./scripts/publish-ios-local.sh --build-only
```

### 10.2 上传到 TestFlight
- [ ] 使用 Xcode 或 `xcrun altool` 上传 IPA
- [ ] 在 App Store Connect 中提交 TestFlight 审核
- [ ] 等待 TestFlight 审核通过（通常几小时）

### 10.3 测试场景清单

#### 场景 1: 完整购买流程
- [ ] 安装 TestFlight 版本
- [ ] 首次连接 msctl serve，确认试用开始
- [ ] 修改设备时间到 15 天后（或等待真实时间）
- [ ] 重启 App，确认显示到期提示
- [ ] 点击 "Purchase Now"，完成沙盒购买
- [ ] 确认购买后可以发送消息

#### 场景 2: 恢复购买流程
- [ ] 在设备 A 完成购买
- [ ] 在设备 B 安装 TestFlight 版本
- [ ] 点击 "Restore Purchase"
- [ ] 确认设备 B 显示已付费状态

#### 场景 3: UI/UX 完整性
- [ ] 购买页面 UI 符合设计规范
- [ ] 到期提示弹窗显示正确
- [ ] 设置页面付费状态显示正确
- [ ] 所有按钮响应正常

#### 场景 4: 边界情况（可选）
- [ ] 网络中断时购买（应显示错误提示）
- [ ] 用户取消购买（应静默处理）
- [ ] 收据验证失败（应显示错误提示）

**验收标准**:
- 所有测试场景通过
- 无 UI 错误或崩溃

---

## 阶段 11: App Store 审核准备

### 11.1 审核材料清单

#### 必需材料
- [ ] **App 截图**（至少 3 张）
  - 展示核心功能
  - 包含购买页面截图
  - 尺寸符合 App Store 要求
- [ ] **App 描述**
  - 清晰说明 14 天试用 + 买断制
  - 列出核心功能
  - 提及"无订阅"
- [ ] **隐私政策 URL**
  - 必须包含 IAP 相关条款
  - 说明不收集支付信息（由 Apple 处理）
- [ ] **支持 URL**
  - GitHub Issues 或官方网站
- [ ] **审核备注**（App Review Information）
  - 提供测试账号（如果需要连接 msctl serve）
  - 说明如何触发购买流程
  - 说明试用期为 14 天

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

### 11.2 常见拒审原因与预防

| 拒审原因 | 预防措施 |
|---------|---------|
| 缺少恢复购买按钮 | 在购买页面和到期提示中都添加"Restore Purchase" |
| 试用期说明不清 | 在购买页面和 App 描述中明确标注"14-day free trial" |
| 无法测试购买流程 | 在审核备注中提供详细测试步骤 |
| 使用第三方支付 | 确认仅使用 Apple IAP，无其他支付入口 |
| 隐私政策缺失 | 提供完整隐私政策 URL |

### 11.3 提交审核
- [ ] 在 App Store Connect 中填写所有必需信息
- [ ] 上传截图和 App 预览视频（可选）
- [ ] 填写审核备注
- [ ] 点击 "Submit for Review"
- [ ] 等待审核结果（通常 1-3 天）

**验收标准**:
- 所有审核材料准备完毕
- 提交审核成功

---

## 阶段 12: 审核后处理

### 12.1 审核通过
- [ ] 在 App Store Connect 中设置发布方式
  - 选项 1：立即发布
  - 选项 2：手动发布
- [ ] 发布到 App Store
- [ ] 监控用户反馈和崩溃报告

### 12.2 审核被拒
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
- [ ] 访问控制逻辑正确（试用到期后不能发送消息）

### 审核合规
- [ ] 恢复购买按钮可见
- [ ] 试用期说明清晰
- [ ] 隐私政策 URL 有效
- [ ] 审核备注完整

### 用户体验
- [ ] 购买页面 UI 美观
- [ ] 错误提示友好
- [ ] 无明显性能问题
- [ ] 支持深色模式（如适用）

---

## 时间估算

| 阶段 | 预计时间 |
|------|---------|
| RevenueCat 注册与配置 | 1-2 小时 |
| IAP 产品配置 | 1 小时 |
| RevenueCat 产品配置 | 30 分钟 |
| Mobile SDK 集成 | 2-3 小时 |
| 试用期管理实现 | 2-3 小时 |
| 付费状态检查 | 2 小时 |
| 购买页面 UI | 3-4 小时 |
| 到期提示实现 | 1-2 小时 |
| 设置页面集成 | 1 小时 |
| TestFlight 测试 | 2-4 小时 |
| 审核材料准备 | 2-3 小时 |
| **总计** | **18-26 小时** |

**注**: 不包括等待 Apple 审核的时间（IAP 产品审核 1-2 天 + App 审核 1-3 天）

---

## 参考资料

- RevenueCat 官方文档: https://docs.revenuecat.com/
- React Native Purchases SDK: https://github.com/RevenueCat/react-native-purchases
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- In-App Purchase 最佳实践: https://developer.apple.com/in-app-purchase/
- MultiSoul 设计规范: `mobile/docs/design.md`
- MultiSoul 产品规格: `docs/product-specs/SPEC-ios-payment.md`
