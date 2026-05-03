# Agent Card Chat Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tapping an Agent card in the Agents tab open that Agent's Chat screen directly.

**Architecture:** Keep `AgentList` and `AgentCard` presentation-only. Change only the route callback in `mobile/app/(tabs)/index.tsx` so the existing card press event pushes the Chat route with `endpoint_id` and URL-encoded `agent_name`. Preserve the existing Agent detail route and its `OPEN CHAT` behavior.

**Tech Stack:** React Native, Expo Router, Jest, React Native Testing Library, TypeScript.

---

## File Structure

- Modify `mobile/app/(tabs)/index.tsx`: change Agents tab card press navigation from detail route to Chat route.
- Create `mobile/app/(tabs)/index.test.tsx`: route-level regression tests for card press navigation, including URL encoding.
- Leave `mobile/src/features/agents/components/AgentList.tsx` unchanged unless test setup reveals a real type contract issue.
- Leave `mobile/app/agent/[id]/index.tsx` unchanged so Agent Detail and `OPEN CHAT` remain available.

## Task 1: Add Failing Route Test

**Files:**
- Create: `mobile/app/(tabs)/index.test.tsx`
- Read: `mobile/src/features/agents/components/AgentList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `mobile/app/(tabs)/index.test.tsx` with:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentListScreen from './index';

const push = jest.fn();
const fetchAllAgents = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('../../src/store/endpointStore', () => ({
  useEndpointStore: (selector: any) =>
    selector({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Mac',
          base_url: 'http://localhost:8080',
          token: 'token-1',
        },
      ],
    }),
}));

jest.mock('../../src/features/agents/services/agentService', () => ({
  fetchAllAgents: (...args: unknown[]) => fetchAllAgents(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('AgentListScreen', () => {
  beforeEach(() => {
    push.mockClear();
    fetchAllAgents.mockReset();
  });

  it('opens chat directly when an agent card is pressed', async () => {
    fetchAllAgents.mockResolvedValue([
      {
        id: 'a1',
        name: 'Alpha Agent',
        project_path: '/repo/alpha',
        runtime: 'codex',
        created_at: 1,
        endpoint_id: 'ep-1',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = render(<AgentListScreen />);

    await waitFor(() => expect(getByText('ALPHA AGENT')).toBeTruthy());
    fireEvent.press(getByText('ALPHA AGENT'));

    expect(push).toHaveBeenCalledWith('/agent/a1/chat?endpoint_id=ep-1&agent_name=Alpha%20Agent');
  });

  it('URL-encodes agent names when opening chat from a card', async () => {
    fetchAllAgents.mockResolvedValue([
      {
        id: 'a2',
        name: '修复 Bot/QA',
        project_path: '/repo/beta',
        runtime: 'claude-code',
        created_at: 2,
        endpoint_id: 'ep-1',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = render(<AgentListScreen />);

    await waitFor(() => expect(getByText('修复 BOT/QA')).toBeTruthy());
    fireEvent.press(getByText('修复 BOT/QA'));

    expect(push).toHaveBeenCalledWith(
      `/agent/a2/chat?endpoint_id=ep-1&agent_name=${encodeURIComponent('修复 Bot/QA')}`,
    );
  });
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false "app/\\(tabs\\)/index.test.tsx"
```

Expected: FAIL because the current route is `/agent/{id}?endpoint_id={endpoint_id}`, not `/agent/{id}/chat?...`.

## Task 2: Route Agent Cards Directly To Chat

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Test: `mobile/app/(tabs)/index.test.tsx`

- [ ] **Step 1: Implement the minimal route change**

In `mobile/app/(tabs)/index.tsx`, change the card press callback to accept `name` and route to Chat:

```tsx
onAgentPress={(id, endpoint_id, name) => {
  router.push(`/agent/${id}/chat?endpoint_id=${endpoint_id}&agent_name=${encodeURIComponent(name)}`);
}}
```

If TypeScript requires the callback signature to change, update `mobile/src/features/agents/components/AgentList.tsx` so `onAgentPress` receives `(id: string, endpoint_id: string, name: string)` and passes `item.name`.

- [ ] **Step 2: Update AgentList contract tests if needed**

If `AgentList` now passes name through, update `mobile/src/features/agents/components/AgentList.test.tsx` expectation:

```tsx
expect(onAgentPress).toHaveBeenCalledWith('a1', 'ep-1', 'Alpha');
```

- [ ] **Step 3: Run targeted tests and verify GREEN**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false "app/\\(tabs\\)/index.test.tsx" "src/features/agents/components/AgentList.test.tsx"
```

Expected: PASS.

## Task 3: Full Mobile Verification

**Files:**
- Verify all modified mobile files

- [ ] **Step 1: Run TypeScript verification**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full mobile test suite**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: PASS.

- [ ] **Step 3: Review diff against spec**

Confirm:
- Agents tab card press routes to Chat directly.
- Route includes `endpoint_id`.
- Route includes encoded `agent_name`.
- Agent Detail route and `OPEN CHAT` code remain present.
- No REST/WS/API/CLI files changed.
