# Settings Long-Press Release Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move release logs out of the Settings screen body and open them from a long press on the Settings tab.

**Architecture:** Keep `ReleaseLogsModal` as the existing diagnostics UI, but host it at the tab layout level where the Settings tab long-press event is available. The Settings screen remains responsible only for endpoint management.

**Tech Stack:** React Native, Expo Router tabs, Jest, `@testing-library/react-native`, Zustand endpoint store.

---

### Task 1: Settings Screen Entry Removal

**Files:**
- Modify: `mobile/src/__tests__/settings.test.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`

- [x] **Step 1: Write the failing test**

Update `mobile/src/__tests__/settings.test.tsx` so the basic settings screen test asserts that the diagnostics card is absent:

```tsx
expect(screen.queryByText('DIAGNOSTICS')).toBeNull();
expect(screen.queryByText('Open logs')).toBeNull();
```

Remove the release-log modal behavior tests from this file because Settings no longer owns that interaction. Task 2 recreates the behavior coverage at the tab layout boundary.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/__tests__/settings.test.tsx
```

Expected: FAIL because the Settings screen still renders the `DIAGNOSTICS` label and `Open logs` button.

- [x] **Step 3: Write minimal implementation**

Remove `ReleaseLogsModal`, `releaseLogsVisible`, the diagnostics card, and unused diagnostics styles from `mobile/app/(tabs)/settings.tsx`.

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/__tests__/settings.test.tsx
```

Expected: PASS for Settings screen entry removal.

### Task 2: Settings Tab Long Press Opens Release Logs

**Files:**
- Modify: `mobile/src/__tests__/navigation.test.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`

- [x] **Step 1: Write the failing test**

Update the Expo Router Tabs mock in `mobile/src/__tests__/navigation.test.tsx` to preserve `listeners` and expose `onLongPress`. Add release-log modal mocks copied from the old Settings screen tests: endpoint store seeding, websocket mock, clipboard mock usage, and diagnostics log cleanup. Add a test that renders `TabLayout`, long-presses `tab-settings`, and asserts the release logs modal title appears.

```tsx
fireEvent(screen.getByTestId('tab-settings'), 'longPress');
expect(screen.getByText('Release logs')).toBeTruthy();
```

Move the existing stream, copy, and websocket error behavior assertions from `mobile/src/__tests__/settings.test.tsx` into this file, changing the open action from pressing `release-logs-open-btn` to long-pressing `tab-settings`.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/__tests__/navigation.test.tsx
```

Expected: FAIL because `TabLayout` does not yet open release logs on `tabLongPress`.

- [x] **Step 3: Write minimal implementation**

In `mobile/app/(tabs)/_layout.tsx`, add `useState`, read endpoints from `useEndpointStore`, render `ReleaseLogsModal`, and attach a Settings screen `listeners={{ tabLongPress: () => setReleaseLogsVisible(true) }}`.

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false src/__tests__/navigation.test.tsx
```

Expected: PASS and the tab press behavior still switches tabs normally.

### Task 3: Final Verification

**Files:**
- Verify: `mobile/app/(tabs)/settings.tsx`
- Verify: `mobile/app/(tabs)/_layout.tsx`
- Verify: `mobile/src/__tests__/settings.test.tsx`
- Verify: `mobile/src/__tests__/navigation.test.tsx`

- [x] **Step 1: Run focused tests**

```bash
cd mobile && pnpm test -- --watchAll=false src/__tests__/settings.test.tsx src/__tests__/navigation.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run mobile typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [x] **Step 3: Review diff**

```bash
git diff -- mobile/app/\(tabs\)/settings.tsx mobile/app/\(tabs\)/_layout.tsx mobile/src/__tests__/settings.test.tsx mobile/src/__tests__/navigation.test.tsx docs/exec-plans/2026-05-31-settings-long-press-release-logs.md docs/exec-plans/index.json
```

Expected: Diff only contains the release-log entry migration, tests, and plan registration.
