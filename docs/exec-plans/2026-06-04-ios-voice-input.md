# iOS Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/2026-06-04-SPEC-ios-voice-input.md`](../product-specs/2026-06-04-SPEC-ios-voice-input.md)

**Goal:** Replace the Chat composer microphone placeholder with iOS-only system speech recognition. The final transcript is appended to the existing text input and the user must still tap Send. Android/Web remain disabled for MVP.

**Architecture:** Keep CLI, REST, WebSocket, and `postMessage` unchanged. Add an iOS speech-recognition layer inside the Chat feature that wraps `expo-speech-recognition`, maps native events into a small voice-input state machine, and calls the existing `onChangeText` prop only after a final non-empty transcript. Split UI into a focused `VoiceInputButton` so `ChatInputBar` remains mostly layout-only and existing large tests do not cross the 500-line guard.

**Tech Stack:** React Native, Expo SDK 55, TypeScript, `expo-speech-recognition@3.1.3` (`sdk-55` dist-tag), `expo-localization@55.0.15` (`sdk-55` dist-tag), Jest, `@testing-library/react-native`.

---

## Key Decisions And Constraints

- Use iOS system speech recognition through `expo-speech-recognition`, not OpenAI/Whisper.
- Use `expo-speech-recognition@sdk-55` / `3.1.3`; npm latest currently targets SDK 56 and must not be installed into this Expo SDK 55 app.
- Add `expo-localization@sdk-55` / `55.0.15` so `start({ lang })` can receive the device BCP-47 locale. Do not rely on `expo-speech-recognition`'s default `en-US`.
- Do not add `expo-speech-recognition` to `expo.plugins` in the first pass. Its bundled config plugin unconditionally adds Android `RECORD_AUDIO` and package-visibility config, while this MVP disables Android. Instead, add the required iOS plist keys explicitly in `mobile/app.json`.
- If local iOS build verification proves the package plugin is required beyond plist generation, stop and ask the user whether Android manifest side effects are acceptable before enabling it.
- Do not persist audio: do not set `recordingOptions.persist`, and do not log `audiostart` / `audioend` URIs.
- `ExpoSpeechRecognitionModule.stop()` attempts to return the final result; `abort()` cancels and emits an `aborted` error. The UI must suppress user-facing alerts for intentional aborts.
- `ChatInputBar.test.tsx` is already near 500 lines. Move voice behavior assertions to new focused tests and only shrink/update the old placeholder assertion.

## Source Inputs

- Product spec: `docs/product-specs/2026-06-04-SPEC-ios-voice-input.md`
- Current composer: `mobile/src/features/chat/components/ChatInputBar.tsx`
- Current composer tests: `mobile/src/features/chat/components/ChatInputBar.test.tsx`
- Chat detail owner of input state: `mobile/app/chat/[id].tsx`
- iOS permission guard: `scripts/check-ios-permissions.sh`
- R12 docs: `docs/quality/mechanized-constraints.md`
- Dependency API checked from `expo-speech-recognition@3.1.3` package README and type definitions

## File Map

| File | Responsibility |
|------|----------------|
| `mobile/package.json` | Add SDK-55-compatible speech recognition and localization dependencies. |
| `mobile/pnpm-lock.yaml` | Lock new dependency graph. |
| `mobile/app.json` | Add `NSSpeechRecognitionUsageDescription`; keep microphone text aligned. |
| `scripts/check-ios-permissions.sh` | Add R12 mapping for `expo-speech-recognition`. |
| `docs/quality/mechanized-constraints.md` | Mirror the new R12 module-to-key mapping; clean up duplicate R12 text if touched. |
| `mobile/src/features/chat/utils/voiceInputText.ts` | Pure helpers for appending transcripts and deriving display-safe text. |
| `mobile/src/features/chat/utils/voiceInputText.test.ts` | Unit tests for append/empty transcript rules. |
| `mobile/src/features/chat/hooks/useVoiceInput.ts` | iOS-only state machine over speech-recognition events, permissions, timeout, and error mapping. |
| `mobile/src/features/chat/hooks/useVoiceInput.test.tsx` | Hook/component harness tests for state transitions and native event handling. |
| `mobile/src/features/chat/components/VoiceInputButton.tsx` | Mic/recording/transcribing controls, stop/cancel actions, accessibility labels. |
| `mobile/src/features/chat/components/VoiceInputButton.test.tsx` | Focused UI tests for disabled, recording, cancel, stop, and alert flows. |
| `mobile/src/features/chat/components/ChatInputBar.tsx` | Replace placeholder mic button with `VoiceInputButton` and transcript append callback. |
| `mobile/src/features/chat/components/ChatInputBar.test.tsx` | Remove placeholder-alert expectation; keep only lightweight composition/layout assertions. |
| `mobile/jest.setup.js` or focused test mocks | Mock `expo-speech-recognition` and `expo-localization` where needed. |
| `docs/exec-plans/index.json` | Register this plan; add `lastCompletedCommit` only after implementation is complete and committed. |

## Task 0: Baseline And Registration

**Files:**
- Modify: `docs/exec-plans/index.json`

- [x] **Step 1: Register this plan in the exec-plan index**

Add a new first entry:

```json
{
  "file": "2026-06-04-ios-voice-input.md",
  "title": "iOS Voice Input Implementation Plan"
}
```

- [x] **Step 2: Run baseline focused composer tests**

Run:

```bash
cd mobile && pnpm test -- ChatInputBar.test.tsx --watchAll=false
```

Expected: PASS before feature edits.

- [x] **Step 3: Run baseline mobile typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS before feature edits.

## Task 1: Dependencies And Permission Metadata

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/pnpm-lock.yaml`
- Modify: `mobile/app.json`
- Modify: `scripts/check-ios-permissions.sh`
- Modify: `docs/quality/mechanized-constraints.md`

- [x] **Step 1: Add SDK-compatible packages**

Run from `mobile/`:

```bash
pnpm add expo-speech-recognition@sdk-55 expo-localization@sdk-55
```

Expected:

- `expo-speech-recognition` resolves to `3.1.3`.
- `expo-localization` resolves to `55.0.15`.
- `mobile/pnpm-lock.yaml` updates.

- [x] **Step 2: Add iOS speech-recognition usage description**

In `mobile/app.json`, add:

```json
"NSSpeechRecognitionUsageDescription": "MultiSoul uses iOS speech recognition to turn your voice into editable chat text."
```

Keep `NSMicrophoneUsageDescription` present and non-empty.

- [x] **Step 3: Do not enable the package config plugin by default**

Leave `expo-speech-recognition` out of `expo.plugins` for MVP to avoid Android manifest side effects.

If implementation verification shows the plugin is mandatory for iOS runtime behavior, pause and ask the user whether to accept Android `RECORD_AUDIO` manifest changes before adding it.

- [x] **Step 4: Extend R12 permission guard**

Add a mapping in `scripts/check-ios-permissions.sh`:

```bash
"expo-speech-recognition:NSMicrophoneUsageDescription,NSSpeechRecognitionUsageDescription"
```

- [x] **Step 5: Mirror the mapping in quality docs**

Update every R12 module mapping table in `docs/quality/mechanized-constraints.md` so `expo-speech-recognition` lists both required keys.

If editing the duplicated R12 section, prefer removing the duplicate and keeping one canonical R12 section, but do not broaden the change beyond that cleanup.

- [x] **Step 6: Verify metadata checks**

Run:

```bash
bash scripts/check-ios-permissions.sh
python3 scripts/check-docs-indices.py
```

Expected: both pass.

## Task 2: Pure Text And Locale Helpers

**Files:**
- Create: `mobile/src/features/chat/utils/voiceInputText.ts`
- Create: `mobile/src/features/chat/utils/voiceInputText.test.ts`

- [x] **Step 1: Add failing text append tests**

Cover:

- Empty input + transcript returns transcript.
- Existing input + transcript appends one separating space.
- Existing input ending with whitespace does not add a second space.
- Empty/whitespace transcript returns original input.
- Output respects the existing 4096 character composer cap.

- [x] **Step 2: Implement `appendVoiceTranscript`**

Add a pure helper:

```ts
export function appendVoiceTranscript(current: string, transcript: string, maxLength = 4096): string;
```

Keep it deterministic and free of native imports.

- [x] **Step 3: Add locale helper tests**

Cover a simple helper that normalizes the first device locale into a BCP-47 language tag and falls back to `en-US` only when localization returns no usable locale.

Mock `expo-localization` in the test rather than relying on the host environment.

- [x] **Step 4: Implement `getSystemSpeechLocale`**

Use `getLocales()[0]?.languageTag` from `expo-localization`.

Do not hardcode Chinese or English as the normal path.

## Task 3: Voice Input Hook State Machine

**Files:**
- Create: `mobile/src/features/chat/hooks/useVoiceInput.ts`
- Create: `mobile/src/features/chat/hooks/useVoiceInput.test.tsx`

- [x] **Step 1: Add native module mocks**

Mock `expo-speech-recognition` with:

- `ExpoSpeechRecognitionModule.requestPermissionsAsync`
- `ExpoSpeechRecognitionModule.isRecognitionAvailable`
- `ExpoSpeechRecognitionModule.start`
- `ExpoSpeechRecognitionModule.stop`
- `ExpoSpeechRecognitionModule.abort`
- `useSpeechRecognitionEvent`
- `TaskHintIOS.dictation` if used by implementation

Expose a test helper that can invoke captured `start`, `result`, `nomatch`, `error`, and `end` callbacks.

- [x] **Step 2: Add failing success-flow tests**

Cover:

- iOS + granted permissions starts recognition with `lang` from `getSystemSpeechLocale`.
- Start options include `interimResults: true`, `continuous: false`, and no `recordingOptions.persist`.
- `stopVoiceInput()` calls `ExpoSpeechRecognitionModule.stop()` and enters `transcribing`.
- Final `result` followed by `end` calls `onTranscript` once.
- The hook never calls the send callback.

- [x] **Step 3: Add failing cancel tests**

Cover:

- `cancelVoiceInput()` calls `ExpoSpeechRecognitionModule.abort()`.
- The following `aborted` error and `end` do not show an alert.
- No transcript is committed after cancel.

- [x] **Step 4: Add failing permission/support tests**

Cover:

- Android/Web returns `unavailable` and never calls native `start`.
- Disabled composer returns disabled controls and never starts recognition.
- Permission denied maps to a permission alert and opens settings when selected.
- `isRecognitionAvailable() === false` maps to unavailable/error UX.

- [x] **Step 5: Add failing error and timeout tests**

Cover:

- `network` maps to speech recognition failed.
- `no-speech`, `speech-timeout`, and `nomatch` map to no speech recognized.
- `language-not-supported` maps to current language unavailable.
- A fixed timeout, e.g. `VOICE_INPUT_TIMEOUT_MS = 45_000`, stops or aborts recognition and returns to idle with a timeout alert.

- [x] **Step 6: Implement the hook**

Expose a compact API:

```ts
type VoiceInputStatus = 'idle' | 'requesting_permission' | 'recording' | 'transcribing' | 'unavailable';

return {
  status,
  isAvailable,
  isBusy,
  startVoiceInput,
  stopVoiceInput,
  cancelVoiceInput,
};
```

Implementation rules:

- Gate on `Platform.OS === 'ios'`.
- Request permissions before every start attempt unless already known granted.
- Clear timeout timers in all terminal paths.
- Store latest result text in a ref; commit only on terminal `end` after non-cancelled stop/final result.
- Log diagnostics only with event/error codes; never log transcript text or audio URI.
- Use `console.warn` only for unexpected native failures; no `console.log`.

## Task 4: Voice Input Button Component

**Files:**
- Create: `mobile/src/features/chat/components/VoiceInputButton.tsx`
- Create: `mobile/src/features/chat/components/VoiceInputButton.test.tsx`

- [x] **Step 1: Add failing idle/disabled UI tests**

Cover:

- Idle iOS renders a mic control with accessibility label `Voice input`.
- Disabled composer exposes disabled accessibility state.
- Android/Web renders disabled and does not call `startVoiceInput`.

- [x] **Step 2: Add failing recording/transcribing UI tests**

Cover:

- Recording renders a stop control and a cancel control.
- Stop calls `stopVoiceInput`.
- Cancel calls `cancelVoiceInput`.
- Transcribing shows a stable progress affordance and disables repeated taps.

- [x] **Step 3: Implement the component**

Use existing composer control dimensions and approved brand colors only:

- Reuse 28px round shell scale from `ChatInputBar`.
- Use `Mic`, `Square`, `X`, and `ActivityIndicator` or existing lucide icons.
- Use `brandColors.ink`, `brandColors.textMuted`, `brandColors.error`, `brandColors.white`, and existing `brandRgba` values only.
- Keep labels icon-based; do not add explanatory text inside the toolbar.

## Task 5: Wire Into ChatInputBar

**Files:**
- Modify: `mobile/src/features/chat/components/ChatInputBar.tsx`
- Modify: `mobile/src/features/chat/components/ChatInputBar.test.tsx`
- Add or update focused composer integration test if needed

- [x] **Step 1: Replace placeholder voice action**

Remove `handleVoicePress` and the `Alert.alert('语音功能即将上线，敬请期待')` behavior.

Render `VoiceInputButton` in the existing trailing toolbar position.

- [x] **Step 2: Commit transcript through existing text state**

Pass a callback to `VoiceInputButton` / `useVoiceInput` that does:

```ts
onChangeText(appendVoiceTranscript(value, transcript));
```

Do not call `onSend`.

- [x] **Step 3: Preserve existing composer behavior**

Keep unchanged:

- plus sheet behavior
- model selector behavior
- image preview and removal
- char counter behavior
- send/stop conversation action behavior
- 4096 max length

- [x] **Step 4: Update existing tests narrowly**

In `ChatInputBar.test.tsx`, remove or rewrite only the placeholder-alert test so it asserts the voice component stays in the trailing toolbar and does not send directly.

Do not add large new voice interaction cases to this file.

## Task 6: Chat Route And Integration Coverage

**Files:**
- Modify focused tests under `mobile/src/__tests__/` only if route-level wiring needs coverage

- [x] **Step 1: Add route-level test if callback wiring is not covered elsewhere**

If `ChatInputBar` tests cannot prove input state is updated from a transcript, add a focused Chat route test that:

- Mocks the voice hook or native module.
- Emits a final transcript.
- Asserts the message input contains appended text.
- Asserts `postMessage` is not called until Send is pressed.

Completed via focused `ChatInputBar` integration coverage; no route-level voice test was needed.

- [x] **Step 2: Avoid broad route-test churn**

Do not edit large route tests unless necessary. Prefer a small new test file with targeted mocks.

## Task 7: Verification And Documentation Freshness

**Files:**
- Potentially modify: `docs/design-docs/2026-05-03-ios-permission-guard-design.md`
- Potentially modify: `docs/design-docs/index.json`
- Modify: `docs/exec-plans/index.json` only after final completion commit

- [x] **Step 1: Run focused tests**

Run:

```bash
cd mobile && pnpm test -- voiceInputText.test.ts useVoiceInput.test.tsx VoiceInputButton.test.tsx ChatInputBar.test.tsx --watchAll=false
```

Expected: PASS.

- [x] **Step 2: Run full mobile checks required by the spec**

Run:

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

Expected: both pass.

Note: `pnpm test -- --watchAll=false` is parsed as a Jest pattern in this worktree's package script, so the equivalent `pnpm exec jest --watchAll=false` was used for the full Jest run.

- [x] **Step 3: Run repo guard checks affected by this plan**

Run:

```bash
bash scripts/check-ios-permissions.sh
python3 scripts/check-docs-indices.py
python3 scripts/check-doc-code-hashes.py --check
```

Expected: all pass.

If `check-doc-code-hashes.py --check` reports stale tracked code, first inspect the relevant diff and update the matching design doc body or note why it remains semantically unchanged, then run `python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md` only for that one doc.

- [ ] **Step 4: Manual iOS smoke check**

Run an iOS development build or simulator session:

```bash
cd mobile && pnpm ios
```

Expected:

- First mic tap requests microphone and speech recognition permissions.
- Granted permissions allow recording.
- Stop inserts transcript into the input.
- Cancel leaves input unchanged.
- Send still requires a separate tap.

Result on 2026-06-05:

- `cd mobile && pnpm ios` completed the native prebuild, installed CocoaPods, built the iOS app, and compiled/packaged `expo-speech-recognition` successfully.
- Build output reported `Build Succeeded`, `0 error(s)`, and 2 warnings before installing/opening `MultiSoul.app` on the iPhone 17 Pro simulator.
- Generated `ios/MultiSoul/Info.plist` contains both `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`.
- The app launched in the simulator and the home screen rendered.
- Deep-linking into a chat screen with an isolated temporary `msctl serve` backend reached an online conversation state (`IDLE`) with the composer and `mic-btn` enabled.
- First mic tap showed the native speech recognition permission prompt with `NSSpeechRecognitionUsageDescription`; allowing it then showed the native microphone permission prompt with `NSMicrophoneUsageDescription`.
- With the simulator initially set to `zh-Hans-CN`, the app showed the expected `Language unavailable` alert from the native `language-not-supported` error path.
- After switching the simulator language to `en-US`, tapping mic briefly surfaced the recording controls, including `Cancel voice input`, before the simulator returned `Speech recognition failed`. `simctl io` has no audio-input configuration, and `cliclick` still lacks Accessibility privileges, so this environment cannot reliably complete a fast stop/cancel/transcript manual pass.
- Interaction-level checks for stop insertion, cancel no-op, and successful transcript insertion remain covered by the focused hook/component tests listed above; a physical iPhone or a simulator with working host microphone access is still needed to fully close this manual smoke step.

- [x] **Step 5: Review and commit protocol**

Before committing:

- Review `git diff`.
- Run the required code review workflow from `AGENTS.md`.
- Fix Critical/Important findings and rerun affected checks.
- Make one implementation commit after all tasks pass.
- Add the 40-character commit SHA to this plan's `lastCompletedCommit` entry in `docs/exec-plans/index.json` after that commit.
