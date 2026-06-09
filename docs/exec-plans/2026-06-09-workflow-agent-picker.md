# Workflow Agent 选择组件统一 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared `AgentTargetField` + `AgentTargetPickerSheet` components so Workflow and Specs use the same agent picker UX (single-line trigger + pageSheet), with endpoint locking on workflow edit.

**Architecture:** Move `TargetPickerSheet` to `mobile/src/components/agent-target/` as the single authoritative implementation. `SpecTarget` becomes a type alias of `AgentTarget`. Workflow form replaces inline agent radio list with the shared field/sheet; edit mode passes `lockedEndpointId` to restrict endpoint switching.

**Tech Stack:** React Native / Expo SDK 55, react-i18next, `@testing-library/react-native`, existing `brandRefresh` theme tokens.

**SPEC:** [`docs/product-specs/2026-06-09-SPEC-workflow-agent-picker.md`](../product-specs/2026-06-09-SPEC-workflow-agent-picker.md)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `mobile/src/components/agent-target/types.ts` | `AgentTarget` interface |
| Create | `mobile/src/components/agent-target/AgentTargetPickerSheet.tsx` | Migrated picker + `lockedEndpointId` |
| Create | `mobile/src/components/agent-target/AgentTargetField.tsx` | Single-line form trigger |
| Create | `mobile/src/components/agent-target/resolveAgentTarget.ts` | Helper: agent_id → AgentTarget |
| Create | `mobile/src/components/agent-target/index.ts` | Public exports |
| Create | `mobile/src/components/agent-target/AgentTargetPickerSheet.test.tsx` | Migrated + locked-endpoint tests |
| Modify | `mobile/src/features/specs/components/specUiModels.ts` | `SpecTarget = AgentTarget` alias |
| Modify | `mobile/src/features/specs/components/TargetPickerSheet.tsx` | Thin re-export (deprecation shim) |
| Modify | `mobile/src/features/specs/components/IdeaEditorSheet.tsx` | Use `AgentTargetField` |
| Modify | `mobile/app/new-idea.tsx` | Import from `@/components/agent-target` |
| Modify | `mobile/app/idea/[id].tsx` | Import from `@/components/agent-target` |
| Modify | `mobile/src/features/specs/components/SpecsHomeScreen.tsx` | Import from `@/components/agent-target` |
| Modify | `mobile/src/__tests__/ideaDetailRoute.test.tsx` | Update mock path |
| Modify | `mobile/src/features/workflows/components/WorkflowFormScreen.tsx` | Replace inline list with shared picker |
| Modify | `mobile/app/(tabs)/workflows.tsx` | Pass `endpoints`, `lockedEndpointId` |
| Modify | `mobile/app/workflow/[id].tsx` | Pass `endpoints`, `lockedEndpointId` |
| Modify | `mobile/src/features/workflows/components/workflowScreenStyles.ts` | Remove dead `agentRow*` styles |
| Modify | `mobile/src/features/workflows/components/WorkflowFormScreen.test.tsx` | Align with new UX |
| Delete | `mobile/src/features/specs/components/TargetPickerSheet.test.tsx` | Replaced by shared test file |

---

## Phase 1: Shared Component Foundation

### Task 1: Create `AgentTarget` types and resolver

**Files:**
- Create: `mobile/src/components/agent-target/types.ts`
- Create: `mobile/src/components/agent-target/resolveAgentTarget.ts`
- Create: `mobile/src/components/agent-target/index.ts` (partial)

- [ ] **Step 1: Add types**

```ts
// types.ts
export interface AgentTarget {
  endpointId: string;
  endpointLabel: string;
  agentId: string;
  agentName: string;
  repoPath: string;
}
```

- [ ] **Step 2: Add resolver helper**

```ts
// resolveAgentTarget.ts
import { type Agent, type Endpoint } from '@/types';
import { type AgentTarget } from './types';

export function resolveAgentTarget(
  agentId: string | undefined,
  agents: Agent[],
  endpoints: Endpoint[],
): AgentTarget | undefined {
  if (!agentId) return undefined;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  const endpoint = endpoints.find((e) => e.id === agent.endpoint_id);
  return {
    endpointId: agent.endpoint_id,
    endpointLabel: endpoint?.label ?? agent.endpoint_label,
    agentId: agent.id,
    agentName: agent.name,
    repoPath: agent.project_path,
  };
}
```

- [ ] **Step 3: Export from index.ts**

```ts
export { type AgentTarget } from './types';
export { resolveAgentTarget } from './resolveAgentTarget';
```

---

### Task 2: Migrate `AgentTargetPickerSheet` with `lockedEndpointId`

**Files:**
- Create: `mobile/src/components/agent-target/AgentTargetPickerSheet.tsx`
- Modify: `mobile/src/features/specs/components/TargetPickerSheet.tsx`

- [ ] **Step 1: Copy `TargetPickerSheet.tsx` → `AgentTargetPickerSheet.tsx`**

Changes from original:
- Import `AgentTarget` from `./types` (not `SpecTarget`)
- Rename export to `AgentTargetPickerSheet`
- Add prop `lockedEndpointId?: string`
- In `useEffect` when `visible`: if `lockedEndpointId`, set `endpointId` to it
- Endpoint section when `lockedEndpointId`:
  - Render **only** the locked endpoint as a read-only row (no `onPress`, no checkmark toggle to other endpoints)
  - Use `accessibilityState={{ disabled: true }}` or static `View` styled like selected row
- Agent filtering: when `lockedEndpointId`, always filter `agent.endpoint_id === lockedEndpointId` (even before endpoint tap)
- When no `lockedEndpointId`, behavior identical to current `TargetPickerSheet`

- [ ] **Step 2: Thin re-export shim**

```ts
// TargetPickerSheet.tsx — keep for any stale imports during migration
export { AgentTargetPickerSheet as TargetPickerSheet } from '@/components/agent-target/AgentTargetPickerSheet';
export type { AgentTargetPickerSheetProps as TargetPickerSheetProps } from '@/components/agent-target/AgentTargetPickerSheet';
```

(Or delete shim after all imports updated — prefer updating all imports and deleting shim per spec §8.1.)

- [ ] **Step 3: Write failing locked-endpoint test**

Create `AgentTargetPickerSheet.test.tsx` by migrating `TargetPickerSheet.test.tsx` and adding:

```ts
test('lockedEndpointId shows only agents on that endpoint and endpoint is read-only', () => {
  const onDone = jest.fn();
  const { getByText, queryByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      lockedEndpointId="ep-online"
      onClose={() => {}}
      onDone={onDone}
    />,
  );

  expect(getByText('Office Mac')).toBeTruthy();
  expect(queryByText('Travel Mac')).toBeNull();
  expect(getByText('Codex Runner')).toBeTruthy();
  expect(queryByText('Docs Runner')).toBeNull();

  fireEvent.press(getByText('Codex Runner'));
  fireEvent.press(getByText('Done'));
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }));
});
```

- [ ] **Step 4: Run tests**

```bash
cd mobile && pnpm test -- --watchAll=false AgentTargetPickerSheet.test.tsx
```

Expected: PASS (all 5 tests including migrated 4 + new locked test)

- [ ] **Step 5: Delete old test file**

Remove `mobile/src/features/specs/components/TargetPickerSheet.test.tsx`

---

### Task 3: Extract `AgentTargetField`

**Files:**
- Create: `mobile/src/components/agent-target/AgentTargetField.tsx`
- Modify: `mobile/src/components/agent-target/index.ts`

- [ ] **Step 1: Implement field** (styles from `IdeaEditorSheet` `targetRow` / `targetBody` / `chooseText`)

```tsx
interface AgentTargetFieldProps {
  value?: AgentTarget;
  onPress: () => void;
  title?: string;           // default: t('specs.editorProjectAgent')
  placeholder?: string;     // default: t('specs.editorChoose')
  changeLabel?: string;     // default: t('specs.editorChange')
  accessibilityLabel?: string;
}

export function AgentTargetField({ value, onPress, ... }: AgentTargetFieldProps) {
  // minHeight 54, brandRefresh colors, accessibilityRole="button"
  // subtitle: value?.agentName ?? placeholder
  // trailing: value ? changeLabel : placeholder
}
```

- [ ] **Step 2: Export from index.ts**

```ts
export { AgentTargetField } from './AgentTargetField';
export { AgentTargetPickerSheet } from './AgentTargetPickerSheet';
```

- [ ] **Step 3: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

---

## Phase 2: Specs Regression (imports + IdeaEditorSheet)

### Task 4: Align `SpecTarget` type and update Specs imports

**Files:**
- Modify: `mobile/src/features/specs/components/specUiModels.ts`
- Modify: `mobile/app/new-idea.tsx`
- Modify: `mobile/app/idea/[id].tsx`
- Modify: `mobile/src/features/specs/components/SpecsHomeScreen.tsx`
- Modify: `mobile/src/__tests__/ideaDetailRoute.test.tsx`

- [ ] **Step 1: Type alias in specUiModels.ts**

```ts
import { type AgentTarget } from '@/components/agent-target';
export type SpecTarget = AgentTarget;
// Remove duplicate interface SpecTarget { ... }
```

- [ ] **Step 2: Update imports**

Replace:
```ts
import { TargetPickerSheet } from '@/features/specs/components/TargetPickerSheet';
```
With:
```ts
import { AgentTargetPickerSheet } from '@/components/agent-target';
```

Update JSX: `<TargetPickerSheet` → `<AgentTargetPickerSheet` (props unchanged).

- [ ] **Step 3: Update ideaDetailRoute mock**

```ts
jest.mock('@/components/agent-target', () => ({
  AgentTargetPickerSheet: () => null,
}));
```

- [ ] **Step 4: Replace IdeaEditorSheet target row with `AgentTargetField`**

In `IdeaEditorSheet.tsx`:
- Import `AgentTargetField`
- Replace L305–322 `TouchableOpacity` block with:

```tsx
<AgentTargetField value={target} onPress={onChooseTarget} />
```

- Remove unused `targetRow`, `targetBody`, `targetTitle`, `targetSubtitle`, `chooseText` styles from IdeaEditorSheet if no longer referenced.

- [ ] **Step 5: Run Specs-related tests**

```bash
cd mobile && pnpm test -- --watchAll=false SpecsHomeScreen ideaDetailRoute AgentTargetPickerSheet
```

Expected: PASS

- [ ] **Step 6: Delete TargetPickerSheet shim** (if all imports migrated)

Remove `mobile/src/features/specs/components/TargetPickerSheet.tsx`

---

## Phase 3: Workflow Integration

### Task 5: Refactor `WorkflowFormScreen`

**Files:**
- Modify: `mobile/src/features/workflows/components/WorkflowFormScreen.tsx`
- Modify: `mobile/src/features/workflows/components/workflowScreenStyles.ts`

- [ ] **Step 1: Extend Props**

```ts
import { type Endpoint } from '@/types';
import {
  AgentTargetField,
  AgentTargetPickerSheet,
  resolveAgentTarget,
  type AgentTarget,
} from '@/components/agent-target';

interface Props {
  agents: Agent[];
  endpoints: Endpoint[];
  lockedEndpointId?: string;
  // ... existing props
}
```

- [ ] **Step 2: Replace agent state**

Remove:
- `const [agentId, setAgentId] = useState(...agents[0]?.id ?? '')`
- `useEffect` auto-select first agent (L114–121)
- Inline `agents.map` block (L223–248)
- `Switch` import if unused

Add:
```ts
const [selectedTarget, setSelectedTarget] = useState<AgentTarget | undefined>(() =>
  resolveAgentTarget(initialValues?.agent_id, agents, endpoints),
);
const [pickerVisible, setPickerVisible] = useState(false);
```

- [ ] **Step 3: Update canSave conditions**

Replace `agentId.length > 0` with `selectedTarget != null` in `canSaveRecurring` / `canSaveWatch`.

- [ ] **Step 4: Update handleSave**

Use `selectedTarget!.agentId` for `agent_id`.

- [ ] **Step 5: Render field + sheet**

```tsx
<Text style={s.fieldLabel}>{t('workflows.agentLabel')}</Text>
<AgentTargetField
  value={selectedTarget}
  onPress={() => setPickerVisible(true)}
  accessibilityLabel={t('workflows.agentLabel')}
/>
<AgentTargetPickerSheet
  visible={pickerVisible}
  endpoints={endpoints}
  agents={agents}
  selectedTarget={selectedTarget}
  lockedEndpointId={lockedEndpointId}
  onClose={() => setPickerVisible(false)}
  onDone={(target) => {
    setSelectedTarget(target);
    setPickerVisible(false);
  }}
/>
```

- [ ] **Step 6: Remove dead styles**

From `workflowScreenStyles.ts`, delete `agentRow`, `agentRowSelected`, `agentCopy`, `agentName`, `agentEndpoint` if only used by removed inline list.

---

### Task 6: Wire parent routes

**Files:**
- Modify: `mobile/app/(tabs)/workflows.tsx`
- Modify: `mobile/app/workflow/[id].tsx`

- [ ] **Step 1: workflows.tsx**

Pass to `WorkflowFormScreen`:
```tsx
endpoints={endpoints}
lockedEndpointId={editingWorkflow?.endpoint_id}
```

(`endpoints` already available from `useEndpointStore`.)

- [ ] **Step 2: workflow/[id].tsx**

Pass:
```tsx
endpoints={endpoints}
lockedEndpointId={workflow.endpoint_id}
```

---

### Task 7: Update WorkflowFormScreen tests

**Files:**
- Modify: `mobile/src/features/workflows/components/WorkflowFormScreen.test.tsx`

- [ ] **Step 1: Add endpoints fixture**

```ts
const endpoints: Endpoint[] = [
  { id: 'ep-1', label: 'Office Mac', base_url: 'http://local:8765', token: 'tok', last_seen_at: 1 },
];
```

- [ ] **Step 2: Replace/remove obsolete test**

Remove `agent selector shows all registered agents` (inline list gone).

- [ ] **Step 3: Add E2E-1 — Save disabled without agent**

```ts
test('save disabled when no agent selected on blank create', () => {
  const onSave = jest.fn();
  const { getByText } = render(
    <WorkflowFormScreen
      agents={agents}
      endpoints={endpoints}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  fireEvent.changeText(getByPlaceholderText('e.g. CI Watch'), 'Test');
  fireEvent.changeText(getByPlaceholderText('What should the agent do?'), 'Do thing');
  fireEvent.press(getByText('Save'));
  expect(onSave).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Add E2E-2 — sheet select then save**

Fill form → press Agent field (`getByLabelText('Agent')` or Choose text) → select agent in sheet → Save → assert `agent_id`.

- [ ] **Step 5: Fix existing tests that implicitly relied on auto-selected agent**

- `save normalizes time before submitting` — must select agent via sheet first
- `edit mode pre-fills workflow values` — pass `endpoints`, verify field shows agent name, Save still works
- `empty prompt disables save` — unchanged (still no save)

- [ ] **Step 6: Add E2E-4 — locked endpoint on edit**

```ts
test('edit mode locks endpoint in picker', () => {
  const ep2Agents = [...agents, { id: 'agent-3', endpoint_id: 'ep-2', ... }];
  const { getByText, queryByText } = render(
    <WorkflowFormScreen
      agents={ep2Agents}
      endpoints={[endpoints[0], { id: 'ep-2', label: 'Other', ... }]}
      lockedEndpointId="ep-1"
      initialValues={{ agent_id: 'agent-1', name: 'X', prompt: 'Y' }}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  );
  fireEvent.press(getByText('Change')); // or Choose — open sheet
  expect(queryByText('Other')).toBeNull();
});
```

- [ ] **Step 7: Run full mobile test suite**

```bash
cd mobile && pnpm test -- --watchAll=false
cd mobile && pnpm typecheck
```

Expected: all PASS

---

## Phase 4: Cleanup & Verification

### Task 8: Final verification

- [ ] **Step 1: Grep for stale references**

```bash
rg "TargetPickerSheet|agentRow" mobile/
```

Expected: no inline agent list; no duplicate picker implementation (shim deleted).

- [ ] **Step 2: Color / line-count check**

- No new colors outside `brandRefresh` whitelist
- All touched source files ≤ 500 lines

- [ ] **Step 3: Full verification**

```bash
bash scripts/test-all.sh
```

Or minimum:
```bash
cd mobile && pnpm typecheck && pnpm test -- --watchAll=false
```

- [ ] **Step 4: Mark spec done** (after user confirms implementation complete)

```bash
msctl spec mark-done --spec-id fcaf7233-8e26-4e73-8509-92aeff9c5612
```

---

## Spec Coverage Checklist

| Spec § | Task |
|--------|------|
| 8.1 Shared components | Tasks 1–3, 4 (delete shim) |
| 8.2 Workflow create | Tasks 5, 7 |
| 8.3 Workflow edit + lock | Tasks 2, 5, 6, 7 |
| 8.4 Specs regression | Task 4 |
| 8.5 Quality gates | Task 8 |
| E2E-1..7 | Tasks 2, 7 |
| §7 Edge cases | Task 2 (empty), Task 5 (template agent_id via resolveAgentTarget) |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Workflow Field visual mismatch | Reuse IdeaEditorSheet target row styles verbatim in `AgentTargetField` |
| Tests break on auto-select removal | Update all WorkflowFormScreen tests to explicitly pick agent |
| Feature boundary violation | Components live in `src/components/agent-target/`, not under `features/` |
| Template pre-fill regression | `resolveAgentTarget(initialValues.agent_id)` on mount |

---

## Suggested Commit Message (single commit per exec-plan convention)

```
feat(mobile): unify workflow and specs agent picker

Extract AgentTargetField + AgentTargetPickerSheet to shared components.
Workflow form uses sheet picker with endpoint lock on edit; no auto-select.
Specs imports updated; behavior unchanged.
```
