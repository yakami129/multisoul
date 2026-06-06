# Workflow Template Library Implementation Plan

**Goal:** Implement the Workflow template library from `docs/product-specs/2026-06-06-SPEC-workflow-template-library.md`: users can choose `Blank Workflow` or one of 10 built-in mobile templates, then edit and save through the existing workflow create API.

**Architecture:** Template definitions live only in mobile code. The picker passes optional `WorkflowInput` initial values into the existing `WorkflowFormScreen`. The saved payload remains the current `WorkflowInput`; CLI schema and REST API stay unchanged.

**Worktree:** `/Users/openclawd/Documents/code/multisoul-workflow-template-library`

**Branch:** `codex/workflow-template-library`

**Implementation boundaries:**

- Do not add CLI template APIs or schema columns.
- Do not persist template id, boundary, category, or source.
- Do not implement custom templates or interval loop schedules.
- Keep `Blank Workflow` as a first-class entry.
- Preserve existing Workflow List, Detail, Activity run behavior.
- Use existing `mobile/docs/design.md` colors and iOS UI conventions.

## Task 1: Template Data And Types

**Files:**

- Create: `mobile/src/features/workflows/templates.ts`
- Create: `mobile/src/features/workflows/templates.test.ts`

- [x] Define template boundary and template types.
- [x] Add 10 built-in templates from the spec.
- [x] Ensure each template has category, title, description, boundary label, boundary description, and complete `initial_values`.
- [x] Write tests asserting exactly 10 templates, unique IDs, non-empty prompts, valid schedules, and all five categories covered.

## Task 2: Template Picker Component

**Files:**

- Create: `mobile/src/features/workflows/components/WorkflowTemplatePickerScreen.tsx`
- Create: `mobile/src/features/workflows/components/WorkflowTemplatePickerScreen.test.tsx`
- Modify as needed: `mobile/src/features/workflows/components/workflowScreenStyles.ts`

- [x] Build a compact picker screen with header, `Blank Workflow` entry, and template list.
- [x] Show template title, description, boundary label, boundary explanation, and recommended schedule.
- [x] Keep cards compact; do not introduce a hero or marketing layout.
- [x] Write tests for Blank visibility, all templates rendering, boundary copy, and selection callbacks.

## Task 3: Creation Flow Wiring

**Files:**

- Modify: `mobile/app/(tabs)/workflows.tsx`
- Modify as needed: `mobile/src/features/workflows/components/WorkflowFormScreen.tsx`
- Modify tests as needed under `mobile/src/features/workflows/components/`

- [x] Change `+` behavior from opening form directly to opening the template picker.
- [x] Selecting Blank opens the existing form with empty/default values.
- [x] Selecting a template opens the same form with `initialValues` from the template.
- [x] Save still calls `createWorkflow(endpoint, input)` with plain `WorkflowInput`.
- [x] Ensure no `template_id`, `boundary`, or `category` is sent to CLI.
- [x] Preserve current endpoint and agent selection behavior.

## Task 4: Edit Flow Compatibility

**Files:**

- Modify as needed: `mobile/app/(tabs)/workflows.tsx`
- Modify as needed: `mobile/app/workflow/[id].tsx`
- Modify tests as needed.

- [x] Verify template picker does not affect existing edit behavior.
- [x] If edit support is absent on this branch, add a minimal edit route or keep creation changes isolated and document the gap.
- [x] Ensure editing an existing workflow never reopens the template picker.

## Task 5: Verification And Docs

**Files:**

- Modify: `docs/product-specs/index.json`
- Modify: `docs/exec-plans/index.json`

- [x] Register the product spec in `docs/product-specs/index.json`.
- [x] Register this plan in `docs/exec-plans/index.json`.
- [x] Run focused Workflow tests.
- [x] Run `cd mobile && pnpm typecheck`.
- [x] Run `cd mobile && pnpm test --watchAll=false`.
- [x] Run `cd mobile && pnpm format:check`.
- [x] Run `python3 scripts/check-docs-indices.py`.

## Acceptance Criteria

- `+` opens a picker with `Blank Workflow` and 10 built-in templates.
- Blank creation still works and uses the existing workflow form.
- Template creation pre-fills name, prompt, schedule kind, time, and weekday.
- User can edit all prefilled fields before saving.
- Saved API payload remains plain `WorkflowInput`.
- Template cards show boundary label and one-line boundary explanation.
- Mobile tests and typecheck pass.
