# Agent Card Breathing Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rich, slow breathing visual treatment to running Agent cards in the Agents tab Active Now section.

**Direction Update:** After reviewing motion studies, the selected direction is `C. Liquid Status`: a soft horizontal flow band with restrained status-color pools. The earlier avatar-aura and particle stack is intentionally removed because it read as visually noisy.

**Architecture:** Keep status derivation in `AgentList`, keep row content in `AgentCard`, and isolate animation chrome in a new `RunningAgentBreath` component. Use built-in React Native `Animated` plus stacked absolute `View` layers, with no new dependency; system Reduce Motion switches the effect to a static highlighted frame and status dot.

**Tech Stack:** React Native, Expo SDK 55, React Native `Animated`, `AccessibilityInfo`, Jest, `@testing-library/react-native`, TypeScript.

---

## Interview Decisions

- Surface: Agent list/card only.
- Purpose: make running Agents feel alive, not just report status.
- Intensity: rich treatment is acceptable, but the final visual language should stay premium and restrained.
- Visual motif: use `C. Liquid Status`; do not use avatar-led aura or decorative particles as the primary effect.
- Scope: show the rich effect only in Active Now. The duplicated All Agents row remains plain.
- State mapping: only `running` receives breathing life. `awaiting_question` keeps attention UI, and `failed` stays static.
- Motion control: follow iOS system Reduce Motion. When enabled, no looping animation runs.
- Implementation route: no new dependency. Simulate liquid bands/pools using existing RN primitives.
- Cadence: slow organic breathing, roughly 2.6 seconds per cycle.

## File Structure

- Create `mobile/src/hooks/useReduceMotionPreference.ts`: subscribes to `AccessibilityInfo` and exposes one boolean.
- Create `mobile/src/hooks/useReduceMotionPreference.test.tsx`: verifies initial value, runtime changes, and subscription cleanup.
- Create `mobile/src/features/agents/components/RunningAgentBreath.tsx`: renders animated or reduced-motion card chrome.
- Create `mobile/src/features/agents/components/RunningAgentBreath.test.tsx`: verifies animated, static, and disabled render modes.
- Modify `mobile/src/features/agents/components/AgentCard.tsx`: accepts `showBreathingEffect`, reads Reduce Motion, and places the effect behind row content.
- Modify `mobile/src/features/agents/components/AgentCard.test.tsx`: verifies the row opts into the breathing layer only when requested.
- Modify `mobile/src/features/agents/components/AgentList.tsx`: adds explicit status kind and passes the breathing flag only for Active Now running rows.
- Create `mobile/src/features/agents/components/AgentList.breathing.test.tsx`: verifies Active Now-only rendering and no effect for awaiting-question rows without pushing the existing AgentList test file over the 500-line limit.
- Verify `mobile/src/features/agents/components/AgentList.test.tsx`: keeps existing list structure coverage under the 500-line file limit.
- Modify `mobile/docs/design.md`: documents the Active Now breathing treatment and Reduce Motion rule.
- Run the doc-code hash check after reviewing the code diff. `mobile/docs/design.md` is not a `docs/design-docs/` tracked hash document.

## Task 1: Reduce Motion Hook

**Files:**
- Create: `mobile/src/hooks/useReduceMotionPreference.ts`
- Create: `mobile/src/hooks/useReduceMotionPreference.test.tsx`

- [x] **Step 1: Write the failing hook tests**

Create `mobile/src/hooks/useReduceMotionPreference.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotionPreference } from './useReduceMotionPreference';

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('useReduceMotionPreference', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /// Reduce Motion initial state: hook mirrors the native accessibility preference.
  ///
  /// Data construction:
  ///   native isReduceMotionEnabled() = true
  ///   initial hook state             = false until the async native value resolves
  ///
  /// Execution process:
  ///   1. Mock AccessibilityInfo.isReduceMotionEnabled() to resolve true.
  ///   2. Render useReduceMotionPreference().
  ///   3. Wait for the hook to receive the native preference.
  ///
  /// Expected result:
  ///   - Positive: hook eventually returns true.
  ///   - Positive: hook subscribes to reduceMotionChanged.
  ///   - Negative: hook does not stay at the default false value after the native result resolves.
  it('loads the initial Reduce Motion preference from AccessibilityInfo', async () => {
    const remove = jest.fn();
    const isReduceMotionEnabled = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const addEventListener = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove } as never);

    const { result } = renderHook(() => useReduceMotionPreference());

    await waitFor(() => {
      expectEqualWithReason(
        result.current,
        true,
        'hook should reflect the enabled native Reduce Motion setting',
      );
    });
    expectEqualWithReason(
      isReduceMotionEnabled.mock.calls.length,
      1,
      'hook should query the native setting exactly once on mount',
    );
    expectEqualWithReason(
      addEventListener.mock.calls[0][0],
      'reduceMotionChanged',
      'hook should subscribe to Reduce Motion changes',
    );
    expectEqualWithReason(
      result.current === false,
      false,
      'hook must not keep the default false value after native Reduce Motion resolves true',
    );
  });

  /// Reduce Motion runtime changes: native events update the hook without remounting.
  ///
  /// Data construction:
  ///   initial native value = false
  ///   event value          = true
  ///
  /// Execution process:
  ///   1. Render the hook with native Reduce Motion disabled.
  ///   2. Invoke the subscribed reduceMotionChanged listener with true.
  ///   3. Inspect the hook value.
  ///
  /// Expected result:
  ///   - Positive: hook changes to true after the event.
  ///   - Negative: hook does not require a remount to observe the new preference.
  it('updates when Reduce Motion changes at runtime', async () => {
    let listener: ((enabled: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, callback) => {
      listener = callback;
      return { remove: jest.fn() } as never;
    });

    const { result } = renderHook(() => useReduceMotionPreference());

    await waitFor(() => {
      expectEqualWithReason(
        result.current,
        false,
        'hook should start from the disabled native Reduce Motion value',
      );
    });
    act(() => {
      listener?.(true);
    });

    expectEqualWithReason(
      result.current,
      true,
      'hook should update when the native reduceMotionChanged event fires',
    );
    expectEqualWithReason(
      listener === undefined,
      false,
      'test must capture the active subscription listener before invoking it',
    );
  });

  /// Reduce Motion cleanup: unmount removes the native event subscription.
  ///
  /// Data construction:
  ///   subscription.remove = mock function
  ///
  /// Execution process:
  ///   1. Render the hook.
  ///   2. Unmount the hook.
  ///   3. Inspect the subscription remove call.
  ///
  /// Expected result:
  ///   - Positive: remove is called once on unmount.
  ///   - Negative: native subscription is not leaked after the card list unmounts.
  it('removes the native Reduce Motion subscription on unmount', () => {
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove } as never);

    const { unmount } = renderHook(() => useReduceMotionPreference());
    unmount();

    expectEqualWithReason(
      remove.mock.calls.length,
      1,
      'hook should remove the native Reduce Motion subscription on unmount',
    );
    expectEqualWithReason(
      remove.mock.calls.length === 0,
      false,
      'hook must not leak the native Reduce Motion subscription',
    );
  });
});
```

- [x] **Step 2: Run the hook tests and verify RED**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/hooks/useReduceMotionPreference.test.tsx
```

Expected: FAIL because `useReduceMotionPreference` does not exist.

- [x] **Step 3: Implement the hook**

Create `mobile/src/hooks/useReduceMotionPreference.ts`:

```ts
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotionPreference() {
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotionEnabled(enabled);
        }
      })
      .catch(() => {
        if (mounted) {
          setReduceMotionEnabled(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotionEnabled;
}
```

- [x] **Step 4: Run the hook tests and verify GREEN**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/hooks/useReduceMotionPreference.test.tsx
```

Expected: PASS.

## Task 2: Breathing Layer Component

**Files:**
- Create: `mobile/src/features/agents/components/RunningAgentBreath.tsx`
- Create: `mobile/src/features/agents/components/RunningAgentBreath.test.tsx`

- [x] **Step 1: Write the failing component tests**

Create `mobile/src/features/agents/components/RunningAgentBreath.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { RunningAgentBreath } from './RunningAgentBreath';

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('RunningAgentBreath', () => {
  /// Running breathing effect: animated mode renders all life layers.
  ///
  /// Data construction:
  ///   enabled       = true
  ///   reducedMotion = false
  ///   accentColor   = #FF6B35 from the design whitelist
  ///   cadence       = slow organic loop owned by Animated implementation
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath in animated mode.
  ///   2. Query the edge, field, avatar aura, and three particles.
  ///   3. Inspect container geometry.
  ///
  /// Expected result:
  ///   - Positive: rich animated layers are present for running Active Now cards.
  ///   - Positive: layers are absolutely positioned behind AgentCard content.
  ///   - Negative: reduced-motion static frame is absent in animated mode.
  it('renders animated breathing layers when enabled and Reduce Motion is off', () => {
    const { getByTestId, getAllByTestId, queryByTestId } = render(
      <RunningAgentBreath enabled accentColor="#FF6B35" reducedMotion={false} />,
    );

    const rootStyle = StyleSheet.flatten(getByTestId('running-agent-breath').props.style);

    expectEqualWithReason(
      rootStyle.position,
      'absolute',
      'breathing chrome should sit behind card content without changing row layout',
    );
    expect(getByTestId('running-agent-breath-edge')).toBeTruthy();
    expect(getByTestId('running-agent-breath-field')).toBeTruthy();
    expect(getByTestId('running-agent-breath-avatar-aura')).toBeTruthy();
    expectEqualWithReason(
      getAllByTestId('running-agent-breath-particle').length,
      3,
      'animated mode should render three small particles around the avatar/status area',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-static') === null,
      true,
      'animated mode must not render the reduced-motion static frame',
    );
  });

  /// Reduce Motion mode: enabled running cards keep static affordance without a loop.
  ///
  /// Data construction:
  ///   enabled       = true
  ///   reducedMotion = true
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath with Reduce Motion on.
  ///   2. Query static and animated-only layers.
  ///
  /// Expected result:
  ///   - Positive: static highlighted frame is present.
  ///   - Negative: animated field, aura, and particles are absent.
  it('renders only a static highlighted frame when Reduce Motion is enabled', () => {
    const { getByTestId, queryByTestId, queryAllByTestId } = render(
      <RunningAgentBreath enabled accentColor="#FF6B35" reducedMotion />,
    );

    expect(getByTestId('running-agent-breath-static')).toBeTruthy();
    expectEqualWithReason(
      queryByTestId('running-agent-breath-field') === null,
      true,
      'Reduce Motion mode should not render the animated background field',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-avatar-aura') === null,
      true,
      'Reduce Motion mode should not render the pulsing avatar aura',
    );
    expectEqualWithReason(
      queryAllByTestId('running-agent-breath-particle').length,
      0,
      'Reduce Motion mode should not render looping particles',
    );
  });

  /// Disabled mode: non-running cards do not render effect chrome.
  ///
  /// Data construction:
  ///   enabled = false
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath disabled.
  ///   2. Query root and static layers.
  ///
  /// Expected result:
  ///   - Positive: component returns null for non-running rows.
  ///   - Negative: idle or awaiting-question rows do not receive decorative chrome.
  it('renders nothing when disabled', () => {
    const { queryByTestId } = render(
      <RunningAgentBreath enabled={false} accentColor="#FF6B35" reducedMotion={false} />,
    );

    expectEqualWithReason(
      queryByTestId('running-agent-breath') === null,
      true,
      'disabled breathing effect should not render a root layer',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-static') === null,
      true,
      'disabled breathing effect should not render reduced-motion chrome either',
    );
  });
});
```

- [x] **Step 2: Run component tests and verify RED**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/features/agents/components/RunningAgentBreath.test.tsx
```

Expected: FAIL because `RunningAgentBreath` does not exist.

- [x] **Step 3: Implement the breathing component**

Create `mobile/src/features/agents/components/RunningAgentBreath.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

interface Props {
  enabled: boolean;
  reducedMotion: boolean;
  accentColor: string;
}

function breathingStyle(value: Animated.Value, input: number[], output: number[]) {
  return value.interpolate({ inputRange: input, outputRange: output });
}

export function RunningAgentBreath({ enabled, reducedMotion, accentColor }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled || reducedMotion) {
      breath.stopAnimation();
      drift.stopAnimation();
      breath.setValue(0);
      drift.setValue(0);
      return;
    }

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const driftLoop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 5200,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );

    breathLoop.start();
    driftLoop.start();

    return () => {
      breathLoop.stop();
      driftLoop.stop();
    };
  }, [breath, drift, enabled, reducedMotion]);

  if (!enabled) {
    return null;
  }

  if (reducedMotion) {
    return (
      <View pointerEvents="none" style={s.root} testID="running-agent-breath">
        <View
          testID="running-agent-breath-static"
          style={[s.staticFrame, { borderColor: accentColor }]}
        />
      </View>
    );
  }

  const edgeOpacity = breathingStyle(breath, [0, 1], [0.38, 0.82]);
  const fieldOpacity = breathingStyle(breath, [0, 1], [0.08, 0.2]);
  const auraOpacity = breathingStyle(breath, [0, 1], [0.18, 0.55]);
  const auraScale = breathingStyle(breath, [0, 1], [0.92, 1.22]);
  const particleOpacity = breathingStyle(breath, [0, 0.5, 1], [0.2, 0.75, 0.25]);
  const driftX = breathingStyle(drift, [0, 1], [-10, 10]);

  return (
    <View pointerEvents="none" style={s.root} testID="running-agent-breath">
      <Animated.View
        testID="running-agent-breath-field"
        style={[
          s.field,
          {
            backgroundColor: accentColor,
            opacity: fieldOpacity,
            transform: [{ translateX: driftX }],
          },
        ]}
      />
      <Animated.View
        testID="running-agent-breath-edge"
        style={[s.edge, { borderColor: accentColor, opacity: edgeOpacity }]}
      />
      <Animated.View
        testID="running-agent-breath-avatar-aura"
        style={[
          s.avatarAura,
          {
            backgroundColor: accentColor,
            opacity: auraOpacity,
            transform: [{ scale: auraScale }],
          },
        ]}
      />
      <Animated.View
        testID="running-agent-breath-particle"
        style={[
          s.particle,
          s.particleOne,
          { backgroundColor: accentColor, opacity: particleOpacity },
        ]}
      />
      <Animated.View
        testID="running-agent-breath-particle"
        style={[
          s.particle,
          s.particleTwo,
          { backgroundColor: accentColor, opacity: particleOpacity },
        ]}
      />
      <Animated.View
        testID="running-agent-breath-particle"
        style={[
          s.particle,
          s.particleThree,
          { backgroundColor: accentColor, opacity: particleOpacity },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    overflow: 'hidden',
  },
  staticFrame: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 1,
    borderRadius: 13,
    opacity: 0.72,
  },
  field: {
    position: 'absolute',
    top: 7,
    right: 18,
    bottom: 7,
    left: 18,
    borderRadius: 18,
  },
  edge: {
    position: 'absolute',
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderWidth: 1,
    borderRadius: 13,
  },
  avatarAura: {
    position: 'absolute',
    left: 8,
    top: 9,
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  particle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  particleOne: { left: 52, top: 14 },
  particleTwo: { left: 44, bottom: 12 },
  particleThree: { right: 24, top: 24 },
});
```

- [x] **Step 4: Run component tests and verify GREEN**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/features/agents/components/RunningAgentBreath.test.tsx
```

Expected: PASS.

## Task 3: AgentCard Integration

**Files:**
- Modify: `mobile/src/features/agents/components/AgentCard.tsx`
- Modify: `mobile/src/features/agents/components/AgentCard.test.tsx`

- [x] **Step 1: Write failing AgentCard tests**

Append these tests to `mobile/src/features/agents/components/AgentCard.test.tsx`:

```tsx
/// Running card breathing: AgentCard places life chrome behind existing row content.
///
/// Data construction:
///   agent.runtime          = codex
///   showBreathingEffect    = true
///   codex accent color     = #FF6B35 from runtime avatar canvas
///
/// Execution process:
///   1. Render AgentCard with showBreathingEffect=true.
///   2. Query the breathing layer and existing avatar/name/chevron.
///   3. Inspect row geometry.
///
/// Expected result:
///   - Positive: breathing layer renders when the caller opts in.
///   - Positive: normal card content still renders above the effect.
///   - Negative: the effect does not replace the runtime pixel avatar.
it('renders breathing chrome behind content when opted in', () => {
  const { getByTestId, getByText } = render(
    <AgentCard
      agent={{ ...agent, runtime: 'codex' }}
      onPress={() => {}}
      index={0}
      metaVariant="status"
      statusLabel="Running"
      isActive
      showBreathingEffect
    />,
  );

  const rowStyle = StyleSheet.flatten(getByTestId('project-row').props.style);

  expect(getByTestId('running-agent-breath')).toBeTruthy();
  expect(getByTestId('runtime-pixel-codex')).toBeTruthy();
  expect(getByText('My Agent')).toBeTruthy();
  expect(getByTestId('project-chevron')).toBeTruthy();
  expectEqualWithReason(
    rowStyle.position,
    'relative',
    'project row should become a positioning context for absolute breathing chrome',
  );
  expectEqualWithReason(
    rowStyle.height,
    68,
    'breathing chrome must not change the established project row height',
  );
});

/// Idle card breathing: AgentCard does not add life chrome unless the list explicitly opts in.
///
/// Data construction:
///   showBreathingEffect = false by default
///   isActive            = true to prove active alone is not enough
///
/// Execution process:
///   1. Render AgentCard without showBreathingEffect.
///   2. Query the breathing layer and existing active status dot.
///
/// Expected result:
///   - Positive: active status metadata can still render.
///   - Negative: breathing chrome is absent without the explicit prop.
it('does not render breathing chrome from isActive alone', () => {
  const { getByText, queryByTestId } = render(
    <AgentCard
      agent={agent}
      onPress={() => {}}
      index={0}
      metaVariant="status"
      statusLabel="Running"
      isActive
    />,
  );

  expect(getByText('Running')).toBeTruthy();
  expectEqualWithReason(
    queryByTestId('running-agent-breath') === null,
    true,
    'AgentCard should require showBreathingEffect so awaiting-question rows can remain static',
  );
});
```

- [x] **Step 2: Run AgentCard tests and verify RED**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/features/agents/components/AgentCard.test.tsx
```

Expected: FAIL because `showBreathingEffect` is not a prop and `RunningAgentBreath` is not mounted.

- [x] **Step 3: Implement AgentCard integration**

In `mobile/src/features/agents/components/AgentCard.tsx`:

1. Add imports:

```tsx
import { useReduceMotionPreference } from '@/hooks/useReduceMotionPreference';
import { RunningAgentBreath } from './RunningAgentBreath';
```

2. Add the prop:

```tsx
  showBreathingEffect?: boolean;
```

3. Destructure it with a default:

```tsx
  showBreathingEffect = false,
```

4. Add a runtime accent color after `avatarColor`:

```tsx
  const reduceMotionEnabled = useReduceMotionPreference();
  const accentColor = agent.runtime === 'claude-code' ? ORANGE : avatarColor;
```

5. Render the breathing layer as the first child of the `Pressable`:

```tsx
      <RunningAgentBreath
        enabled={showBreathingEffect}
        reducedMotion={reduceMotionEnabled}
        accentColor={accentColor}
      />
```

6. Update row styles so absolute layers have a stable positioning context:

```tsx
  row: {
    width: '100%',
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    position: 'relative',
    borderRadius: 14,
  },
```

- [x] **Step 4: Run AgentCard tests and verify GREEN**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/features/agents/components/AgentCard.test.tsx
```

Expected: PASS.

## Task 4: Active Now State Wiring

**Files:**
- Modify: `mobile/src/features/agents/components/AgentList.tsx`
- Create: `mobile/src/features/agents/components/AgentList.breathing.test.tsx`
- Verify: `mobile/src/features/agents/components/AgentList.test.tsx`

- [x] **Step 1: Write failing AgentList tests**

Create `mobile/src/features/agents/components/AgentList.breathing.test.tsx` with focused breathing tests. Keep `mobile/src/features/agents/components/AgentList.test.tsx` below the 500-line guard.

```tsx
/// Active Now breathing: only the Active Now copy of a running Agent gets life chrome.
///
/// Data construction:
///   agents = Alpha + Beta
///   conversations = one running conversation for Alpha
///   Alpha renders twice: Active Now and All Agents
///
/// Execution process:
///   1. Render AgentList with Alpha running.
///   2. Query running-agent-breath layers across the whole screen.
///   3. Query Alpha labels to confirm the duplicate All Agents row still exists.
///
/// Expected result:
///   - Positive: exactly one breathing effect renders for Alpha's Active Now row.
///   - Positive: Alpha still appears in All Agents.
///   - Negative: the duplicated All Agents row does not also render breathing chrome.
it('renders breathing chrome only for the Active Now copy of a running agent', () => {
  useChatStore.setState({
    conversations: [
      {
        id: 'conv-running',
        agent_id: 'a1',
        agent_name: 'Alpha',
        endpoint_id: 'ep-1',
        title: 'Run task',
        status: 'running',
        created_at: 1000,
        last_message_at: 1000,
      },
    ],
    messages: {},
  });

  const { getAllByText, getAllByTestId } = render(
    <AgentList
      agents={agents}
      isLoading={false}
      isError={false}
      error={null}
      isFetching={false}
      onRefetch={() => {}}
      onAgentPress={() => {}}
    />,
  );

  expectEqualWithReason(
    getAllByTestId('running-agent-breath').length,
    1,
    'only the Active Now row should render rich breathing chrome for a running agent',
  );
  expectEqualWithReason(
    getAllByText('Alpha').length,
    2,
    'running agents should still appear in both Active Now and All Agents sections',
  );
  expectEqualWithReason(
    getAllByTestId('project-row').length,
    3,
    'list should still render Alpha twice and Beta once; the effect must not remove rows',
  );
});

/// Awaiting answer state: attention rows stay static even though they are active.
///
/// Data construction:
///   conversations = one awaiting_question conversation for Alpha
///   pendingCount  = 1
///
/// Execution process:
///   1. Render AgentList with Alpha awaiting an answer.
///   2. Query pending badge and breathing chrome.
///
/// Expected result:
///   - Positive: awaiting answer status and pending badge remain visible.
///   - Negative: awaiting_question does not receive Running breathing chrome.
it('does not render breathing chrome for awaiting-question active rows', () => {
  useChatStore.setState({
    conversations: [
      {
        id: 'conv-question',
        agent_id: 'a1',
        agent_name: 'Alpha',
        endpoint_id: 'ep-1',
        title: 'Needs decision',
        status: 'awaiting_question',
        created_at: 1000,
        last_message_at: 1000,
      },
    ],
    messages: {},
  });

  const { getAllByText, getByText, queryByTestId } = render(
    <AgentList
      agents={agents}
      isLoading={false}
      isError={false}
      error={null}
      isFetching={false}
      onRefetch={() => {}}
      onAgentPress={() => {}}
    />,
  );

  expect(getByText('Running · Awaiting answer')).toBeTruthy();
  expectEqualWithReason(
    getAllByText('1').length >= 1,
    true,
    'awaiting-question active row should show a pending count badge',
  );
  expectEqualWithReason(
    queryByTestId('running-agent-breath') === null,
    true,
    'awaiting-question rows should stay static and use the existing attention affordance',
  );
});
```

These tests use the same `useChatStore.setState` setup as `AgentList.test.tsx`; `AgentList` should not gain a `conversations` prop for this feature.

- [x] **Step 2: Run AgentList tests and verify RED**

Run:

```bash
cd mobile && pnpm test --watchAll=false src/features/agents/components/AgentList.breathing.test.tsx src/features/agents/components/AgentList.test.tsx
```

Expected: FAIL because Active Now rows do not pass `showBreathingEffect`.

- [x] **Step 3: Add explicit status kind and Active Now-only prop**

In `mobile/src/features/agents/components/AgentList.tsx`, extend `ProjectStatus`:

```tsx
type ProjectStatus = {
  label: string;
  kind: 'idle' | 'running' | 'awaiting_question' | 'failed';
  isActive: boolean;
  pendingCount: number;
};
```

Update `projectStatus`:

```tsx
function projectStatus(conversations: Conversation[]): ProjectStatus {
  const pendingCount = conversations.filter((conv) => conv.status === 'awaiting_question').length;
  if (pendingCount > 0) {
    return {
      label: 'Running · Awaiting answer',
      kind: 'awaiting_question',
      isActive: true,
      pendingCount,
    };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'Running', kind: 'running', isActive: true, pendingCount: 0 };
  }
  if (conversations.some((conv) => conv.status === 'failed')) {
    return { label: 'Failed', kind: 'failed', isActive: false, pendingCount: 0 };
  }
  return { label: 'Idle', kind: 'idle', isActive: false, pendingCount: 0 };
}
```

Pass the effect only from the Active Now/status rendering path:

```tsx
        showBreathingEffect={metaVariant === 'status' && project.status.kind === 'running'}
```

- [x] **Step 4: Run AgentList tests and verify GREEN**

Run:

```bash
cd mobile && pnpm test --watchAll=false src/features/agents/components/AgentList.breathing.test.tsx src/features/agents/components/AgentList.test.tsx
```

Expected: PASS.

## Task 5: Design Documentation And Hash Check

**Files:**
- Modify: `mobile/docs/design.md`

- [x] **Step 1: Update the design rules after reviewing the code diff**

Add this subsection after `### 6.3 对话列表行` in `mobile/docs/design.md`:

```md
### 6.3.1 Active Now Running Breath

- 仅 `Agents > Active Now` 中状态为 `Running` 的 Agent 行显示呼吸生命感；同一 Agent 在 `All Agents` 中的重复行不显示该特效。
- `awaiting_question` 不使用呼吸特效，继续使用 pending badge 和 `Running · Awaiting answer` 文案表达需要用户关注。
- 实现不新增渐变依赖，使用 React Native `Animated` 与叠层 View 模拟：
  - 头像周围柔光脉冲；
  - 行背景柔和流动光场；
  - 1px 渐变感边缘呼吸框；
  - 3 个小粒子围绕头像/状态区域缓慢明灭。
- 节奏为慢速有机呼吸，约 2.6 秒一次完整呼吸，避免抢占列表阅读注意力。
- 跟随系统 Reduce Motion；开启时关闭循环动画，仅保留静态高亮边框与状态点。
- 色彩必须使用 §2 已列入白名单的 runtime/强调色，通过 `opacity` 做层次，不新增非白名单色值。
```

- [x] **Step 2: Run the design doc hash guard**

Run:

```bash
python3 scripts/check-doc-code-hashes.py --check
```

Expected: PASS. `mobile/docs/design.md` is outside `docs/design-docs/`, so there is no per-document hash to refresh.

## Task 6: Final Verification

**Files:**
- Verify: `mobile/src/hooks/useReduceMotionPreference.ts`
- Verify: `mobile/src/hooks/useReduceMotionPreference.test.tsx`
- Verify: `mobile/src/features/agents/components/RunningAgentBreath.tsx`
- Verify: `mobile/src/features/agents/components/RunningAgentBreath.test.tsx`
- Verify: `mobile/src/features/agents/components/AgentCard.tsx`
- Verify: `mobile/src/features/agents/components/AgentCard.test.tsx`
- Verify: `mobile/src/features/agents/components/AgentList.tsx`
- Verify: `mobile/src/features/agents/components/AgentList.breathing.test.tsx`
- Verify: `mobile/src/features/agents/components/AgentList.test.tsx`
- Verify: `mobile/docs/design.md`

- [x] **Step 1: Run focused tests**

Run:

```bash
cd mobile && pnpm test --watchAll=false src/hooks/useReduceMotionPreference.test.tsx src/features/agents/components/RunningAgentBreath.test.tsx src/features/agents/components/AgentCard.test.tsx src/features/agents/components/AgentList.breathing.test.tsx src/features/agents/components/AgentList.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run mobile typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [x] **Step 3: Run design/doc guard**

Run:

```bash
python3 scripts/check-doc-code-hashes.py --check
```

Expected: PASS.

- [x] **Step 4: Review UI implementation against the design checklist**

Confirm:
- New colors are limited to existing design whitelist values.
- Orange remains an emphasis/runtime color, not a generic decorative page background.
- Running breathing appears only in Active Now.
- All Agents duplicate row remains static.
- Awaiting answer and failed states remain static.
- Reduce Motion renders a static frame and does not start looping animation.
- Row height remains 68 in implementation and does not shift during animation.

- [x] **Step 5: Review diff**

Run:

```bash
git diff -- mobile/src/hooks/useReduceMotionPreference.ts mobile/src/hooks/useReduceMotionPreference.test.tsx mobile/src/features/agents/components/RunningAgentBreath.tsx mobile/src/features/agents/components/RunningAgentBreath.test.tsx mobile/src/features/agents/components/AgentCard.tsx mobile/src/features/agents/components/AgentCard.test.tsx mobile/src/features/agents/components/AgentList.tsx mobile/src/features/agents/components/AgentList.breathing.test.tsx mobile/src/features/agents/components/AgentList.test.tsx mobile/docs/design.md docs/exec-plans/2026-06-01-agent-card-breathing-effects.md docs/exec-plans/index.json
```

Expected: Diff contains only the Active Now running breathing effect, tests, design documentation, and this plan registration.

## Completion Notes

- Repository override: after all tasks pass, make one final commit for the whole implementation rather than one commit per task.
- Before that commit, run `superpowers:requesting-code-review` as required by `AGENTS.md`; fix Critical/Important feedback, rerun verification, commit, then record the 40-character commit SHA in `docs/exec-plans/index.json`.
