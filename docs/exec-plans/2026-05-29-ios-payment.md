# iOS 付费机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1（Cloudflare Tunnel）基础上叠加 14 天试用 + $12.99 买断付费门禁，集成 RevenueCat，完成 App Store 上架准备。

**Architecture:** mobile 端用 expo-sqlite 记录 `trial_start_time`（首次 Auto Tunnel 连接时写入），每次启动同时检查本地试用状态和 RevenueCat entitlement；试用到期且未付费时 Auto Tunnel 选项显示锁定，弹出购买页面；购买/恢复购买通过 `react-native-purchases` SDK 完成，RevenueCat 自动验证 Apple 收据。

**Tech Stack:** react-native-purchases (RevenueCat SDK), expo-sqlite, RevenueCat SaaS, Apple IAP (Non-Consumable, com.multisoul.lifetime, $12.99)

**前置条件（人工操作，不在代码任务中）：**
1. 注册 RevenueCat 账号：https://app.revenuecat.com/
2. 在 App Store Connect 创建 IAP 产品：Product ID `com.multisoul.lifetime`，Type: Non-Consumable，Price: $12.99
3. 在 RevenueCat Dashboard 创建 Entitlement `pro`，关联上述产品
4. 获取 RevenueCat iOS API Key（格式：`appl_xxx`）

---

## File Structure

```
mobile/src/
├── features/payment/           CREATE — 新 feature 目录
│   ├── services/
│   │   ├── paymentService.ts   CREATE — RevenueCat 初始化、购买、恢复、状态检查
│   │   └── trialService.ts     CREATE — 试用期本地管理（expo-sqlite）
│   ├── components/
│   │   └── PurchaseScreen.tsx  CREATE — 购买页面 UI
│   └── hooks/
│       └── usePaymentStatus.ts CREATE — 统一付费状态 hook
├── features/settings/
│   └── components/
│       └── SettingsForm.tsx    MODIFY — Auto Tunnel 选项加付费锁定逻辑
└── store/
    └── paymentStore.ts         CREATE — 付费状态 Zustand store
```

---
## Task 1: 安装 react-native-purchases + 初始化

**Files:**
- Modify: `mobile/package.json` — 添加 react-native-purchases
- Create: `mobile/src/features/payment/services/paymentService.ts`

- [ ] **Step 1: 安装 SDK**

```bash
cd mobile
pnpm add react-native-purchases@8
```

> react-native-purchases v8 支持 Expo SDK 55，无需额外 native 配置（使用 Expo managed workflow 时通过 config plugin 自动处理）。

- [ ] **Step 2: 在 `app.json` 或 `app.config.js` 中添加 config plugin**

检查 `mobile/app.json`，在 `plugins` 数组中追加：

```json
"react-native-purchases"
```

完整示例（仅追加，不替换现有 plugins）：

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "react-native-purchases"
    ]
  }
}
```

- [ ] **Step 3: 写失败测试（paymentService 初始化）**

创建 `mobile/src/features/payment/services/paymentService.test.ts`：

```typescript
import { initPayments, getPaymentStatus } from './paymentService';

jest.mock('react-native-purchases', () => ({
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue({
      entitlements: { active: {} },
    }),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
}));

describe('paymentService', () => {
  it('calls Purchases.configure with iOS API key', async () => {
    const Purchases = require('react-native-purchases').default;
    await initPayments();
    expect(Purchases.configure).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.stringMatching(/^appl_/) }),
    );
  });

  it('returns isPaid=false when no active pro entitlement', async () => {
    const status = await getPaymentStatus();
    expect(status.isPaid).toBe(false);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=paymentService --watchAll=false 2>&1 | tail -10
# 期望: Cannot find module './paymentService'
```

- [ ] **Step 5: 创建 `paymentService.ts`**

```typescript
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// 替换为你的 RevenueCat iOS API Key
const REVENUECAT_IOS_API_KEY = 'appl_REPLACE_WITH_YOUR_KEY';
const ENTITLEMENT_ID = 'pro';
const PRODUCT_ID = 'com.multisoul.lifetime';

export interface PaymentStatus {
  isPaid: boolean;
}

export async function initPayments(): Promise<void> {
  Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  await Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
}

export async function getPaymentStatus(): Promise<PaymentStatus> {
  const customerInfo = await Purchases.getCustomerInfo();
  const isPaid = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  return { isPaid };
}

export async function purchaseLifetime(): Promise<PaymentStatus> {
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find(
    (p) => p.product.identifier === PRODUCT_ID,
  );
  if (!pkg) {
    throw new Error('Lifetime package not found. Check RevenueCat dashboard configuration.');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const isPaid = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  return { isPaid };
}

export async function restorePurchases(): Promise<PaymentStatus> {
  const customerInfo = await Purchases.restorePurchases();
  const isPaid = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  return { isPaid };
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=paymentService --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/payment/services/paymentService.test.ts
```

- [ ] **Step 7: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | head -20
# 期望: 无错误
```

- [ ] **Step 8: 提交**

```bash
git add mobile/src/features/payment/services/paymentService.ts
git add mobile/src/features/payment/services/paymentService.test.ts
git add mobile/app.json
git commit -m "feat(mobile): install react-native-purchases, add paymentService"
```

---
## Task 2: 试用期管理（trialService + expo-sqlite）

**Files:**
- Create: `mobile/src/features/payment/services/trialService.ts`

### 背景

试用期数据存在 expo-sqlite（已有 `getDb()` 工具）。新增表 `trial_state`：
- `trial_start_time` INTEGER — Unix 时间戳（毫秒），首次 Auto Tunnel 连接时写入
- `trial_days` INTEGER — 试用天数（固定 14）

状态判断：
- `未试用`：`trial_start_time` 为 null
- `试用中`：`now - trial_start_time < 14 * 86400 * 1000`
- `试用到期`：`now - trial_start_time >= 14 * 86400 * 1000`

- [ ] **Step 1: 写失败测试**

创建 `mobile/src/features/payment/services/trialService.test.ts`：

```typescript
import { getTrialStatus, startTrial, TRIAL_DAYS } from './trialService';

// mock expo-sqlite getDb
jest.mock('@/db', () => ({
  getDb: () => ({
    runAsync: jest.fn(),
    getFirstAsync: jest.fn().mockResolvedValue(null),
  }),
}));

describe('trialService', () => {
  it('returns status=not_started when no trial_start_time in DB', async () => {
    const status = await getTrialStatus();
    expect(status.phase).toBe('not_started');
    expect(status.daysRemaining).toBe(TRIAL_DAYS);
  });

  it('returns status=active when trial started recently', async () => {
    const recentStart = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
    jest.mock('@/db', () => ({
      getDb: () => ({
        runAsync: jest.fn(),
        getFirstAsync: jest.fn().mockResolvedValue({ trial_start_time: recentStart }),
      }),
    }));
    // re-import after mock change
    jest.resetModules();
    const { getTrialStatus: getTrialStatusFresh } = await import('./trialService');
    const status = await getTrialStatusFresh();
    expect(status.phase).toBe('active');
    expect(status.daysRemaining).toBe(12); // 14 - 2
  });

  it('returns status=expired when trial started 15 days ago', async () => {
    const oldStart = Date.now() - 15 * 24 * 60 * 60 * 1000;
    jest.mock('@/db', () => ({
      getDb: () => ({
        runAsync: jest.fn(),
        getFirstAsync: jest.fn().mockResolvedValue({ trial_start_time: oldStart }),
      }),
    }));
    jest.resetModules();
    const { getTrialStatus: getTrialStatusFresh } = await import('./trialService');
    const status = await getTrialStatusFresh();
    expect(status.phase).toBe('expired');
    expect(status.daysRemaining).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=trialService --watchAll=false 2>&1 | tail -10
# 期望: Cannot find module './trialService'
```

- [ ] **Step 3: 创建 `trialService.ts`**

```typescript
import { getDb } from '@/db';

export const TRIAL_DAYS = 14;

export type TrialPhase = 'not_started' | 'active' | 'expired';

export interface TrialStatus {
  phase: TrialPhase;
  daysRemaining: number;
  trialStartTime: number | null;
}

async function ensureTable(): Promise<void> {
  const db = getDb();
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS trial_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      trial_start_time INTEGER,
      trial_days INTEGER NOT NULL DEFAULT 14
    )
  `);
  // 确保只有一行
  await db.runAsync(`
    INSERT OR IGNORE INTO trial_state (id, trial_days) VALUES (1, 14)
  `);
}

export async function startTrial(): Promise<void> {
  await ensureTable();
  const db = getDb();
  // 只在未开始时写入（幂等）
  await db.runAsync(
    `UPDATE trial_state SET trial_start_time = ? WHERE id = 1 AND trial_start_time IS NULL`,
    [Date.now()],
  );
}

export async function getTrialStatus(): Promise<TrialStatus> {
  await ensureTable();
  const db = getDb();
  const row = await db.getFirstAsync<{ trial_start_time: number | null }>(
    `SELECT trial_start_time FROM trial_state WHERE id = 1`,
  );

  const trialStartTime = row?.trial_start_time ?? null;

  if (trialStartTime === null) {
    return { phase: 'not_started', daysRemaining: TRIAL_DAYS, trialStartTime: null };
  }

  const elapsedMs = Date.now() - trialStartTime;
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  const daysRemaining = Math.max(0, TRIAL_DAYS - elapsedDays);

  if (daysRemaining > 0) {
    return { phase: 'active', daysRemaining, trialStartTime };
  }
  return { phase: 'expired', daysRemaining: 0, trialStartTime };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=trialService --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/payment/services/trialService.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add mobile/src/features/payment/services/trialService.ts
git add mobile/src/features/payment/services/trialService.test.ts
git commit -m "feat(mobile): add trialService with expo-sqlite trial period management"
```

---
## Task 3: paymentStore + usePaymentStatus hook

**Files:**
- Create: `mobile/src/store/paymentStore.ts`
- Create: `mobile/src/features/payment/hooks/usePaymentStatus.ts`

### 背景

`paymentStore` 持有全局付费状态，app 启动时初始化。`usePaymentStatus` hook 封装「允许使用 Auto Tunnel」的判断逻辑：`isPaid || trialPhase === 'active'`。

- [ ] **Step 1: 写失败测试（usePaymentStatus）**

创建 `mobile/src/features/payment/hooks/usePaymentStatus.test.ts`：

```typescript
import { renderHook } from '@testing-library/react-hooks';
import { usePaymentStatus } from './usePaymentStatus';
import { usePaymentStore } from '@/store/paymentStore';

jest.mock('@/store/paymentStore');

describe('usePaymentStatus', () => {
  it('canUseAutoTunnel=true when isPaid=true', () => {
    (usePaymentStore as jest.Mock).mockReturnValue({
      isPaid: true,
      trialPhase: 'expired',
      daysRemaining: 0,
    });
    const { result } = renderHook(() => usePaymentStatus());
    expect(result.current.canUseAutoTunnel).toBe(true);
  });

  it('canUseAutoTunnel=true when trial is active', () => {
    (usePaymentStore as jest.Mock).mockReturnValue({
      isPaid: false,
      trialPhase: 'active',
      daysRemaining: 10,
    });
    const { result } = renderHook(() => usePaymentStatus());
    expect(result.current.canUseAutoTunnel).toBe(true);
  });

  it('canUseAutoTunnel=false when trial expired and not paid', () => {
    (usePaymentStore as jest.Mock).mockReturnValue({
      isPaid: false,
      trialPhase: 'expired',
      daysRemaining: 0,
    });
    const { result } = renderHook(() => usePaymentStatus());
    expect(result.current.canUseAutoTunnel).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=usePaymentStatus --watchAll=false 2>&1 | tail -10
# 期望: Cannot find module './usePaymentStatus'
```

- [ ] **Step 3: 创建 `paymentStore.ts`**

```typescript
import { create } from 'zustand';
import { getPaymentStatus } from '@/features/payment/services/paymentService';
import { getTrialStatus, type TrialPhase } from '@/features/payment/services/trialService';

interface PaymentState {
  isPaid: boolean;
  trialPhase: TrialPhase;
  daysRemaining: number;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isPaid: false,
  trialPhase: 'not_started',
  daysRemaining: 14,
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [paymentStatus, trialStatus] = await Promise.all([
        getPaymentStatus(),
        getTrialStatus(),
      ]);
      set({
        isPaid: paymentStatus.isPaid,
        trialPhase: trialStatus.phase,
        daysRemaining: trialStatus.daysRemaining,
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 4: 创建 `usePaymentStatus.ts`**

```typescript
import { usePaymentStore } from '@/store/paymentStore';
import type { TrialPhase } from '@/features/payment/services/trialService';

export interface PaymentStatusResult {
  isPaid: boolean;
  trialPhase: TrialPhase;
  daysRemaining: number;
  canUseAutoTunnel: boolean;
}

export function usePaymentStatus(): PaymentStatusResult {
  const { isPaid, trialPhase, daysRemaining } = usePaymentStore();
  const canUseAutoTunnel = isPaid || trialPhase === 'active';
  return { isPaid, trialPhase, daysRemaining, canUseAutoTunnel };
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=usePaymentStatus --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/payment/hooks/usePaymentStatus.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add mobile/src/store/paymentStore.ts
git add mobile/src/features/payment/hooks/usePaymentStatus.ts
git add mobile/src/features/payment/hooks/usePaymentStatus.test.ts
git commit -m "feat(mobile): add paymentStore and usePaymentStatus hook"
```

---
## Task 4: PurchaseScreen 购买页面 UI

**Files:**
- Create: `mobile/src/features/payment/components/PurchaseScreen.tsx`

### 背景

购买页面展示：
- 标题「Unlock MultiSoul」
- 价格「$12.99」（大字号）
- 功能列表（3 条）
- 试用剩余天数提示（试用中时显示）
- 购买按钮（橙色 #FF6B35）
- 恢复购买按钮（次要）

- [ ] **Step 1: 写失败测试**

创建 `mobile/src/features/payment/components/PurchaseScreen.test.tsx`：

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PurchaseScreen } from './PurchaseScreen';
import { purchaseLifetime, restorePurchases } from '@/features/payment/services/paymentService';
import { usePaymentStore } from '@/store/paymentStore';

jest.mock('@/features/payment/services/paymentService');
jest.mock('@/store/paymentStore', () => ({
  usePaymentStore: jest.fn(() => ({
    trialPhase: 'active',
    daysRemaining: 10,
    refresh: jest.fn(),
  })),
}));

describe('PurchaseScreen', () => {
  it('renders price and purchase button', () => {
    const { getByText } = render(<PurchaseScreen onClose={jest.fn()} />);
    expect(getByText('Unlock MultiSoul')).toBeTruthy();
    expect(getByText('$12.99')).toBeTruthy();
    expect(getByText('Purchase')).toBeTruthy();
    expect(getByText('Restore Purchase')).toBeTruthy();
  });

  it('shows trial days remaining when trial is active', () => {
    const { getByText } = render(<PurchaseScreen onClose={jest.fn()} />);
    expect(getByText(/10 days remaining/)).toBeTruthy();
  });

  it('calls purchaseLifetime on Purchase button press', async () => {
    (purchaseLifetime as jest.Mock).mockResolvedValueOnce({ isPaid: true });
    const onClose = jest.fn();
    const { getByText } = render(<PurchaseScreen onClose={onClose} />);
    fireEvent.press(getByText('Purchase'));
    await waitFor(() => expect(purchaseLifetime).toHaveBeenCalled());
  });

  it('calls restorePurchases on Restore button press', async () => {
    (restorePurchases as jest.Mock).mockResolvedValueOnce({ isPaid: false });
    const { getByText } = render(<PurchaseScreen onClose={jest.fn()} />);
    fireEvent.press(getByText('Restore Purchase'));
    await waitFor(() => expect(restorePurchases).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=PurchaseScreen --watchAll=false 2>&1 | tail -10
# 期望: Cannot find module './PurchaseScreen'
```

- [ ] **Step 3: 创建 `PurchaseScreen.tsx`**

```typescript
import React, { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { purchaseLifetime, restorePurchases } from '@/features/payment/services/paymentService';
import { usePaymentStore } from '@/store/paymentStore';

interface PurchaseScreenProps {
  onClose: () => void;
}

const FEATURES = [
  'Auto tunnel — zero config',
  'One-time purchase, lifetime access',
  'Restore purchase on any device',
];

export function PurchaseScreen({ onClose }: PurchaseScreenProps) {
  const insets = useSafeAreaInsets();
  const { trialPhase, daysRemaining, refresh } = usePaymentStore();
  const [loading, setLoading] = useState(false);

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const status = await purchaseLifetime();
      await refresh();
      if (status.isPaid) {
        Alert.alert('Unlocked!', 'Thank you for your purchase.', [
          { text: 'OK', onPress: onClose },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Purchase failed';
      // 用户取消时 RevenueCat 抛出特定错误码，静默处理
      if (!msg.includes('userCancelled')) {
        Alert.alert('Purchase Failed', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      const status = await restorePurchases();
      await refresh();
      if (status.isPaid) {
        Alert.alert('Restored!', 'Your purchase has been restored.', [
          { text: 'OK', onPress: onClose },
        ]);
      } else {
        Alert.alert('No Purchase Found', 'No previous purchase found for this Apple ID.');
      }
    } catch (err) {
      Alert.alert('Restore Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      className="flex-1 bg-[#0D0D0D]"
    >
      <View className="px-6 pt-12 pb-8 items-center">
        <Text className="text-[28px] font-bold text-white mb-2">Unlock MultiSoul</Text>
        <Text className="text-[#888888] text-[14px] text-center mb-6">
          Auto tunnel without manual setup
        </Text>

        {/* 价格 */}
        <Text className="text-[48px] font-bold text-white mb-1">$12.99</Text>
        <Text className="text-[#888888] text-[12px] mb-8">One-time purchase</Text>

        {/* 试用剩余提示 */}
        {trialPhase === 'active' && (
          <View className="bg-[#1A1A1A] rounded-[12px] px-4 py-2 mb-6">
            <Text className="text-[#FF6B35] text-[13px]">
              {daysRemaining} days remaining in trial
            </Text>
          </View>
        )}

        {/* 功能列表 */}
        <View className="w-full mb-8">
          {FEATURES.map((feature) => (
            <View key={feature} className="flex-row items-center mb-3">
              <Text className="text-[#4CAF50] text-[16px] mr-3">✓</Text>
              <Text className="text-[#DDDDDD] text-[14px]">{feature}</Text>
            </View>
          ))}
        </View>

        {/* 购买按钮 */}
        <TouchableOpacity
          onPress={() => { void handlePurchase(); }}
          disabled={loading}
          className="w-full bg-[#FF6B35] rounded-[26px] h-[52px] items-center justify-center mb-4"
        >
          <Text className="text-white text-[16px] font-semibold">
            {loading ? 'Processing...' : 'Purchase'}
          </Text>
        </TouchableOpacity>

        {/* 恢复购买 */}
        <TouchableOpacity
          onPress={() => { void handleRestore(); }}
          disabled={loading}
          className="w-full bg-[#1A1A1A] rounded-[26px] h-[52px] items-center justify-center"
        >
          <Text className="text-[#888888] text-[14px]">Restore Purchase</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=PurchaseScreen --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/payment/components/PurchaseScreen.test.tsx
```

- [ ] **Step 5: 提交**

```bash
git add mobile/src/features/payment/components/PurchaseScreen.tsx
git add mobile/src/features/payment/components/PurchaseScreen.test.tsx
git commit -m "feat(mobile): add PurchaseScreen UI with purchase and restore buttons"
```

---
## Task 5: SettingsForm 付费锁定 + 试用到期弹窗

**Files:**
- Modify: `mobile/src/features/settings/components/SettingsForm.tsx`

### 背景

在 Phase 1 的 SettingsForm 基础上叠加付费逻辑：
- Auto Tunnel 选项：`canUseAutoTunnel=false` 时显示 🔒，点击弹出购买页面
- App 启动时（SettingsForm mount）调用 `paymentStore.refresh()` 刷新状态
- 试用到期且未付费时，Auto Tunnel 模式下保存前检查权限

- [ ] **Step 1: 写失败测试（锁定状态）**

在 `SettingsForm.test.tsx` 追加：

```typescript
import { usePaymentStatus } from '@/features/payment/hooks/usePaymentStatus';

jest.mock('@/features/payment/hooks/usePaymentStatus');

describe('SettingsForm payment lock', () => {
  it('shows lock icon on Auto Tunnel when canUseAutoTunnel=false', () => {
    (usePaymentStatus as jest.Mock).mockReturnValue({
      isPaid: false,
      trialPhase: 'expired',
      daysRemaining: 0,
      canUseAutoTunnel: false,
    });
    const { getByText } = render(<SettingsForm />);
    // 🔒 应该出现在 Auto Tunnel 按钮旁
    expect(getByText(/🔒/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=SettingsForm --watchAll=false 2>&1 | tail -10
# 期望: FAIL — 找不到 🔒
```

- [ ] **Step 3: 修改 `SettingsForm.tsx`**

在文件顶部追加 import：

```typescript
import { usePaymentStatus } from '@/features/payment/hooks/usePaymentStatus';
import { usePaymentStore } from '@/store/paymentStore';
import { PurchaseScreen } from '@/features/payment/components/PurchaseScreen';
import { Modal } from 'react-native';
import { startTrial } from '@/features/payment/services/trialService';
```

在 `SettingsForm` 函数体内追加：

```typescript
  const { canUseAutoTunnel } = usePaymentStatus();
  const { refresh: refreshPayment } = usePaymentStore();
  const [showPurchase, setShowPurchase] = useState(false);

  // 启动时刷新付费状态
  React.useEffect(() => {
    void refreshPayment();
  }, [refreshPayment]);
```

将 Auto Tunnel 按钮替换为（加锁定逻辑）：

```typescript
            <TouchableOpacity
              onPress={() => {
                if (!canUseAutoTunnel) {
                  setShowPurchase(true);
                  return;
                }
                setMode('auto');
              }}
              className={`flex-1 py-3 rounded-[26px] items-center ${
                mode === 'auto' && canUseAutoTunnel ? 'bg-[#FF6B35]' : 'bg-[#1A1A1A]'
              }`}
            >
              <Text className={`text-[14px] font-semibold ${
                mode === 'auto' && canUseAutoTunnel ? 'text-white' : 'text-[#888888]'
              }`}>
                Auto Tunnel {!canUseAutoTunnel ? '🔒' : ''}
              </Text>
            </TouchableOpacity>
```

在 `return` 的 JSX 末尾（`</KeyboardAvoidingView>` 之前）追加：

```typescript
      {/* 购买弹窗 */}
      <Modal visible={showPurchase} animationType="slide" presentationStyle="pageSheet">
        <PurchaseScreen onClose={() => {
          setShowPurchase(false);
          void refreshPayment();
        }} />
      </Modal>
```

修改 `handleSave` 中 Auto Tunnel 分支，在 `pollTunnelUrl` 之前加权限检查：

```typescript
      if (mode === 'auto') {
        if (!canUseAutoTunnel) {
          setShowPurchase(true);
          return;
        }
        if (!relayToken.trim()) {
          Alert.alert('Missing Token', 'Please enter your msctl Bearer token.');
          return;
        }
        resolvedServerUrl = await pollTunnelUrl(settings.relayWorkerUrl, relayToken.trim());
        resolvedApiKey = relayToken.trim();
        // 首次连接成功时开始试用计时
        await startTrial();
      }
```

- [ ] **Step 4: 运行所有 settings 测试**

```bash
cd mobile && pnpm test -- --testPathPattern=settings --watchAll=false 2>&1 | tail -15
# 期望: 全部 PASS
```

- [ ] **Step 5: 全量测试 + typecheck**

```bash
cd mobile && pnpm typecheck && pnpm test -- --watchAll=false 2>&1 | tail -20
# 期望: 无错误，全部通过
```

- [ ] **Step 6: 提交**

```bash
git add mobile/src/features/settings/components/SettingsForm.tsx
git add mobile/src/features/settings/components/SettingsForm.test.tsx
git commit -m "feat(mobile): add payment lock to Auto Tunnel, trial start on first connect"
```

---
## Task 6: App 启动初始化 + 试用到期弹窗

**Files:**
- Modify: `mobile/app/_layout.tsx` 或 `mobile/index.ts` — 启动时初始化 RevenueCat + 刷新付费状态

### 背景

App 启动时需要：
1. 调用 `initPayments()` 初始化 RevenueCat SDK
2. 调用 `paymentStore.refresh()` 加载付费状态

试用到期弹窗在 SettingsForm 内处理（Task 5），不需要全局弹窗。

- [ ] **Step 1: 找到 app 入口文件**

```bash
ls mobile/app/_layout.tsx mobile/app/index.tsx 2>/dev/null
# 确认入口文件路径
```

- [ ] **Step 2: 在 `_layout.tsx` 中追加初始化**

找到 `_layout.tsx` 中的 `useEffect` 或根组件 mount 逻辑，追加：

```typescript
import { initPayments } from '@/features/payment/services/paymentService';
import { usePaymentStore } from '@/store/paymentStore';

// 在根组件内：
const { refresh: refreshPayment } = usePaymentStore();

useEffect(() => {
  void (async () => {
    try {
      await initPayments();
      await refreshPayment();
    } catch (e) {
      // RevenueCat 初始化失败不阻塞 app 启动
      console.warn('Payment init failed:', e);
    }
  })();
}, []);
```

- [ ] **Step 3: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | head -20
# 期望: 无错误
```

- [ ] **Step 4: 提交**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat(mobile): initialize RevenueCat and refresh payment status on app start"
```

---

## Task 7: App Store Connect 配置 + TestFlight 验证（人工操作）

**Files:** 无代码变更，全为人工操作步骤。

- [ ] **Step 1: App Store Connect 创建 IAP 产品**

1. 登录 https://appstoreconnect.apple.com/
2. 选择 MultiSoul 应用 → In-App Purchases → (+)
3. 填写：
   - Type: Non-Consumable
   - Reference Name: MultiSoul Lifetime
   - Product ID: `com.multisoul.lifetime`
4. 价格：$12.99（Tier 13）
5. 本地化：英文描述「Lifetime access to Auto Tunnel feature」
6. 状态：Ready to Submit

- [ ] **Step 2: 创建沙盒测试账号**

1. App Store Connect → Users and Access → Sandbox Testers → (+)
2. 填写测试邮箱（不能是真实 Apple ID）
3. 记录账号和密码

- [ ] **Step 3: 构建 TestFlight 版本**

```bash
cd mobile && ./scripts/publish-ios-local.sh --build-only
# 构建完成后在 Xcode Organizer 上传到 App Store Connect
```

- [ ] **Step 4: TestFlight 沙盒测试**

在 iOS 设备上：
1. 安装 TestFlight 版本
2. 设置 → App Store → 沙盒账号（登录测试账号）
3. 打开 MultiSoul → Settings → Auto Tunnel → 点击 🔒
4. 验证购买弹窗出现，价格显示 $12.99
5. 点击 Purchase → 沙盒支付 → 验证解锁成功
6. 卸载重装 → 点击 Restore Purchase → 验证恢复成功

- [ ] **Step 5: 准备审核材料**

创建以下文件（存放在 `docs/app-store/` 目录）：
- `description.txt` — 应用描述（英文，含 IAP 说明）
- `test-account.txt` — 沙盒测试账号和密码（供 Apple 审核员使用）
- `test-instructions.txt` — 测试步骤说明

`test-instructions.txt` 内容模板：

```
Test Account: sandbox-test@example.com
Password: TestPassword123

Steps to test Auto Tunnel (paid feature):
1. Install msctl on Mac: npm install -g @yakami129/msctl
2. Run: msctl serve --relay
3. Copy the Bearer token shown in terminal
4. Open MultiSoul app → Settings → Auto Tunnel
5. Paste Bearer token → Save
6. App should connect automatically

Steps to test purchase:
1. Tap Auto Tunnel (shows 🔒 after 14-day trial)
2. Tap "Purchase" → complete sandbox payment
3. Auto Tunnel should unlock

Steps to test restore:
1. Uninstall and reinstall app
2. Settings → Auto Tunnel → tap 🔒 → "Restore Purchase"
3. Purchase should be restored
```

- [ ] **Step 6: 提交 App Review**

1. App Store Connect → 选择 TestFlight 版本 → Submit for Review
2. 填写：
   - 是否使用加密：No（Cloudflare Tunnel 使用标准 TLS）
   - IAP 信息：已配置 com.multisoul.lifetime
   - 测试账号：填写 Step 2 的沙盒账号
3. 提交

---

## 验收 Checklist

- [ ] RevenueCat Dashboard 显示 Entitlement `pro` 已配置
- [ ] App Store Connect IAP 产品 `com.multisoul.lifetime` 状态为 Ready to Submit
- [ ] 沙盒环境购买流程完整（购买 → 解锁 → 恢复购买）
- [ ] 试用期 14 天计时正确（首次 Auto Tunnel 连接时开始）
- [ ] 试用到期后 Auto Tunnel 显示 🔒
- [ ] 购买页面价格显示 $12.99
- [ ] 恢复购买功能正常
- [ ] `pnpm test --watchAll=false` 全部通过
- [ ] `pnpm typecheck` 无错误
- [ ] TestFlight 版本上传成功
- [ ] App Review 提交成功
