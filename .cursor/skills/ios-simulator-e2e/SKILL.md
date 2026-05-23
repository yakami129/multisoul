---
name: ios-simulator-e2e
description: >
  Run real iOS Simulator end-to-end and visual verification for MultiSoul mobile changes. Use this skill whenever the user asks to test iOS, verify an iPhone screenshot, check UI alignment, reproduce a mobile bug in the simulator, do visual QA, or perform E2E validation after React Native / Expo UI changes. Also use it before calling iOS UI work "done" when screenshots, navigation, safe areas, tab bars, text/icon alignment, or real-device behavior matter.
---

# iOS Simulator E2E

Use the real iOS Simulator to verify MultiSoul mobile behavior visually and interactively. Unit tests catch logic; this skill catches the things users actually see: alignment, safe areas, navigation, stale data, scroll clipping, and whether the app still feels like the reference screenshots.

## When To Use

Use this skill for:

- iOS UI bugs, visual regressions, or "the screenshot still looks wrong"
- Project / Activity / Chat / Settings flows that need real navigation
- changes touching safe areas, headers, tab bars, lists, typography, or icons
- any fix where React Native test snapshots are not enough
- follow-up verification after applying a UI patch

Do not use it for pure CLI/Rust changes or mobile logic that has no visible UI impact.

## Preconditions

Work from a dedicated git worktree, not the `main` checkout. Preserve unrelated local changes.

Confirm the local machine can run iOS:

```bash
xcodebuild -version
xcrun simctl list devices available
```

If Xcode or Simulator is unavailable, say that iOS E2E is blocked and fall back to unit/type/lint checks.

## Baseline Checks

Before launching the simulator, run the cheap checks so obvious errors do not waste a simulator cycle:

```bash
cd mobile
pnpm typecheck
pnpm lint
pnpm test --watchAll=false
```

For narrow fixes, a focused Jest command is acceptable first, but run the broader checks before final sign-off.

## Start Or Reuse The Simulator

Prefer the currently booted device. If none is booted, start a modern iPhone simulator.

```bash
xcrun simctl list devices booted
open -a Simulator
xcrun simctl boot "iPhone 17 Pro" || true
xcrun simctl bootstatus booted
```

If that device name does not exist, pick the newest available iPhone from `xcrun simctl list devices available`.

## Build And Launch MultiSoul

Bundle identifier:

```text
com.yakami0129.multisoul
```

If the app is already installed and only JS changed, try launching the installed app first:

```bash
xcrun simctl launch booted com.yakami0129.multisoul
```

If launch fails, build/install from Expo:

```bash
cd mobile
pnpm ios
```

Keep long-running Metro/build sessions open until verification ends. If a port is occupied, inspect the existing process before killing anything.

## Navigate And Interact

Use the best available UI automation tool in the current agent environment:

- Codex desktop: use Computer Use to inspect the Simulator window, click, type, scroll, and capture app state.
- Shell-only fallback: use `xcrun simctl io booted screenshot` and `xcrun simctl openurl booted <url>` where possible.

For deep links, prefer the app scheme when a route is available:

```bash
xcrun simctl openurl booted "multisoul://"
```

For flows that need backend data, use a controlled local endpoint. Do not mutate `~/.config/msctl/*` unless the user explicitly asks; prefer test fixtures, existing seeded state, or a disposable dev server.

## Capture Evidence

Save screenshots under a stable artifact directory:

```bash
mkdir -p artifacts/ios-e2e
xcrun simctl io booted screenshot "artifacts/ios-e2e/<scenario>.png"
```

Inspect the screenshot before claiming success. Check at minimum:

- content matches the expected route and data
- text and icons are aligned on the same visual row
- labels are not clipped or overlapping
- safe area, status bar, header, and tab bar spacing look correct
- list rows preserve consistent heights and separators
- active/empty/loading/error states look intentional

When the user provided a reference image, compare against it directly and name any intentional differences.

## Debug Loop

If the simulator reveals a bug:

1. Record the failing screenshot path and a short observation.
2. Patch the smallest relevant code path.
3. Re-run typecheck/lint/focused tests.
4. Relaunch or refresh the app.
5. Capture a new screenshot and inspect it.

Do not mark the task complete after only editing code. The final iteration must include an inspected simulator screenshot or a clear reason why simulator verification was blocked.

## Final Report

Keep the final report concise:

- what scenario was tested
- device/simulator used
- pass/fail result
- key screenshot path using Markdown image syntax when useful:

```markdown
![iOS verification](/absolute/path/to/artifacts/ios-e2e/scenario.png)
```

- any remaining risks, such as a backend fixture not matching production data

If CI or local validation was also run, list the exact commands and results.
