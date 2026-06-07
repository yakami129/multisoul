# Ideas to Specs Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development if available; otherwise use superpowers:executing-plans or the local equivalent. This repository overrides the default per-task commit habit: implement all tasks, pass verification, run required code review, then create one final commit and record its SHA in `docs/exec-plans/index.json`.

**Source Spec:** [`docs/product-specs/2026-06-06-SPEC-ideas-to-specs-refactor.md`](../product-specs/2026-06-06-SPEC-ideas-to-specs-refactor.md)

**Design Reference:** [`docs/design-docs/2026-06-06-ideas-to-specs-refactor-design.md`](../design-docs/2026-06-06-ideas-to-specs-refactor-design.md)

**Goal:** Replace the current fixed five-question Spec draft flow with an Ideas-to-Specs asset workflow: freeform Ideas, chat-first requirement interviews, repo-backed spec artifact snapshots, latest-version Specs list/detail, and explicit implementation Chat creation.

**Architecture:** CLI is the authoritative persistence and orchestration layer for Ideas, Spec artifacts, versions, interview conversations, implementation conversations, and `save-spec`. Mobile keeps an offline-friendly local mirror for draft editing and fast reads, but REST refresh is authoritative after reconnect. Chat remains the place for interview and implementation decisions. Activity remains the execution/status surface; no Run object is introduced.

**Tech Stack:** React Native + Expo Router + Zustand + React Query + expo-sqlite; Rust + axum + rusqlite; existing REST/WS Bearer auth; Jest and Cargo tests.

---

## Baseline Evidence

- Current mobile implementation is a Phase 1 local `SpecDraft` flow in `mobile/src/features/specs/`, `mobile/src/store/specStore.ts`, and `mobile/app/spec/[id].tsx`.
- Current CLI only has `POST /api/v1/agents/:id/specs/dispatch` in `cli/src/serve/routes/specs.rs`; it writes a repo file and immediately dispatches implementation.
- New SPEC requires the opposite authority split: agent writes the repo spec during Interview Chat, then `msctl save-spec --path --conversation-id` saves an immutable artifact snapshot.
- Current REST router has no `spec-ideas`, `specs`, `save-from-path`, or implementation endpoint.
- Current mobile realtime refresh uses `/ws/activity` and can be extended to handle lightweight `spec_changed` frames.

## Implementation Boundaries

- Remove the fixed-question Spec form from the user-facing flow. `Ideas / Specs` must be the only Specs Tab implementation.
- Do not add a Runs board, Run table, multi-agent implementation, auto PR, auto merge, version diff UI, markdown editor, or cloud LLM spec generation.
- V1 supports latest Spec version only in UI; CLI stores immutable versions for future use.
- V1 screenshot attachments reuse the existing upload/file-id pipeline; do not build a separate image storage stack.
- V1 does not add `--idea-id` to `msctl save-spec`; source Idea is derived from `interview_conversation_id`.
- Database schema changes must be explicit idempotent migrations in the DB initialization/migration path and never ad hoc table creation inside request handlers.
- All new mobile colors must come from `mobile/docs/design.md` §2 / `brandRefresh`; no hardcoded off-palette colors.

## Task 1: Domain Contracts and Legacy Flow Cutover

**Files:**
- Modify: `mobile/src/features/specs/types.ts`
- Modify: `mobile/src/features/specs/index.ts`
- Modify: `mobile/src/store/specStore.ts`
- Modify: `mobile/src/store/specStore.test.ts`
- Modify: `cli/src/serve/routes/specs.rs`
- Modify: `cli/src/serve/routes/specs_tests.rs`

- [x] Replace mobile `SpecDraft`-centered types with asset types from the SPEC:
  - `SpecIdea`, `SpecIdeaNote`, `SpecIdeaAttachment`
  - `SpecArtifact`, `SpecArtifactVersion`
  - `IdeaStatus = open | interviewing | converted | archived | failed`
  - `SpecStatus = draft | ready | planning | implementing | blocked | done | failed`
- [x] Keep old fixed interview helpers only as migration utilities while the implementation is in progress; they must not be reachable from the final UI.
- [ ] Rename or split the store so the public API is asset-oriented:
  - `loadIdeas`, `createIdea`, `updateIdea`, `archiveIdea`, `startInterview`
  - `loadSpecs`, `openSpec`, `startImplementation`
  - local mirror helpers for pending/offline Idea edits.
- [ ] Remove mobile usage of `dispatchSpecToAgent` and the old `New Spec -> fixed questions -> dispatch` flow.
- [x] Decide at implementation time whether `POST /api/v1/agents/:id/specs/dispatch` is deleted or left as a private compatibility shim. It must not remain as a second user-facing implementation path.
- [x] Update tests to assert the Specs Tab exposes `Ideas | Specs`, not `Draft | Review | Dispatched`.

**Verification:**
- Run: `cd mobile && pnpm test src/store/specStore.test.ts src/features/specs/services/specInterview.test.ts src/features/specs/services/specMarkdown.test.ts --watchAll=false`
- Expected: old tests fail first, then are replaced by asset-model tests.

## Task 2: CLI Persistence, Migrations, and Repository Layer

**Files:**
- Modify: `cli/src/db.rs`
- Create: `cli/src/serve/spec_assets.rs`
- Create: `cli/src/serve/spec_assets_tests.rs`
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/routes/mod.rs`

- [x] Add idempotent DB migrations for:
  - `spec_ideas`
  - `spec_idea_notes`
  - `spec_idea_attachments`
  - `spec_artifacts`
  - `spec_artifact_versions`
- [x] Include indexes for list queries:
  - ideas by `status, updated_at DESC`
  - specs by `status, updated_at DESC`
  - versions by `spec_id, revision DESC`
  - idea lookup by `interview_conversation_id`
  - spec lookup by `repo_spec_path`
- [x] Implement repository functions in `spec_assets.rs` / `spec_ideas.rs`:
  - create/update/list/get Idea
  - add/list attachments
  - save/list/get Spec artifact snapshots
  - create/update artifact
  - create immutable artifact version
  - derive source Idea from interview conversation
  - mark Idea converted and archived after successful save.
- [ ] Implement append/merge note operations as first-class server mutations.
- [x] Store timestamps in `now_ms()` format and keep JSON serialization limited to attachment metadata that is not relationally queried.
- [x] Add focused DB tests for Idea create/update/context, immutable path-based version creation, and implementation linkage.
- [ ] Add migration idempotency and converted Idea linkage tests.

**Verification:**
- Run: `cd cli && cargo test serve::spec_assets && cargo test db::tests`
- Expected: PASS.

## Task 3: CLI `save-spec` Command and Save-From-Path Endpoint

**Files:**
- Modify: `cli/src/main.rs`
- Modify: `cli/src/commands/mod.rs`
- Create: `cli/src/commands/save_spec.rs`
- Create: `cli/src/commands/save_spec_tests.rs`
- Create or modify: `cli/src/serve/routes/specs.rs`
- Create or modify: `cli/src/serve/routes/specs_tests.rs`
- Modify: `docs/references/cli-commands.md`

- [x] Add top-level command:
  - `msctl save-spec --path <repo-relative-spec-path> --conversation-id <conversation-id> --output <json|text>`
  - resolve token/port/host like `msctl ask-question`.
- [x] Implement `POST /api/v1/specs/save-from-path`.
  - Request: `{ path, conversation_id }`
  - Response: `{ spec_id, version_id, repo_spec_path, revision, status }`
- [x] Resolve the target repo from `conversation_id -> conversations.agent_id -> agents.project_path`.
- [x] Validate `path`:
  - relative only
  - no empty segment, `.`, `..`, slash escaping, or backslash
  - extension is `.md`
  - path starts with `docs/product-specs/`
  - file exists inside the repo and is non-empty.
- [x] Extract title from first H1; derive slug from `YYYY-MM-DD-SPEC-<slug>.md`; reject missing title/slug.
- [x] Compute `markdownSha256`.
- [x] If the repo path already has a spec artifact, create a new immutable version and update `latestVersionId`.
- [x] If it is new, create the artifact with status `ready`, source Idea if found, and `interviewConversationId`.
- [x] After successful save, archive/convert the source Idea and emit `spec_changed`.
- [x] Document the command in `docs/references/cli-commands.md`.

**Verification:**
- Run: `cd cli && cargo test commands::save_spec && cargo test serve::routes::specs`
- Expected: PASS.

## Task 4: CLI Ideas, Specs, Interview, and Implementation REST

**Files:**
- Modify: `cli/src/serve/routes/specs.rs`
- Modify: `cli/src/serve/routes/specs_tests.rs`
- Modify: `cli/src/serve/router.rs`
- Modify: `cli/src/serve/routes/activity_events.rs`
- Modify: `cli/src/serve/routes/activity_events/tests.rs`
- Reuse or modify: `cli/src/serve/routes/messages.rs`
- Reuse or modify: `cli/src/serve/routes/conversations.rs`

- [x] Add routes:
  - [x] `GET /api/v1/spec-ideas`
  - [x] `POST /api/v1/spec-ideas`
  - [x] `PATCH /api/v1/spec-ideas/:id`
  - [x] `POST /api/v1/spec-ideas/:id/interview`
  - [x] `GET /api/v1/specs`
  - [x] `GET /api/v1/specs/:id`
  - [x] `POST /api/v1/specs/:id/implement`
- [x] `POST /api/v1/spec-ideas/:id/interview` must:
  - verify target agent exists and belongs to the intended repo/endpoint context
  - create or reuse the linked interview conversation
  - insert an initial user message containing Idea body, notes, attachment summaries, repo path, agent metadata, and interview instructions
  - dispatch that message through the selected runtime
  - set Idea status to `interviewing`
  - emit `spec_changed` and Activity refresh.
- [x] `POST /api/v1/specs/:id/implement` must:
  - create a new implementation conversation, never reuse the interview conversation
  - insert an initial user message instructing the agent to read the spec, write an implementation plan first, wait for user confirmation via AskUserQuestion, then implement
  - update `latestImplementationConversationId`
  - emit `spec_changed` and Activity refresh.
- [x] `GET /api/v1/specs` returns latest version metadata only.
- [ ] Derive list status from linked implementation Chat / Activity beyond the stored planning update.
- [x] `GET /api/v1/specs/:id` includes latest markdown snapshot and hash.
- [x] Extend the existing Activity event socket to also broadcast frames shaped like:
  - `{ "type": "spec_changed", "spec_id": "...", "conversation_id": "...", "created_at": 123 }`
- [x] Keep `GET /api/v1/healthz` as the only unauthenticated route; all new REST/WS paths stay under Bearer auth.

**Verification:**
- Run: `cd cli && cargo test serve::routes::specs && cargo test serve::routes::activity_events`
- Expected: PASS.

## Task 5: Mobile Data Layer, Local Mirror, and Realtime Refresh

**Files:**
- Modify: `mobile/src/db/index.ts`
- Create: `mobile/src/features/specs/services/specAssetService.ts`
- Create: `mobile/src/features/specs/services/specAssetService.test.ts`
- Create: `mobile/src/features/specs/services/specAssetRepository.ts`
- Create: `mobile/src/features/specs/services/specAssetRepository.test.ts`
- Create: `mobile/src/features/specs/hooks/useSpecEvents.ts`
- Create: `mobile/src/features/specs/hooks/useSpecEvents.test.tsx`
- Modify: `mobile/src/store/specStore.ts`
- Modify: `mobile/src/store/specStore.test.ts`
- Modify: `mobile/app/_layout.tsx`

- [x] Replace or migrate the old local `specs` table into mirror tables matching the asset model.
- [x] Keep old table reads as a one-time migration source:
  - local draft/review/approved rows become open Ideas
  - rows with `repoSpecPath` and markdown become legacy local Spec mirrors when possible
  - record a migration marker so this does not repeat.
- [x] Implement REST clients for all new Ideas/Specs endpoints using `getEndpointClient`.
- [x] Implement local mirror repository reads/writes for offline Ideas and cached Spec artifacts.
- [x] Add pending mutation state for local Idea edits when the endpoint is offline; server actions stay disabled until sync succeeds.
- [x] Implement `useSpecEvents` over each endpoint's existing activity event socket URL and refresh on `spec_changed`.
- [x] On app startup, initialize the mirror, load cached Ideas/Specs, then refresh from each configured endpoint.
- [x] On realtime `spec_changed`, REST refresh reconciles the local mirror with CLI authority.
- [ ] Add explicit reconnect/focus-triggered refresh beyond the current startup and WS refresh paths.

**Verification:**
- Run: `cd mobile && pnpm test src/features/specs/services/specAssetService.test.ts src/features/specs/services/specAssetRepository.test.ts src/features/specs/hooks/useSpecEvents.test.tsx src/store/specStore.test.ts --watchAll=false`
- Expected: PASS.

## Task 6: Specs Home, Idea Capture, and Target Selection UI

**Files:**
- Modify: `mobile/app/(tabs)/specs.tsx`
- Modify: `mobile/src/features/specs/components/SpecsListScreen.tsx`
- Modify: `mobile/src/features/specs/components/SpecsListScreen.test.tsx`
- Create: `mobile/src/features/specs/components/SpecsHomeScreen.tsx`
- Create: `mobile/src/features/specs/components/SpecsHomeScreen.test.tsx`
- Create: `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- Create: `mobile/src/features/specs/components/IdeaEditorSheet.test.tsx`
- Create: `mobile/src/features/specs/components/TargetPickerSheet.tsx`
- Create: `mobile/src/features/specs/components/TargetPickerSheet.test.tsx`

- [x] Build Specs Home as an iOS-style navigation/list screen with a page-level `Ideas | Specs` segmented control.
- [x] Ideas segment:
  - inline capture row
  - `Open Ideas`, `Converted Recently`, and collapsed `Archived` sections
  - row metadata for title, repo, agent, notes, attachments, updated age, and status.
- [x] Specs segment:
  - `Needs You`, `Ready`, `In Progress`, `Done` sections
  - latest version only, showing repo path, revision, short hash, and status summary.
- [x] Implement Create/Edit Idea sheet:
  - title optional and auto-derived from first body line
  - body text area
  - attachment rows for link/log/image
  - target row
  - auto-save behavior
  - discard/close confirmation only when unsaved changes exist.
- [x] Implement Target Picker sheet:
  - endpoint list and filtered agents
  - offline endpoints visible but disabled with explanatory copy
  - `Done` enabled only when endpoint + agent + repo are valid.
- [x] Implement archive/unarchive with undo affordance; destructive delete, if any remains, must use an action sheet.
- [x] Keep buttons at least 44x44 pt, support Dynamic Type, and ensure status is not color-only.

**Verification:**
- Run: `cd mobile && pnpm test src/features/specs/components/SpecsHomeScreen.test.tsx src/features/specs/components/IdeaEditorSheet.test.tsx src/features/specs/components/TargetPickerSheet.test.tsx src/features/specs/components/SpecsListScreen.test.tsx --watchAll=false`
- Expected: PASS.

## Task 7: Idea Detail and Interview Chat Integration

**Files:**
- Create: `mobile/app/idea/[id].tsx`
- Modify: `mobile/app/_layout.tsx`
- Create: `mobile/src/features/specs/components/IdeaDetailScreen.tsx`
- Create: `mobile/src/features/specs/components/IdeaDetailScreen.test.tsx`
- Create: `mobile/src/features/specs/components/PinnedIdeaSummary.tsx`
- Create: `mobile/src/features/specs/components/PinnedIdeaSummary.test.tsx`
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/app/chat/ChatHeader.tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [x] Add Idea Detail route and grouped form UI:
  - Summary
  - Notes
  - Attachments
  - Target
  - Related
  - bottom action: `Start Interview`, `Continue Interview`, or `View Spec`.
- [ ] Implement Add Note and Merge Notes with undo.
- [x] Implement attachment rows for link, log, and image file references.
- [x] Start Interview through `POST /api/v1/spec-ideas/:id/interview`; navigate to the returned normal Chat.
- [ ] Chat UI detects interview context and shows a collapsible pinned Idea summary above the transcript.
- [x] AskUserQuestion cards remain the only structured decision mechanism; do not add free-text option picking in the Ideas UI.
- [ ] Save-spec progress and failure feedback should appear in Chat as inline system/message rows when the backend emits or persists those events.

**Verification:**
- Run: `cd mobile && pnpm test src/features/specs/components/IdeaDetailScreen.test.tsx src/features/specs/components/PinnedIdeaSummary.test.tsx src/__tests__/chatDetailRoute.test.tsx --watchAll=false`
- Expected: PASS.

## Task 8: Spec Detail, Markdown Snapshot, and Implementation Entry

**Files:**
- Modify: `mobile/app/spec/[id].tsx`
- Modify: `mobile/src/features/specs/components/SpecDetailScreen.tsx`
- Modify: `mobile/src/features/specs/components/SpecDetailScreen.test.tsx`
- Create: `mobile/src/features/specs/components/SpecMarkdownReader.tsx`
- Create: `mobile/src/features/specs/components/SpecMarkdownReader.test.tsx`
- Modify: `mobile/src/features/specs/services/specAssetService.ts`
- Modify: `mobile/src/store/specStore.ts`

- [x] Replace old review/approval/dispatch screen with artifact detail sections:
  - Overview
  - Repo File
  - Artifact Snapshot
  - Related
  - Status.
- [x] Show latest version only with `rev N`, short hash, repo path, source Idea, interview Chat, and implementation Chat/Activity summary.
- [x] Artifact Snapshot defaults to summarized markdown content with `Read Full Spec`.
- [x] Add read-only markdown reader; no markdown editing.
- [ ] Add markdown reader search.
- [x] Implement bottom action:
  - `Start Implementation` for `ready`
  - `Open Implementation Chat` for planning/implementing
  - `Answer Required` for blocked
  - disabled with inline footer when endpoint is offline.
- [x] `Start Implementation` calls `POST /api/v1/specs/:id/implement` and navigates to the new normal Chat.
- [x] Ensure the first implementation message tells the agent to write an implementation plan first and wait for user confirmation via AskUserQuestion.

**Verification:**
- Run: `cd mobile && pnpm test src/features/specs/components/SpecDetailScreen.test.tsx src/features/specs/components/SpecMarkdownReader.test.tsx src/store/specStore.test.ts --watchAll=false`
- Expected: PASS.

## Task 9: Cleanup, Documentation, and Full Verification

**Files:**
- Modify: `docs/exec-plans/index.json`
- Modify: `docs/references/cli-commands.md`
- Possibly modify: `README.md`
- Possibly modify: `CLAUDE.md` / `AGENTS.md` only if new durable rules are introduced
- Remove or rewrite obsolete fixed-interview tests under `mobile/src/features/specs/services/`

- [ ] Remove unused fixed-question interview code, old markdown preview generation, old dispatch service, and obsolete tests once the new flow passes.
- [x] Verify no mobile source file in `mobile/src|app` exceeds 500 lines; split UI components if needed.
- [x] Verify no `console.log`, `@ts-ignore`, `eslint-disable`, or Rust `#[allow(...)]` suppressions were introduced.
- [x] Run docs index validation:
  - `python3 scripts/check-docs-indices.py`
- [x] Run required mobile checks:
  - `cd mobile && pnpm typecheck`
  - `cd mobile && pnpm test --watchAll=false`
- [x] Run required CLI checks:
  - `cd cli && cargo test`
  - `cd cli && cargo build`
- [ ] Manual UI verification against `docs/design-docs/2026-06-06-ideas-to-specs-refactor-design.md` §17:
  - Specs Home uses grouped list and `Ideas | Specs`
  - Create/Edit Idea uses sheet
  - Target Picker handles offline endpoints inline
  - Interview uses normal Chat with pinned Idea summary
  - `msctl save-spec` produces visible latest Spec after REST refresh and WS notification
  - Spec Detail starts a new implementation Chat
  - no text overlap, off-palette colors, or inaccessible tap targets.
- [x] Before final commit, run the required code review workflow from repository rules, fix Critical/Important findings, rerun impacted verification, then commit once.
- [ ] After final commit, update this plan's entry in `docs/exec-plans/index.json` with `lastCompletedCommit`.

## Self-Review Checklist

- [x] SPEC acceptance criteria 1-17 are mapped to implementation tasks.
- [x] Old fixed-question flow is removed from the user-facing path.
- [ ] `save-spec` is the only way a repo file becomes a Spec artifact.
- [x] Spec versions are immutable snapshots and UI shows latest only.
- [x] Implementation starts in a new Chat and requires plan confirmation.
- [x] REST remains authoritative after reconnect; WS is refresh notification only.
- [x] Out-of-scope items remain out of scope.

## Completion Evidence

- `cd cli && cargo test` — PASS, 296 unit tests + 10 smoke tests.
- `cd cli && cargo build` — PASS.
- `cd mobile && pnpm typecheck` — PASS.
- `cd mobile && pnpm test --watchAll=false` — PASS, 83 suites / 513 tests. Jest still prints pre-existing `act(...)` warnings in Activity/Chat route tests, but no test failed.
- `python3 scripts/check-docs-indices.py` — PASS.
- `python3 scripts/check-doc-code-hashes.py --check` — PASS after reviewing `cli/src/db.rs`, moving new CLI asset tables into `cli/migrations/20260606_spec_assets.sql`, and updating `docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md`.
- Static scan for `console.log`, `@ts-ignore`, `eslint-disable`, and Rust `#[allow(...)]` in touched CLI/mobile paths — PASS.
- Line-count check for touched `mobile/src|app` and `cli/src` files — PASS; no touched source file exceeds 500 lines.
- Required pre-commit code review — PASS after fixing one Important finding: new CLI Spec/Idea tables now use an explicit DB migration instead of being added directly to the base schema block.

Remaining follow-up items:
- Server-side Add Note / Merge Notes mutations and mobile editing affordance.
- Chat transcript pinned Idea summary and save-spec inline progress/failure rows.
- Full Activity-derived Spec status mapping beyond the stored `planning` update.
- Explicit reconnect/focus refresh trigger beyond startup load and `spec_changed` WS refresh.
- Optional markdown reader search.
- Final removal of legacy fixed-question store/services and private dispatch compatibility once downstream references are retired.
