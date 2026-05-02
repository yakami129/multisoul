# Code Structure Refactor Implementation Plan

> **来源：** 由 `mobile/docs/superpowers/plans/2026-04-19-code-structure-refactor.md` 迁入 `docs/exec-plans/`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the codebase from a flat src/ + fat app/ pages layout into a feature-based architecture with clear layer boundaries.

**Architecture:** Feature domains (`src/features/agents/`, `src/features/settings/`) each own their components, services, and hooks. App pages become thin route wrappers. Zustand manages cross-page local state (settings); React Query handles server state.

**Tech Stack:** Expo Router, React Query v5, Zustand, NativeWind v4, TypeScript, Jest + @testing-library/react-native

---

## Tasks

### Task 1: Setup — Install Zustand + create directory structure

**Files:**
- Run: `pnpm add zustand`
- Create dirs: `src/features/agents/components/`, `src/features/agents/services/`, `src/features/settings/components/`, `src/features/settings/services/`, `src/store/`

- [ ] **Step 1: Install Zustand**

```bash
pnpm add zustand
```

Expected: `zustand` appears in `package.json` dependencies.

- [ ] **Step 2: Create feature directories**

```bash
mkdir -p src/features/agents/components src/features/agents/services
mkdir -p src/features/settings/components src/features/settings/services
mkdir -p src/store
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install zustand, scaffold feature directories"
```

---

### Task 2: agentService — HTTP calls for agents

**Files:**
- Create: `src/features/agents/services/agentService.ts`
- Create: `src/features/agents/services/agentService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/agents/services/agentService.test.ts`:

```typescript
import axios from 'axios';
import { fetchAgents, fetchAgent, invokeAgent } from './agentService';
import { Agent } from '@/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockAgent: Agent = {
  id: 'a1',
  name: 'Test Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'desc',
};

describe('agentService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchAgents returns array of agents', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [mockAgent] });
    const result = await fetchAgents(mockedAxios);
    expect(result).toEqual([mockAgent]);
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/agents');
  });

  it('fetchAgent returns single agent by id', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: mockAgent });
    const result = await fetchAgent(mockedAxios, 'a1');
    expect(result).toEqual(mockAgent);
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/agents/a1');
  });

  it('invokeAgent returns string result', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { result: 'ok' } });
    const result = await invokeAgent(mockedAxios, 'a1');
    expect(result).toBe('ok');
  });

  it('invokeAgent returns JSON string for multi-key response', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { a: '1', b: '2' } });
    const result = await invokeAgent(mockedAxios, 'a1');
    expect(result).toBe(JSON.stringify({ a: '1', b: '2' }, null, 2));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm jest src/features/agents/services/agentService.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './agentService'`

- [ ] **Step 3: Implement agentService**

Create `src/features/agents/services/agentService.ts`:

```typescript
import { AxiosInstance } from 'axios';
import { Agent } from '@/types';

export async function fetchAgents(client: AxiosInstance): Promise<Agent[]> {
  const res = await client.get<Agent[]>('/api/v1/agents');
  return res.data;
}

export async function fetchAgent(client: AxiosInstance, id: string): Promise<Agent> {
  const res = await client.get<Agent>(`/api/v1/agents/${id}`);
  return res.data;
}

export async function invokeAgent(client: AxiosInstance, id: string): Promise<string> {
  const res = await client.post(`/api/v1/agents/${id}/invoke`);
  const data = res.data;
  if (
    typeof data === 'object' &&
    Object.keys(data).length === 1 &&
    typeof Object.values(data)[0] === 'string'
  ) {
    return Object.values(data)[0] as string;
  }
  return JSON.stringify(data, null, 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm jest src/features/agents/services/agentService.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/services/
git commit -m "feat: add agentService with fetchAgents, fetchAgent, invokeAgent"
```

---

### Task 3: settingsService — AsyncStorage helpers

**Files:**
- Create: `src/features/settings/services/settingsService.ts`
- Create: `src/features/settings/services/settingsService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/settings/services/settingsService.test.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSettings, saveSettings, Settings } from './settingsService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('settingsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loadSettings returns defaults when storage is empty', async () => {
    mockStorage.getItem.mockResolvedValueOnce(null);
    const result = await loadSettings();
    expect(result).toEqual({ serverUrl: 'http://localhost:8080', apiKey: '' });
  });

  it('loadSettings returns stored values', async () => {
    const stored: Settings = { serverUrl: 'http://prod:8080', apiKey: 'ms_abc' };
    mockStorage.getItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await loadSettings();
    expect(result).toEqual(stored);
  });

  it('saveSettings writes JSON to AsyncStorage', async () => {
    mockStorage.setItem.mockResolvedValueOnce(undefined);
    const s: Settings = { serverUrl: 'http://prod:8080', apiKey: 'ms_abc' };
    await saveSettings(s);
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      'multisoul_settings',
      JSON.stringify(s),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm jest src/features/settings/services/settingsService.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './settingsService'`

- [ ] **Step 3: Implement settingsService**

Create `src/features/settings/services/settingsService.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  serverUrl: string;
  apiKey: string;
}

const STORAGE_KEY = 'multisoul_settings';
const DEFAULTS: Settings = { serverUrl: 'http://localhost:8080', apiKey: '' };

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  return { ...DEFAULTS, ...JSON.parse(raw) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm jest src/features/settings/services/settingsService.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/services/
git commit -m "feat: add settingsService (loadSettings, saveSettings)"
```

---

### Task 4: settingsStore — Zustand store

**Files:**
- Create: `src/store/settingsStore.ts`
- Create: `src/store/settingsStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/settingsStore.test.ts`:

```typescript
import { act } from '@testing-library/react-native';
import { loadSettings, saveSettings } from '@/features/settings/services/settingsService';
import { useSettingsStore } from './settingsStore';

jest.mock('@/features/settings/services/settingsService');
const mockLoad = loadSettings as jest.MockedFunction<typeof loadSettings>;
const mockSave = saveSettings as jest.MockedFunction<typeof saveSettings>;

describe('useSettingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ settings: { serverUrl: 'http://localhost:8080', apiKey: '' } });
  });

  it('load() fetches settings and stores them', async () => {
    mockLoad.mockResolvedValueOnce({ serverUrl: 'http://prod:8080', apiKey: 'ms_abc' });
    await act(async () => {
      await useSettingsStore.getState().load();
    });
    expect(useSettingsStore.getState().settings).toEqual({
      serverUrl: 'http://prod:8080',
      apiKey: 'ms_abc',
    });
  });

  it('save() persists settings and updates store', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const next = { serverUrl: 'http://new:9090', apiKey: 'ms_xyz' };
    await act(async () => {
      await useSettingsStore.getState().save(next);
    });
    expect(mockSave).toHaveBeenCalledWith(next);
    expect(useSettingsStore.getState().settings).toEqual(next);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm jest src/store/settingsStore.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './settingsStore'`

- [ ] **Step 3: Implement settingsStore**

Create `src/store/settingsStore.ts`:

```typescript
import { create } from 'zustand';
import { loadSettings, saveSettings, Settings } from '@/features/settings/services/settingsService';

interface SettingsState {
  settings: Settings;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { serverUrl: 'http://localhost:8080', apiKey: '' },
  load: async () => {
    const settings = await loadSettings();
    set({ settings });
  },
  save: async (s: Settings) => {
    await saveSettings(s);
    set({ settings: s });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm jest src/store/settingsStore.test.ts --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/
git commit -m "feat: add Zustand settingsStore (load, save)"
```

---

### Task 5: Update src/api.ts — sync Zustand read

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Read current api.ts**

```bash
cat src/api.ts
```

- [ ] **Step 2: Replace async loadSettings() with sync Zustand read**

Replace the contents of `src/api.ts` with:

```typescript
import axios from 'axios';
import { useSettingsStore } from '@/store/settingsStore';

export function getApiClient() {
  const { serverUrl, apiKey } = useSettingsStore.getState().settings;
  const client = axios.create({ baseURL: serverUrl });
  if (apiKey) {
    client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
  }
  return client;
}
```

Note: `getApiClient` is now synchronous (no `async`/`await`). Update all call sites in the next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/api.ts
git commit -m "refactor: make getApiClient sync via Zustand store"
```

---

### Task 6: AgentCard component

**Files:**
- Create: `src/features/agents/components/AgentCard.tsx`
- Create: `src/features/agents/components/AgentCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/components/AgentCard.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AgentCard } from './AgentCard';
import { Agent } from '@/types';

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'A test agent',
};

describe('AgentCard', () => {
  it('renders agent name and endpoint', () => {
    const { getByText } = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('http://localhost:9000')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);
    fireEvent.press(getByText('My Agent'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm jest src/features/agents/components/AgentCard.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './AgentCard'`

- [ ] **Step 3: Implement AgentCard**

Create `src/features/agents/components/AgentCard.tsx`:

```typescript
import { Zap } from 'lucide-react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Agent } from '@/types';

interface Props {
  agent: Agent;
  onPress: () => void;
  index: number;
}

export function AgentCard({ agent, onPress, index }: Props) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable onPress={onPress} className="mx-4 my-1.5 active:opacity-70">
        <Card>
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <Zap size={16} color="#007AFF" />
              <Text
                className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1"
                numberOfLines={1}
              >
                {agent.name}
              </Text>
            </View>
            <Badge status={agent.status} />
          </View>
          <Text className="text-xs text-slate-400 mb-1" numberOfLines={1}>
            {agent.endpoint}
          </Text>
          {agent.description ? (
            <Text className="text-sm text-slate-500 dark:text-slate-400" numberOfLines={2}>
              {agent.description}
            </Text>
          ) : null}
        </Card>
      </Pressable>
    </Animated.View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm jest src/features/agents/components/AgentCard.test.tsx --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/components/AgentCard.tsx src/features/agents/components/AgentCard.test.tsx
git commit -m "feat: add AgentCard component"
```

---

### Task 7: InvokeModal component

**Files:**
- Create: `src/features/agents/components/InvokeModal.tsx`
- Create: `src/features/agents/components/InvokeModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/components/InvokeModal.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { InvokeModal } from './InvokeModal';

describe('InvokeModal', () => {
  it('renders result text when visible', () => {
    const { getByText } = render(
      <InvokeModal visible result="hello world" error={null} onClose={() => {}} />,
    );
    expect(getByText('hello world')).toBeTruthy();
  });

  it('renders error text when error is set', () => {
    const { getByText } = render(
      <InvokeModal visible result={null} error="something failed" onClose={() => {}} />,
    );
    expect(getByText('something failed')).toBeTruthy();
  });

  it('calls onClose when Close button pressed', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <InvokeModal visible result="ok" error={null} onClose={onClose} />,
    );
    fireEvent.press(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm jest src/features/agents/components/InvokeModal.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './InvokeModal'`

- [ ] **Step 3: Implement InvokeModal**

Create `src/features/agents/components/InvokeModal.tsx`:

```typescript
import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { Button } from '@/components/ui/Button';

interface Props {
  visible: boolean;
  result: string | null;
  error: string | null;
  onClose: () => void;
}

export function InvokeModal({ visible, result, error, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <Animated.View
          entering={SlideInDown.springify()}
          className="bg-white dark:bg-slate-800 rounded-t-3xl p-6 max-h-[70%]"
        >
          <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">
            Invoke Response
          </Text>
          <ScrollView className="max-h-72 mb-4">
            {error ? (
              <Text className="text-sm text-danger">{error}</Text>
            ) : (
              <Text className="text-sm text-slate-700 dark:text-slate-300 font-mono">{result}</Text>
            )}
          </ScrollView>
          <Button label="Close" onPress={onClose} variant="secondary" />
        </Animated.View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm jest src/features/agents/components/InvokeModal.test.tsx --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/components/InvokeModal.tsx src/features/agents/components/InvokeModal.test.tsx
git commit -m "feat: add InvokeModal component"
```

---

### Task 8: AgentList screen component

**Files:**
- Create: `src/features/agents/components/AgentList.tsx`
- Create: `src/features/agents/components/AgentList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/components/AgentList.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AgentList } from './AgentList';
import { Agent } from '@/types';

const agents: Agent[] = [
  { id: 'a1', name: 'Alpha', status: 'active', endpoint: 'http://a', description: '' },
  { id: 'a2', name: 'Beta', status: 'inactive', endpoint: 'http://b', description: 'desc' },
];

describe('AgentList', () => {
  it('renders list of agents', () => {
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });

  it('shows loading indicator when isLoading', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading isFetching={false} isError={false} error={null}
        onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Loading agents...')).toBeTruthy();
  });

  it('shows error state when isError', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading={false} isFetching={false} isError
        error={new Error('net fail')} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Failed to load agents.')).toBeTruthy();
  });

  it('calls onAgentPress with agent id', () => {
    const onAgentPress = jest.fn();
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={onAgentPress} />,
    );
    fireEvent.press(getByText('Alpha'));
    expect(onAgentPress).toHaveBeenCalledWith('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm jest src/features/agents/components/AgentList.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './AgentList'`

- [ ] **Step 3: Implement AgentList**

Create `src/features/agents/components/AgentList.tsx`:

```typescript
import React from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Agent } from '@/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: Agent[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onAgentPress: (id: string) => void;
}

export function AgentList({ agents, isLoading, isError, error, isFetching, onRefetch, onAgentPress }: Props) {
  const insets = useSafeAreaInsets();

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
        <Button label="Retry" onPress={onRefetch} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <Text className="text-3xl font-bold text-slate-900 dark:text-slate-100 px-4 py-3">Agents</Text>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <AgentCard agent={item} index={index} onPress={() => onAgentPress(item.id)} />
        )}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={onRefetch} />}
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

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm jest src/features/agents/components/AgentList.test.tsx --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/components/AgentList.tsx src/features/agents/components/AgentList.test.tsx
git commit -m "feat: add AgentList screen component"
```

---

### Task 9: AgentDetail screen component

**Files:**
- Create: `src/features/agents/components/AgentDetail.tsx`
- Create: `src/features/agents/components/AgentDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agents/components/AgentDetail.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AgentDetail } from './AgentDetail';
import { Agent } from '@/types';

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'A test agent',
};

describe('AgentDetail', () => {
  it('renders loading state', () => {
    const { getByTestId } = render(
      <AgentDetail agent={undefined} isLoading isError={false} onBack={() => {}} onInvoke={async () => 'ok'} />,
    );
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  it('renders agent details', () => {
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={() => {}} onInvoke={async () => 'ok'} />,
    );
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('http://localhost:9000')).toBeTruthy();
  });

  it('calls onBack when Back pressed', () => {
    const onBack = jest.fn();
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={onBack} onInvoke={async () => 'ok'} />,
    );
    fireEvent.press(getByText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows modal with result after invoke', async () => {
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={() => {}}
        onInvoke={async () => 'invoke result'} />,
    );
    fireEvent.press(getByText('Invoke'));
    await waitFor(() => expect(getByText('invoke result')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm jest src/features/agents/components/AgentDetail.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './AgentDetail'`

- [ ] **Step 3: Implement AgentDetail**

Create `src/features/agents/components/AgentDetail.tsx`:

```typescript
import { ArrowLeft } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Agent } from '@/types';
import { InvokeModal } from './InvokeModal';

interface Props {
  agent: Agent | undefined;
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onInvoke: () => Promise<string>;
}

export function AgentDetail({ agent, isLoading, isError, onBack, onInvoke }: Props) {
  const insets = useSafeAreaInsets();
  const [invoking, setInvoking] = useState(false);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleInvoke = async () => {
    setInvoking(true);
    setInvokeError(null);
    try {
      const result = await onInvoke();
      setInvokeResult(result);
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
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900" testID="loading-indicator">
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (isError || !agent) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Text className="text-lg font-semibold text-danger mb-3">Failed to load agent.</Text>
        <Pressable onPress={onBack}>
          <Text className="text-primary text-base">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Pressable onPress={onBack} className="flex-row items-center gap-1 mb-4">
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
      <InvokeModal
        visible={modalVisible}
        result={invokeResult}
        error={invokeError}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm jest src/features/agents/components/AgentDetail.test.tsx --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/components/AgentDetail.tsx src/features/agents/components/AgentDetail.test.tsx
git commit -m "feat: add AgentDetail screen component"
```

---

### Task 10: SettingsForm component

**Files:**
- Create: `src/features/settings/components/SettingsForm.tsx`
- Create: `src/features/settings/components/SettingsForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/components/SettingsForm.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SettingsForm } from './SettingsForm';
import { useSettingsStore } from '@/store/settingsStore';

jest.mock('@/store/settingsStore');
const mockUseSettingsStore = useSettingsStore as jest.MockedFunction<typeof useSettingsStore>;

describe('SettingsForm', () => {
  const mockSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSettingsStore.mockReturnValue({
      settings: { serverUrl: 'http://localhost:8080', apiKey: '' },
      load: jest.fn(),
      save: mockSave,
    } as any);
  });

  it('renders server URL and API key inputs', () => {
    const { getByDisplayValue } = render(<SettingsForm />);
    expect(getByDisplayValue('http://localhost:8080')).toBeTruthy();
  });

  it('calls save with updated values on Save press', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const { getByDisplayValue, getByText } = render(<SettingsForm />);
    fireEvent.changeText(getByDisplayValue('http://localhost:8080'), 'http://prod:9090');
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({
      serverUrl: 'http://prod:9090',
      apiKey: '',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm jest src/features/settings/components/SettingsForm.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './SettingsForm'`

- [ ] **Step 3: Implement SettingsForm**

Create `src/features/settings/components/SettingsForm.tsx`:

```typescript
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useSettingsStore } from '@/store/settingsStore';

export function SettingsForm() {
  const insets = useSafeAreaInsets();
  const { settings, save } = useSettingsStore();
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({ serverUrl: serverUrl.trim(), apiKey: apiKey.trim() });
      Alert.alert('Saved', 'Settings saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="flex-1 bg-slate-50 dark:bg-slate-900"
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
          <Button label="Save" onPress={handleSave} loading={saving} loadingLabel="Saving..." />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm jest src/features/settings/components/SettingsForm.test.tsx --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/components/SettingsForm.tsx src/features/settings/components/SettingsForm.test.tsx
git commit -m "feat: add SettingsForm component"
```

---

### Task 11: Thin out app pages

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Modify: `app/agent/[id].tsx`

- [ ] **Step 1: Replace app/(tabs)/index.tsx**

```typescript
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { getApiClient } from '@/api';
import { fetchAgents } from '@/features/agents/services/agentService';
import { AgentList } from '@/features/agents/components/AgentList';

export default function AgentListScreen() {
  const router = useRouter();
  const client = getApiClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetchAgents(client),
    refetchInterval: 30_000,
  });

  return (
    <AgentList
      agents={data ?? []}
      isLoading={isLoading}
      isError={isError}
      error={error}
      isFetching={isFetching}
      onRefetch={refetch}
      onAgentPress={(id) => router.push(`/agent/${id}`)}
    />
  );
}
```

- [ ] **Step 2: Replace app/(tabs)/settings.tsx**

```typescript
import React from 'react';
import { SettingsForm } from '@/features/settings/components/SettingsForm';

export default function SettingsScreen() {
  return <SettingsForm />;
}
```

- [ ] **Step 3: Replace app/agent/[id].tsx**

```typescript
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { getApiClient } from '@/api';
import { fetchAgent, invokeAgent } from '@/features/agents/services/agentService';
import { AgentDetail } from '@/features/agents/components/AgentDetail';

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = getApiClient();

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => fetchAgent(client, id!),
    enabled: !!id,
  });

  return (
    <AgentDetail
      agent={agent}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onInvoke={() => invokeAgent(client, id!)}
    />
  );
}
```

- [ ] **Step 4: Run all tests**

```bash
pnpm jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/(tabs)/index.tsx app/(tabs)/settings.tsx app/agent/[id].tsx
git commit -m "refactor: thin out app pages — delegate to feature components"
```

---

### Task 12: Load settings on app mount

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Add settings load on mount**

Replace the contents of `app/_layout.tsx` with:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';

const queryClient = new QueryClient();

export default function RootLayout() {
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
```

Note: Read the existing `app/_layout.tsx` first and preserve any existing providers (QueryClientProvider, SafeAreaProvider, etc.) — only add the `useEffect` for `load()`.

- [ ] **Step 2: Run all tests**

```bash
pnpm jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: load settings from AsyncStorage on app mount"
```

---

### Task 13: Delete old settingsStore + final check

**Files:**
- Delete: `src/settingsStore.ts`

- [ ] **Step 1: Verify no remaining imports of src/settingsStore**

```bash
grep -r "from.*settingsStore" src/ app/ --include="*.ts" --include="*.tsx"
```

Expected: Only `src/store/settingsStore.ts` appears (the new Zustand store). No references to `src/settingsStore.ts`.

- [ ] **Step 2: Delete old file**

```bash
rm src/settingsStore.ts
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm jest --no-coverage
```

Expected: All tests pass, no import errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: delete legacy settingsStore, complete feature-based refactor"
```

