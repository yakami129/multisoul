# iOS 付费机制 SPEC

## 1. 背景与目标

### 1.1 背景
MultiSoul 已开源，现需为 iOS 应用添加付费机制，以支持项目的可持续发展。

### 1.2 目标
- 为 iOS 应用引入 7 天试用 + 买断制的付费模式
- 确保付费验证的安全性和可靠性
- 支持用户跨设备恢复购买
- 顺利通过 Apple 审核并正式上架

---

## 2. 范围

### 2.1 In Scope
- iOS 应用的付费机制（7 天试用 + 买断）
- 独立的云端后台服务（收据验证、付费状态管理）
- mobile 端的购买页面和付费状态检查
- 恢复购买功能
- TestFlight 测试和 App Store 审核流程

### 2.2 Out of Scope
- Android 平台的付费机制（未来考虑）
- 订阅制付费模式（当前仅买断）
- msctl CLI 的付费限制（CLI 保持免费）
- 用户账号系统（不需要注册/登录）

---

## 3. 用户与使用场景

### 3.1 典型用户角色
- **新用户**：首次下载并安装 MultiSoul iOS 应用
- **试用用户**：正在使用 7 天试用期的用户
- **付费用户**：已购买买断的用户
- **换设备用户**：在新设备上恢复购买的用户

### 3.2 关键使用场景

#### 场景 1：新用户首次使用
1. 用户下载并安装 MultiSoul iOS 应用
2. 用户配置并首次成功连接到 msctl serve
3. 系统记录试用开始时间（7 天倒计时开始）
4. 用户可以正常使用所有功能

#### 场景 2：试用期到期
1. 用户打开应用，系统检测到试用期已过
2. 应用显示购买页面，提示用户购买
3. 用户无法使用任何功能，直到完成购买

#### 场景 3：用户购买
1. 用户在购买页面点击购买按钮
2. 系统调用 Apple IAP 完成支付
3. mobile 将 Apple 收据发送到后台服务验证
4. 后台验证成功后，更新用户的付费状态
5. 用户可以继续使用所有功能

#### 场景 4：恢复购买
1. 用户在新设备上安装应用
2. 用户点击"恢复购买"按钮
3. 系统从 Apple 获取历史购买记录
4. mobile 将收据发送到后台服务验证
5. 后台根据 original_transaction_id 识别用户并恢复付费状态
6. 用户可以在新设备上继续使用

---

## 4. 业务流程与信息架构

### 4.1 高层流程

#### 试用期管理流程
```
用户首次连接 msctl serve
  ↓
mobile 本地记录试用开始时间（expo-sqlite）
  ↓
每次启动时检查试用是否到期
  ↓
同时调用 RevenueCat SDK 检查付费状态
  ↓
if (试用未到期 OR 已付费)
  → 允许使用
else
  → 显示购买页面
```

#### 购买流程
```
用户点击购买按钮
  ↓
调用 RevenueCat SDK: Purchases.purchasePackage()
  ↓
RevenueCat SDK 调用 Apple IAP 完成支付
  ↓
RevenueCat 自动验证收据并更新用户权益
  ↓
SDK 返回 customerInfo（包含 entitlements）
  ↓
检查 customerInfo.entitlements.active['pro']
  ↓
存在 → 用户已解锁，可以继续使用
```

#### 恢复购买流程
```
用户点击"恢复购买"按钮
  ↓
调用 RevenueCat SDK: Purchases.restorePurchases()
  ↓
RevenueCat SDK 从 Apple 获取历史购买记录
  ↓
RevenueCat 自动验证并恢复用户权益
  ↓
SDK 返回 customerInfo（包含 entitlements）
  ↓
检查 customerInfo.entitlements.active['pro']
  ↓
存在 → 恢复成功，用户可以继续使用
  ↓
不存在 → 提示"未找到购买记录"
```

### 4.2 状态流转

用户付费状态：
- **未试用**：用户尚未首次连接 msctl serve
- **试用中**：用户在 7 天试用期内
- **试用到期**：试用期已过，未购买
- **已付费**：用户已购买买断

---

## 5. 数据模型与接口

### 5.1 核心数据实体

#### RevenueCat 管理的数据
RevenueCat 自动管理以下数据，无需自建数据库：
- **App User ID**：RevenueCat 生成的匿名用户 ID
- **Original Transaction ID**：Apple 原始交易 ID
- **Entitlements**：用户的权益状态（如 `pro`）
- **Purchase History**：购买历史记录
- **Subscription Status**：订阅状态（如果使用订阅制）

#### mobile 本地存储（expo-sqlite，可选）

如果需要在本地缓存试用开始时间：

| 字段 | 类型 | 说明 |
|------|------|------|
| `trial_start_time` | Timestamp | 试用开始时间（缓存） |
| `last_checked_at` | Timestamp | 最后一次检查付费状态的时间 |

**注意**：付费状态由 RevenueCat SDK 自动管理，无需手动缓存。

#### msctl serve 数据库（可选）

如果需要在 CLI 端查询付费状态，可以通过 RevenueCat Webhook 同步数据：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `app_user_id` | String | RevenueCat 用户 ID |
| `original_transaction_id` | String | Apple 原始交易 ID |
| `is_paid` | Boolean | 是否已付费 |
| `purchase_time` | Timestamp | 购买时间 |
| `created_at` | Timestamp | 创建时间 |
| `updated_at` | Timestamp | 更新时间 |

### 5.2 RevenueCat SDK 集成

使用 `react-native-purchases`（RevenueCat 官方 SDK）：

#### 初始化
```typescript
import Purchases from 'react-native-purchases';

// 在应用启动时初始化
await Purchases.configure({
  apiKey: 'your_revenuecat_api_key', // iOS 和 Android 使用不同的 key
});
```

#### 获取产品信息
```typescript
const offerings = await Purchases.getOfferings();
const lifetimePackage = offerings.current?.lifetime;
// lifetimePackage.product.priceString = "$19.99"
```

#### 购买
```typescript
try {
  const { customerInfo } = await Purchases.purchasePackage(lifetimePackage);
  const isPro = customerInfo.entitlements.active['pro'] !== undefined;
  if (isPro) {
    // 用户已解锁
  }
} catch (error) {
  if (error.userCancelled) {
    // 用户取消购买
  } else {
    // 购买失败
  }
}
```

#### 恢复购买
```typescript
try {
  const customerInfo = await Purchases.restorePurchases();
  const isPro = customerInfo.entitlements.active['pro'] !== undefined;
  if (isPro) {
    // 恢复成功
  } else {
    // 未找到购买记录
  }
} catch (error) {
  // 恢复失败
}
```

#### 检查付费状态
```typescript
const customerInfo = await Purchases.getCustomerInfo();
const isPro = customerInfo.entitlements.active['pro'] !== undefined;
```

### 5.3 RevenueCat 配置

#### 产品配置（在 RevenueCat Dashboard）
- **Entitlement ID**: `pro`（权益标识）
- **Product ID**: `com.multisoul.lifetime`（Apple IAP 产品 ID）
- **Type**: Non-Consumable（买断）
- **Price**: $19.99

#### Webhook（可选）
RevenueCat 可以在购买事件发生时通知你的后端：
- 事件类型：`INITIAL_PURCHASE`、`RENEWAL`、`CANCELLATION` 等
- Webhook URL：`https://your-backend.com/webhooks/revenuecat`
- 用途：同步付费状态到 msctl serve 数据库（可选）

---

## 6. 技术实现概览

### 6.1 整体架构

```
┌─────────────────┐
│  iOS App        │
│  (React Native) │
│                 │
│  - 购买页面     │
│  - 付费状态检查 │
│  - 本地缓存     │
└────────┬────────┘
         │
         │ HTTPS
         │
         ↓
┌─────────────────┐
│  RevenueCat     │
│  (SaaS)         │
│                 │
│  - 收据验证     │
│  - 付费状态管理 │
│  - 用户管理     │
│  - 分析面板     │
└────────┬────────┘
         │
         │ HTTPS
         │
         ↓
┌─────────────────┐
│  Apple Server   │
│                 │
│  - 收据验证     │
│  - IAP 服务     │
└─────────────────┘
```

### 6.2 关键技术决策

#### 后台服务：RevenueCat（推荐方案）
- **服务**：RevenueCat SaaS 平台
- **官网**：https://www.revenuecat.com/
- **定价**：月活 < 10,000 用户免费，超出后按用户数收费
- **功能**：
  - 自动处理 Apple IAP 收据验证
  - 跨设备用户识别和恢复购买
  - 内置分析面板（转化率、收入、留存等）
  - 支持 Webhook 通知
  - 未来可扩展到 Android（Google Play Billing）

**选择 RevenueCat 的理由**：
1. **节省开发时间**：无需自建后端，专注于应用功能
2. **降低审核风险**：行业标准方案，Apple 审核团队熟悉
3. **免费额度充足**：初期用户量完全免费
4. **未来扩展性**：支持 Android、订阅制等
5. **监控和分析**：内置面板帮助优化转化率

#### mobile 端
- **IAP 库**：`react-native-purchases`（RevenueCat 官方 SDK）
- **本地存储**：expo-sqlite（缓存付费状态，可选）
- **验证频率**：每次启动时通过 RevenueCat SDK 检查，支持离线使用（SDK 内置缓存）

#### 用户识别
- RevenueCat 自动使用 Apple 的 `original_transaction_id` 作为用户唯一标识
- 无需用户注册/登录，自动支持跨设备恢复购买
- RevenueCat 提供匿名用户 ID（App User ID），可选绑定自定义用户 ID

### 6.3 重要约束与假设

- **约束**：
  - **必须使用 Apple IAP**：根据 Apple App Store 审核指南，iOS 应用内的数字商品/服务（如解锁功能）必须使用 Apple IAP，禁止使用微信支付、支付宝等第三方支付
  - 必须支持恢复购买功能
  - 收据验证必须在后台服务完成（RevenueCat 自动处理）

- **假设**：
  - 用户在试用期内至少会连接一次网络（用于注册试用开始时间）
  - RevenueCat 服务的可用性 > 99.9%（官方 SLA）
  - Apple 收据验证 API 的响应时间 < 2 秒

- **支付方式说明**：
  - iOS 用户通过 Apple IAP 购买（$19.99）
  - 用户可以在 Apple ID 中绑定支付宝、微信支付、信用卡等作为支付方式
  - 实际支付走 Apple 通道（Apple 抽成 30%，开发者收入 $13.99）
  - 用户在 App Store 账单中看到的是 Apple 的扣款记录

---

## 7. UI/UX 需求

### 7.1 购买页面

#### 页面结构
- **标题**：「MultiSoul Premium」
- **副标题**：「解锁完整功能，支持开发者」
- **价格展示**：「$19.99」（大字号，醒目）
- **功能列表**：
  - ✓ 无限制使用所有功能
  - ✓ 一次购买，永久使用
  - ✓ 支持跨设备恢复购买
- **购买按钮**：「购买 $19.99」（橙色 #FF6B35，圆角 26px）
- **恢复购买按钮**：「恢复购买」（次要按钮，灰色）
- **试用提示**：「剩余 X 天试用」（试用期内显示）

#### 交互行为
- 点击购买按钮 → 调用 Apple IAP → 完成支付 → 验证收据 → 关闭购买页面
- 点击恢复购买按钮 → 调用 Apple IAP → 获取历史购买 → 验证收据 → 关闭购买页面
- 购买/恢复过程中显示 loading 状态

### 7.2 试用期提示

- **位置**：设置页面顶部
- **内容**：「试用剩余 X 天」（X ≤ 3 时显示橙色警告）
- **点击行为**：跳转到购买页面

### 7.3 到期后的锁定页面

- **全屏遮罩**：半透明黑色背景
- **中央卡片**：
  - 标题：「试用期已结束」
  - 描述：「感谢您试用 MultiSoul，购买后即可继续使用」
  - 购买按钮：「购买 $19.99」
  - 恢复购买按钮：「恢复购买」
- **无法关闭**：用户必须购买或恢复购买才能继续使用

---

## 8. 状态、错误与边界情况

### 8.1 常见错误场景

#### 错误 1：RevenueCat SDK 调用失败
- **原因**：网络问题、RevenueCat 服务故障、配置错误
- **处理**：
  - 向用户显示错误提示：「网络连接失败，请稍后重试」
  - SDK 内置重试机制
  - 允许用户重试

#### 错误 2：Apple IAP 购买失败
- **原因**：用户取消、支付失败、Apple 服务故障
- **处理**：
  - 用户取消：静默处理，不显示错误
  - 支付失败：显示 Apple 返回的错误信息
  - 允许用户重试

#### 错误 3：恢复购买失败
- **原因**：用户从未购买、网络问题
- **处理**：
  - 向用户显示提示：「未找到购买记录，请确认是否使用同一 Apple ID」
  - 引导用户重新购买

### 8.2 边界情况

#### 情况 1：用户在试用期内购买
- **处理**：立即更新付费状态，试用期提示消失

#### 情况 2：用户在多台设备上使用
- **处理**：使用 `original_transaction_id` 识别用户，自动同步付费状态

#### 情况 3：用户卸载并重新安装应用
- **处理**：通过恢复购买功能恢复付费状态

#### 情况 4：用户在离线环境下使用
- **处理**：
  - RevenueCat SDK 内置缓存机制，自动处理离线场景
  - 使用最后一次成功验证的付费状态
  - 下次联网时自动同步最新状态

---

## 9. 非功能性需求

### 9.1 性能与容量

- **收据验证响应时间**：< 2 秒（P95）
- **后台服务可用性**：> 99%
- **数据库查询响应时间**：< 100ms
- **预期用户量**：初期 < 1000 用户，后期可扩展到 10,000+

### 9.2 安全与权限

- **收据验证**：RevenueCat 自动在服务端验证 Apple 收据，确保安全性
- **数据传输**：RevenueCat SDK 使用 HTTPS 加密通信
- **收据存储**：RevenueCat 自动存储完整收据数据，用于审计和纠纷处理
- **防刷单**：RevenueCat 通过 Apple 的 `original_transaction_id` 防止重复购买
- **用户隐私**：RevenueCat 符合 GDPR 和 CCPA 要求，提供数据删除 API

### 9.3 可扩展性与可运维性

- **水平扩展**：RevenueCat 自动处理扩展，无需担心性能问题
- **监控与告警**：
  - RevenueCat Dashboard 提供实时监控（购买量、收入、转化率等）
  - 可以设置 Webhook 接收购买事件通知
  - 集成到自己的监控系统（可选）
- **日志记录**：
  - RevenueCat 自动记录所有购买和验证事件
  - 提供 REST API 查询历史数据
  - 支持导出数据到 CSV/JSON

---

## 10. 风险、权衡与未决问题

### 10.1 已知风险与应对思路

#### 风险 1：审核被拒
- **原因**：购买流程不清晰、功能不完整、违反 Apple 政策
- **应对**：
  - 在 TestFlight 阶段充分测试购买流程
  - 准备详细的测试账号和测试指引
  - 确保购买页面清晰展示价格和功能
  - 确保恢复购买功能正常工作

#### 风险 2：RevenueCat 服务可用性
- **原因**：RevenueCat 服务故障（极少发生）
- **应对**：
  - RevenueCat 官方 SLA 保证 99.9% 可用性
  - SDK 内置缓存机制，短期故障不影响用户使用
  - RevenueCat 提供状态页面：https://status.revenuecat.com/

#### 风险 3：RevenueCat 免费额度超限
- **原因**：月活用户超过 10,000
- **应对**：
  - 监控用户增长，提前规划预算
  - RevenueCat 定价透明：10K-50K MAU 约 $250/月
  - 如果成本过高，可以迁移到自建方案（RevenueCat 提供数据导出）

#### 风险 4：Apple 服务依赖
- **原因**：Apple 收据验证 API 故障或延迟
- **应对**：
  - RevenueCat 自动处理重试和超时
  - SDK 内置缓存机制，短期故障不影响用户
  - 向用户显示友好的错误提示

#### 风险 5：恢复购买失败
- **原因**：用户从未购买、使用了不同的 Apple ID
- **应对**：
  - RevenueCat 自动处理跨设备恢复
  - 提供清晰的错误提示：「请确认使用同一 Apple ID」
  - 提供客服支持渠道（GitHub Issues）

### 10.2 已做的 Trade-off

#### Trade-off 1：RevenueCat vs 自建后端
- **选择**：使用 RevenueCat
- **理由**：
  - 节省开发时间（1-2 周 vs 2-3 周）
  - 降低维护成本（无需自己运维后端）
  - 免费额度充足（< 10,000 MAU）
  - 行业标准方案，降低审核风险
  - 未来可扩展到 Android
- **代价**：
  - 依赖第三方服务（但 SLA 99.9%）
  - 超过免费额度后需要付费（但可以迁移）

#### Trade-off 2：实时验证 vs 缓存验证
- **选择**：RevenueCat SDK 自动处理（实时验证 + 缓存）
- **理由**：
  - SDK 内置最佳实践，无需手动实现
  - 自动平衡安全性和用户体验
  - 支持离线使用

#### Trade-off 3：买断制 vs 订阅制
- **选择**：买断制
- **理由**：
  - 降低用户购买门槛，提升转化率
  - 符合工具类应用的定价习惯
  - 简化付费逻辑和用户管理

#### Trade-off 4：Apple IAP vs 第三方支付
- **选择**：Apple IAP（强制）
- **理由**：
  - Apple 政策要求，数字商品必须使用 IAP
  - 用户可以在 Apple ID 中绑定支付宝/微信支付
  - 避免审核被拒

### 10.3 未决问题

- **问题 1**：是否需要提供家庭共享功能？
  - **当前决策**：暂不支持，后续根据用户反馈决定

- **问题 2**：是否需要提供教育优惠或批量购买？
  - **当前决策**：暂不支持，后续根据需求决定

- **问题 3**：是否需要提供退款功能？
  - **当前决策**：遵循 Apple 的退款政策，不在应用内实现

---

## 11. 验收标准与示例

### 11.1 验收 Checklist

#### 功能验收
- [ ] 用户首次连接 msctl serve 时，试用期开始计时
- [ ] 试用期到期后，应用完全锁定，显示购买页面
- [ ] 用户可以成功购买并解锁所有功能
- [ ] 用户可以在新设备上恢复购买
- [ ] 购买页面清晰展示价格和功能
- [ ] 恢复购买功能正常工作

#### 技术验收
- [ ] RevenueCat 项目配置完成
- [ ] IAP 产品在 App Store Connect 和 RevenueCat 中配置完成
- [ ] mobile 端成功集成 `react-native-purchases` SDK
- [ ] mobile 端可以成功调用 RevenueCat API
- [ ] 沙盒环境测试购买流程成功
- [ ] 恢复购买功能正常工作
- [ ] 离线模式下，应用可以使用 SDK 缓存的付费状态

#### 审核验收
- [ ] 在 App Store Connect 创建 IAP 产品
- [ ] 在 Apple Developer 创建沙盒测试账号
- [ ] 在 TestFlight 测试完整购买流程
- [ ] 准备审核材料（应用描述、截图、测试账号、测试指引）
- [ ] 提交审核并通过

### 11.2 代表性用例

#### 用例 1：新用户试用
1. 用户下载并安装 MultiSoul iOS 应用
2. 用户配置并首次成功连接到 msctl serve
3. 系统记录试用开始时间
4. 用户可以正常使用所有功能 7 天
5. 7 天后，应用显示购买页面

#### 用例 2：用户购买
1. 用户在购买页面点击"购买 $19.99"按钮
2. RevenueCat SDK 调用 Apple IAP 完成支付
3. RevenueCat 自动验证收据并更新用户权益
4. mobile 检查 `customerInfo.entitlements.active['pro']` 存在
5. 用户可以继续使用所有功能

#### 用例 3：恢复购买
1. 用户在新设备上安装应用
2. 用户点击"恢复购买"按钮
3. RevenueCat SDK 从 Apple 获取历史购买记录并验证
4. mobile 检查 `customerInfo.entitlements.active['pro']` 存在
5. 用户可以在新设备上继续使用

#### 用例 4：离线使用
1. 用户在有网络的情况下完成购买
2. RevenueCat SDK 缓存付费状态
3. 用户在离线环境下打开应用
4. SDK 使用缓存的付费状态，允许用户继续使用
5. 下次联网时，SDK 自动同步最新状态

---

## 12. 上架流程与时间线

### 12.1 开发阶段（预计 1-2 周）

#### Week 1：RevenueCat 配置与 mobile 端开发
- [ ] 注册 RevenueCat 账号并创建项目
- [ ] 在 App Store Connect 创建 IAP 产品（`com.multisoul.lifetime`, $19.99）
- [ ] 在 RevenueCat Dashboard 配置 Entitlement 和 Product
- [ ] 集成 `react-native-purchases` SDK
- [ ] 实现购买页面 UI
- [ ] 实现付费状态检查逻辑
- [ ] 实现试用期管理（本地存储）
- [ ] 实现恢复购买功能
- [ ] 编写单元测试

#### Week 2：集成测试与优化
- [ ] 端到端测试购买流程（沙盒环境）
- [ ] 测试恢复购买功能
- [ ] 测试试用期到期逻辑
- [ ] 性能优化和错误处理
- [ ] UI/UX 优化
- [ ] 集成 RevenueCat Webhook（可选，用于同步到 msctl serve）

### 12.2 上架准备阶段（预计 1-2 周）

#### 配置 IAP 产品
- [ ] 在 App Store Connect 创建 IAP 产品
  - Product ID: `com.multisoul.lifetime`
  - Type: Non-Consumable (买断)
  - Price: $19.99
- [ ] 在 Apple Developer 创建沙盒测试账号

#### TestFlight 测试
- [ ] 上传 TestFlight 版本
- [ ] 使用沙盒测试账号测试购买流程
- [ ] 测试恢复购买功能
- [ ] 收集测试反馈并修复问题

#### 准备审核材料
- [ ] 应用描述和截图
- [ ] 测试账号和测试指引
- [ ] 隐私政策和服务条款
- [ ] 演示视频（可选）

### 12.3 审核与上架阶段（预计 1-2 周）

- [ ] 提交 App Review
- [ ] 等待审核结果（通常 1-3 天）
- [ ] 如果被拒，根据反馈修改并重新提交
- [ ] 审核通过后，正式上架

### 12.4 总时间线

- **开发阶段**：1-2 周
- **上架准备**：1-2 周
- **审核与上架**：1-2 周
- **总计**：3-6 周

**注**：使用 RevenueCat 后，开发时间从原计划的 4-7 周缩短到 3-6 周，因为无需自建后端服务。

---

## 13. 附录

### 13.1 相关文档

- [RevenueCat 官方文档](https://www.revenuecat.com/docs/)
- [RevenueCat React Native SDK](https://www.revenuecat.com/docs/getting-started/installation/reactnative)
- [Apple In-App Purchase 官方文档](https://developer.apple.com/in-app-purchase/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [RevenueCat 定价](https://www.revenuecat.com/pricing/)
- [RevenueCat 状态页面](https://status.revenuecat.com/)

### 13.2 技术选型对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **RevenueCat** | 快速集成、免费额度高、行业标准、支持多平台 | 依赖第三方、超额付费 | ⭐⭐⭐⭐⭐ |
| **自建 Node.js 后端** | 完全自主控制、无用户数限制 | 开发时间长、需要运维 | ⭐⭐⭐ |
| **Adapty** | 类似 RevenueCat | 社区较小、文档较少 | ⭐⭐⭐ |
| **仅客户端验证** | 最简单 | 不安全、易破解、违反最佳实践 | ❌ 不推荐 |

### 13.3 支付方式说明

**关于微信支付和支付宝**：
- iOS 应用内的数字商品（如解锁功能）**必须使用 Apple IAP**，这是 Apple 的强制要求
- 用户可以在 Apple ID 中绑定支付宝或微信支付作为支付方式
- 实际支付走 Apple 通道，Apple 抽成 30%
- 如果使用第三方支付（微信/支付宝直接支付），会导致应用被拒或下架

**例外情况**（不适用于 MultiSoul）：
- 实体商品（如电商购物）
- 线下服务（如打车、外卖）
- 跨平台内容消费（如 Netflix，但需要在网页端完成支付）

### 13.4 联系方式

- **GitHub Issues**：https://github.com/yakami0129/multisoul/issues
- **开发者**：yakami0129
- **RevenueCat 支持**：https://community.revenuecat.com/

---

**文档版本**：v2.0（使用 RevenueCat）
**创建日期**：2026-05-24
**最后更新**：2026-05-24
**变更说明**：从自建 Node.js 后端方案改为使用 RevenueCat SaaS 平台
