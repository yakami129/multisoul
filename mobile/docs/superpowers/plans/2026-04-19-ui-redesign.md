# MultiSoul Mobile UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `StyleSheet.create()` with NativeWind v4 utility classes, introduce a shared design token system, self-written UI components (Button/Card/Badge/Input), Lucide icons, Reanimated animations, and Dark Mode support across all three screens.

**Architecture:** NativeWind v4 wraps React Native's `StyleSheet` at the Babel/Metro transform layer — components use `className` props instead of `style` objects. A central `tailwind.config.js` holds all design tokens (colors, radius, spacing). Four reusable components in `src/components/ui/` are built on top of NativeWind and consumed by all screens.

**Tech Stack:** NativeWind v4, tailwindcss, lucide-react-native, react-native-reanimated, pnpm

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `tailwind.config.js` | Design tokens — colors, radius, dark mode |
| Create | `global.css` | Tailwind directives entry point |
| Modify | `babel.config.js` | Add NativeWind babel plugin |
| Modify | `app/_layout.tsx` | Import global.css |
| Create | `src/components/ui/Button.tsx` | Reusable button with variants + Reanimated press |
| Create | `src/components/ui/Card.tsx` | Surface card with border + shadow |
| Create | `src/components/ui/Badge.tsx` | Status pill (active/error/inactive) |
| Create | `src/components/ui/Input.tsx` | Styled text input with focus state |
| Modify | `src/components/ErrorBoundary.tsx` | Replace StyleSheet with NativeWind |
| Modify | `app/(tabs)/_layout.tsx` | Lucide icons, NativeWind tab bar |
| Modify | `app/(tabs)/index.tsx` | NativeWind + Card + Badge + Reanimated list |
| Modify | `app/(tabs)/settings.tsx` | NativeWind + Input + Button |
| Modify | `app/agent/[id].tsx` | NativeWind + Card + Badge + Button + Reanimated modal |
| Create | `src/__tests__/ui/Button.test.tsx` | Button component tests |
| Create | `src/__tests__/ui/Badge.test.tsx` | Badge component tests |

---

## Task 1: Install dependencies and configure NativeWind v4

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.js`
- Create: `global.css`
- Modify: `babel.config.js`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Install NativeWind v4 and peer dependencies**

```bash
cd /path/to/multisoul/mobile
pnpm add nativewind tailwindcss
pnpm add -D react-native-reanimated lucide-react-native
```

Expected: `pnpm-lock.yaml` updated, no peer dependency errors.

- [ ] **Step 2: Create `tailwind.config.js`**

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#007AFF',
          dark: '#0A84FF',
        },
        success: '#22c55e',
        danger:  '#ef4444',
        muted:   '#9ca3af',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Create `global.css`**

```css
/* global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Update `babel.config.js` to add NativeWind plugin**

Current content:
```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

Replace with:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['nativewind/babel'],
  };
};
```

- [ ] **Step 5: Import `global.css` in `app/_layout.tsx`**

Add as the very first import line:
```tsx
import '../global.css';
```

Full updated `app/_layout.tsx`:
```tsx
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 10_000 } },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="agent/[id]" options={{ headerShown: false }} />
          </Stack>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 6: Add Reanimated plugin to `babel.config.js`**

NativeWind plugin must come before Reanimated. Update:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'nativewind/babel',
      'react-native-reanimated/plugin',
    ],
  };
};
```

- [ ] **Step 7: Verify existing tests still pass**

```bash
pnpm test
```

Expected: `Tests: 12 passed, 12 total` — NativeWind config changes don't affect Jest because tests mock native modules.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tailwind.config.js global.css babel.config.js app/_layout.tsx
git commit -m "feat: install NativeWind v4, Reanimated, Lucide; add tailwind config"
```

<!-- APPEND_TASK2 -->

## Task 2: Create `Badge` component

**Files:**
- Create: `src/components/ui/Badge.tsx`
- Create: `src/__tests__/ui/Badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/ui/Badge.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Badge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('renders active status with correct text', () => {
    render(<Badge status="active" />);
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('renders error status', () => {
    render(<Badge status="error" />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders inactive status', () => {
    render(<Badge status="inactive" />);
    expect(screen.getByText('inactive')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/__tests__/ui/Badge.test.tsx
```

Expected: FAIL — `Cannot find module '../../components/ui/Badge'`

- [ ] **Step 3: Create `src/components/ui/Badge.tsx`**

```tsx
import React from 'react';
import { Text, View } from 'react-native';
import { AgentStatus } from '../../types';

const VARIANT_CLASSES: Record<AgentStatus, string> = {
  active:   'bg-success',
  error:    'bg-danger',
  inactive: 'bg-muted',
};

interface BadgeProps {
  status: AgentStatus;
}

export function Badge({ status }: BadgeProps) {
  return (
    <View className={`px-2 py-0.5 rounded-full self-start ${VARIANT_CLASSES[status]}`}>
      <Text className="text-white text-xs font-bold uppercase">{status}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/__tests__/ui/Badge.test.tsx
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Badge.tsx src/__tests__/ui/Badge.test.tsx
git commit -m "feat: add Badge UI component with NativeWind"
```

---

## Task 3: Create `Button` component

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/__tests__/ui/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/ui/Button.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Button } from '../../components/ui/Button';

describe('Button', () => {
  it('renders label text', () => {
    render(<Button label="Save" onPress={() => {}} />);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loading text when loading', () => {
    render(<Button label="Save" onPress={() => {}} loading loadingLabel="Saving..." />);
    expect(screen.getByText('Saving...')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/__tests__/ui/Button.test.tsx
```

Expected: FAIL — `Cannot find module '../../components/ui/Button'`

- [ ] **Step 3: Create `src/components/ui/Button.tsx`**

```tsx
import React from 'react';
import { Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';

const VARIANT_CLASSES: Record<Variant, { container: string; text: string }> = {
  primary:     { container: 'bg-primary dark:bg-primary-dark',                              text: 'text-white' },
  secondary:   { container: 'bg-transparent border border-slate-300 dark:border-slate-600', text: 'text-slate-800 dark:text-slate-100' },
  destructive: { container: 'bg-danger',                                                    text: 'text-white' },
};

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const { container, text } = VARIANT_CLASSES[variant];

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      className={`rounded-xl py-4 items-center ${container} ${isDisabled ? 'opacity-50' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
    >
      <Text className={`text-base font-semibold ${text}`}>
        {loading && loadingLabel ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/__tests__/ui/Button.test.tsx
```

Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Button.tsx src/__tests__/ui/Button.test.tsx
git commit -m "feat: add Button UI component with NativeWind variants"
```

---

## Task 4: Create `Card` and `Input` components

**Files:**
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Input.tsx`

- [ ] **Step 1: Create `src/components/ui/Card.tsx`**

```tsx
import React from 'react';
import { View, ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <View
      className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}
```

- [ ] **Step 2: Create `src/components/ui/Input.tsx`**

```tsx
import React, { useState } from 'react';
import { Text, TextInput, TextInputProps, View } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  className?: string;
}

export function Input({ label, className = '', ...props }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View className="mb-5">
      {label ? (
        <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
          {label}
        </Text>
      ) : null}
      <TextInput
        className={`border rounded-xl px-3 py-3 text-base bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 ${
          focused
            ? 'border-primary dark:border-primary-dark'
            : 'border-slate-200 dark:border-slate-700'
        } ${className}`}
        placeholderTextColor="#94a3b8"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...props}
      />
    </View>
  );
}
```

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: `Tests: 19 passed, 19 total` (12 existing + 3 Badge + 4 Button)

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Card.tsx src/components/ui/Input.tsx
git commit -m "feat: add Card and Input UI components"
```

---

## Task 5: Rewrite Tab navigation with Lucide icons

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Replace emoji icons with Lucide + NativeWind tab bar styles**

Full replacement of `app/(tabs)/_layout.tsx`:
```tsx
import { Tabs } from 'expo-router';
import { Settings, Zap } from 'lucide-react-native';
import React from 'react';
import { useColorScheme } from 'react-native';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: isDark ? '#64748b' : '#8e8e93',
        tabBarStyle: {
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          borderTopColor: isDark ? '#1e293b' : '#e2e8f0',
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Agents',
          tabBarIcon: ({ color, size }) => <Zap color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: Run navigation test to verify it still passes**

```bash
pnpm test src/__tests__/navigation.test.tsx
```

Expected: `Tests: 1 passed, 1 total`

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/_layout.tsx
git commit -m "feat: replace emoji tab icons with lucide-react-native"
```

---

## Task 6: Rewrite Agent list screen with NativeWind + Card + Badge + Reanimated

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Run existing index test to confirm baseline**

```bash
pnpm test src/__tests__/index.test.tsx
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 2: Replace `app/(tabs)/index.tsx` with NativeWind version**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Zap } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { getApiClient } from '../../src/api';
import { Agent } from '../../src/types';

async function fetchAgents(): Promise<Agent[]> {
  const client = await getApiClient();
  const res = await client.get<Agent[]>('/api/v1/agents');
  return res.data;
}

function AgentItem({ agent, onPress, index }: { agent: Agent; onPress: () => void; index: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable onPress={onPress} className="mx-4 my-1.5 active:opacity-70">
        <Card>
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <Zap size={16} color="#007AFF" />
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1" numberOfLines={1}>
                {agent.name}
              </Text>
            </View>
            <Badge status={agent.status} />
          </View>
          <Text className="text-xs text-slate-400 mb-1" numberOfLines={1}>{agent.endpoint}</Text>
          {agent.description ? (
            <Text className="text-sm text-slate-500 dark:text-slate-400" numberOfLines={2}>{agent.description}</Text>
          ) : null}
        </Card>
      </Pressable>
    </Animated.View>
  );
}

export default function AgentListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-3 text-slate-500 text-base">Loading agents...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Text className="text-lg font-semibold text-danger mb-2">Failed to load agents.</Text>
        <Text className="text-sm text-slate-400 text-center mb-4">{String(error)}</Text>
        <Button label="Retry" onPress={() => refetch()} />
      </View>
    );
  }

  const agents = data ?? [];

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <Text className="text-3xl font-bold text-slate-900 dark:text-slate-100 px-4 py-3">Agents</Text>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <AgentItem
            agent={item}
            index={index}
            onPress={() => router.push(`/agent/${item.id}`)}
          />
        )}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-base text-slate-400">No agents registered yet.</Text>
          </View>
        }
        contentContainerStyle={agents.length === 0 ? { flex: 1 } : { paddingBottom: 24 }}
      />
    </View>
  );
}
```

- [ ] **Step 3: Run index test to verify it still passes**

```bash
pnpm test src/__tests__/index.test.tsx
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 4: Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat: rewrite agent list screen with NativeWind + Card + Badge + Reanimated"
```

---

## Task 7: Rewrite Settings screen with NativeWind + Input + Button

**Files:**
- Modify: `app/(tabs)/settings.tsx`

- [ ] **Step 1: Run existing settings test to confirm baseline**

```bash
pnpm test src/__tests__/settings.test.tsx
```

Expected: `Tests: 1 passed, 1 total`

- [ ] **Step 2: Replace `app/(tabs)/settings.tsx` with NativeWind version**

```tsx
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { Input } from '../../src/components/ui/Input';
import { loadSettings, saveSettings } from '../../src/settingsStore';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl, setServerUrl] = useState('http://localhost:8080');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setServerUrl(s.serverUrl);
      setApiKey(s.apiKey);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ serverUrl: serverUrl.trim(), apiKey: apiKey.trim() });
      Alert.alert('Saved', 'Settings saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-bold text-slate-900 dark:text-slate-100 px-4 pt-4 pb-6">
          Settings
        </Text>

        <Card className="mx-4">
          <Input
            label="Server URL"
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://localhost:8080"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Input
            label="API Key"
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="ms_..."
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Button
            label="Save"
            onPress={handleSave}
            loading={saving}
            loadingLabel="Saving..."
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 3: Run settings test to verify it still passes**

```bash
pnpm test src/__tests__/settings.test.tsx
```

Expected: `Tests: 1 passed, 1 total`

> The test uses `getByPlaceholderText('http://localhost:8080')` and `getByPlaceholderText('ms_...')` — these placeholders are preserved in the Input component, so the test continues to work.

- [ ] **Step 4: Commit**

```bash
git add app/(tabs)/settings.tsx
git commit -m "feat: rewrite settings screen with NativeWind + Input + Button + Card"
```

---

## Task 8: Rewrite Agent detail screen with NativeWind + Card + Badge + Button + Reanimated modal

**Files:**
- Modify: `app/agent/[id].tsx`

- [ ] **Step 1: Run existing agent detail test to confirm baseline**

```bash
pnpm test src/__tests__/agentDetail.test.tsx
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 2: Replace `app/agent/[id].tsx` with NativeWind version**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Play } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { getApiClient } from '../../src/api';
import { Agent } from '../../src/types';

async function fetchAgent(id: string): Promise<Agent> {
  const client = await getApiClient();
  const res = await client.get<Agent>(`/api/v1/agents/${id}`);
  return res.data;
}

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [invoking, setInvoking] = useState(false);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => fetchAgent(id!),
    enabled: !!id,
  });

  const handleInvoke = async () => {
    if (!id) return;
    setInvoking(true);
    setInvokeError(null);
    try {
      const client = await getApiClient();
      const res = await client.post(`/api/v1/agents/${id}/invoke`);
      const data = res.data;
      if (typeof data === 'object' && Object.keys(data).length === 1 && typeof Object.values(data)[0] === 'string') {
        setInvokeResult(Object.values(data)[0] as string);
      } else {
        setInvokeResult(JSON.stringify(data, null, 2));
      }
    } catch (e: any) {
      setInvokeError(e?.response?.data?.error ?? e?.message ?? 'Unknown error');
      setInvokeResult(null);
    } finally {
      setInvoking(false);
      setModalVisible(true);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900">
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (isError || !agent) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Text className="text-lg font-semibold text-danger mb-3">Failed to load agent.</Text>
        <Pressable onPress={() => router.back()}>
          <Text className="text-primary text-base">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center gap-1 mb-4">
          <ArrowLeft size={18} color="#007AFF" />
          <Text className="text-primary text-base">Back</Text>
        </Pressable>

        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">{agent.name}</Text>
        <Badge status={agent.status} />

        <Card className="mt-4 gap-3">
          <View>
            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Endpoint</Text>
            <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.endpoint}</Text>
          </View>
          {agent.description ? (
            <View>
              <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Description</Text>
              <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.description}</Text>
            </View>
          ) : null}
          <View>
            <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">ID</Text>
            <Text className="text-sm text-slate-700 dark:text-slate-300">{agent.id}</Text>
          </View>
        </Card>

        <View className="mt-6">
          {invoking ? (
            <View className="rounded-xl py-4 items-center bg-primary opacity-50">
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <Button label="Invoke" onPress={handleInvoke} />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <Animated.View
            entering={SlideInDown.springify()}
            className="bg-white dark:bg-slate-800 rounded-t-3xl p-6 max-h-[70%]"
          >
            <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Invoke Response</Text>
            <ScrollView className="max-h-72 mb-4">
              {invokeError ? (
                <Text className="text-sm text-danger">{invokeError}</Text>
              ) : (
                <Text className="text-sm text-slate-700 dark:text-slate-300 font-mono">{invokeResult}</Text>
              )}
            </ScrollView>
            <Button label="Close" onPress={() => setModalVisible(false)} variant="secondary" />
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}
```

- [ ] **Step 3: Run agent detail test to verify it still passes**

```bash
pnpm test src/__tests__/agentDetail.test.tsx
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 4: Commit**

```bash
git add app/agent/[id].tsx
git commit -m "feat: rewrite agent detail screen with NativeWind + Reanimated modal"
```

---

## Task 9: Rewrite ErrorBoundary + final verification

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Replace StyleSheet in `src/components/ErrorBoundary.tsx`**

```tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-xl font-bold text-danger mb-2">Something went wrong</Text>
          <Text className="text-sm text-slate-500 text-center mb-5">{this.state.error?.message}</Text>
          <Pressable
            className="bg-primary px-6 py-2.5 rounded-lg"
            onPress={this.handleReset}
          >
            <Text className="text-white font-semibold">Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: `Tests: 19 passed, 19 total` (12 original + 3 Badge + 4 Button), all suites green.

- [ ] **Step 3: Run TypeScript check**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ErrorBoundary.tsx
git commit -m "feat: rewrite ErrorBoundary with NativeWind"
```

- [ ] **Step 5: Final commit tagging the complete redesign**

```bash
git add -A
git commit -m "chore: complete UI redesign — NativeWind v4 + Lucide + Reanimated + Dark Mode"
```

---

## Self-Review Checklist

- [x] **NativeWind v4 installed and configured** — Task 1
- [x] **tailwind.config.js with iOS blue + Slate tokens** — Task 1
- [x] **Dark Mode support** — `darkMode: 'class'` in config + `dark:` variants in all components
- [x] **Badge component** — Task 2
- [x] **Button component with variants** — Task 3
- [x] **Card component** — Task 4
- [x] **Input component with focus state** — Task 4
- [x] **lucide-react-native icons** — Tasks 5, 6, 8
- [x] **react-native-reanimated animations** — Tasks 6 (FadeInDown list), 8 (SlideInDown modal)
- [x] **Tab navigation rewritten** — Task 5
- [x] **Agent list screen rewritten** — Task 6
- [x] **Settings screen rewritten** — Task 7
- [x] **Agent detail screen rewritten** — Task 8
- [x] **ErrorBoundary rewritten** — Task 9
- [x] **All 12 existing tests preserved** — verified in each task
- [x] **7 new component tests added** — Badge (3) + Button (4)
- [x] **TypeScript check passes** — Task 9 Step 3
