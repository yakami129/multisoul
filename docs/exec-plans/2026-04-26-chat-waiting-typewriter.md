# Chat Waiting And Typewriter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add waiting feedback and hacker-style typewriter rendering to the mobile chat screen.

**Architecture:** Keep behavior local to `ChatScreen.tsx` by deriving pending state from sends and incoming assistant messages. Render a synthetic waiting row only while awaiting the first assistant response, and apply a timer-driven typewriter display to the latest assistant reply.

**Tech Stack:** React Native, React 19 hooks, Jest, `@testing-library/react-native`.

---

### Task 1: Component Tests

**Files:**
- Modify: `mobile/src/features/chat/components/ChatScreen.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests using fake timers to verify pending UI, disabled input, pending removal, and typewriter reveal.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --dir mobile test -- ChatScreen.test.tsx --runInBand`
Expected: FAIL because `ACCESSING NEURAL LINK` and partial typewriter output are not implemented.

### Task 2: ChatScreen Behavior

**Files:**
- Modify: `mobile/src/features/chat/components/ChatScreen.tsx`

- [ ] **Step 1: Implement local pending state**

Set awaiting state after a successful send and render a synthetic assistant waiting bubble while awaiting.

- [ ] **Step 2: Implement typewriter reveal**

Track the active assistant message id and visible character count. Increment visible count on a short interval until the latest response text is complete.

- [ ] **Step 3: Style pending and disabled states**

Use terminal-green colors, dashed borders, uppercase status text, and disabled input styles consistent with the existing hacker aesthetic.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --dir mobile test -- ChatScreen.test.tsx --runInBand`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --dir mobile typecheck`
Expected: PASS.
