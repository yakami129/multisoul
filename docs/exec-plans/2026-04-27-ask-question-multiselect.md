# AskUserQuestion Multi-Select Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support `multiSelect: true` on a single question in `AskUserQuestion`, so mobile users can pick multiple options for one question and the answer is correctly sent back to Claude Code.

**Architecture:** The fix spans 5 layers: (1) CLI serialization preserves the `multiSelect` flag, (2) mobile TypeScript types declare it, (3) `MessageBubble` routing checks it, (4) `AskQuestionCard` gains a checkbox multi-select mode, (5) the CLI answer deserializer accepts `Vec<String>` per question. The `sendAnswerMulti` WebSocket path is already wired up — we repurpose it to carry single-question multi-select answers with the encoding `{ "0": "optId1,optId2" }` (comma-joined option ids), which the CLI then splits when building `updatedInput`.

**Tech Stack:** Rust (serde_json, existing interactive.rs), TypeScript / React Native (existing AskQuestionCard, MessageBubble, useWebSocket)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `cli/src/serve/interactive.rs` | Preserve `multiSelect` in serialized payload; split comma-joined ids in `build_updated_input` |
| Modify | `mobile/src/types.ts` | Add `multiSelect?: boolean` to question item in `AskQuestionPayload` |
| Modify | `mobile/src/features/chat/components/AskQuestionCard.tsx` | Add checkbox multi-select mode behind `multiSelect` prop |
| Modify | `mobile/src/features/chat/components/MessageBubble.tsx` | Route single-question multi-select to `sendAnswerMulti` path |
| Modify | `mobile/src/features/chat/types.ts` | Re-export updated `AskQuestionPayload` (no new code, just ensure alias is correct) |

---

## Task 1: CLI — preserve `multiSelect` in serialized question payload

**Files:**
- Modify: `cli/src/serve/interactive.rs:56-64`

The current code strips `multiSelect` when building the `ask_question` WS message. We add it back.

- [ ] **Step 1: Locate the existing build code**

Open `cli/src/serve/interactive.rs`. Find the inner `map` at line ~57 that builds each question object:

```rust
serde_json::json!({ "id": qi.to_string(), "text": text, "options": options })
```

- [ ] **Step 2: Add `multiSelect` to the serialized question**

Replace that line with:

```rust
let multi = q.get("multiSelect").and_then(|v| v.as_bool()).unwrap_or(false);
serde_json::json!({
    "id":          qi.to_string(),
    "text":        text,
    "options":     options,
    "multi_select": multi,
})
```

> Note: we use `multi_select` (snake_case) on the wire to mobile to stay consistent with the existing JSON field naming convention in this codebase (all other payload fields are snake_case).

- [ ] **Step 3: Update `build_updated_input` to handle comma-joined multi-select answers**

In `build_updated_input`, the `choice_ids` branch currently maps `questionIdx → single optionIdx`. We need it to also handle a comma-joined list like `"0,2"` which means "option 0 and option 2 were selected".

Replace the existing `choice_ids` branch (lines ~96–115):

```rust
if let Some(choice_ids) = &answer.choice_ids {
    let mut indices: Vec<usize> = choice_ids.keys()
        .filter_map(|k| k.parse::<usize>().ok())
        .collect();
    indices.sort_unstable();
    for qi in indices {
        let opt_id_str = match choice_ids.get(&qi.to_string()) {
            Some(s) => s.as_str(),
            None    => continue,
        };
        // opt_id_str may be comma-joined for multi-select, e.g. "0,2"
        let parts: Vec<&str> = opt_id_str.split(',').map(str::trim).collect();
        if parts.len() == 1 {
            // Single selection — resolve to label as before
            let label = if let Ok(oi) = parts[0].parse::<usize>() {
                original_args["questions"][qi]["options"][oi]["label"]
                    .as_str()
                    .unwrap_or(parts[0])
                    .to_string()
            } else {
                parts[0].to_string()
            };
            answers.insert(qi.to_string(), serde_json::Value::String(label));
        } else {
            // Multi-selection — collect comma-joined labels
            let labels: Vec<String> = parts.iter().filter_map(|p| {
                p.parse::<usize>().ok().map(|oi| {
                    original_args["questions"][qi]["options"][oi]["label"]
                        .as_str()
                        .unwrap_or(p)
                        .to_string()
                })
            }).collect();
            answers.insert(qi.to_string(), serde_json::Value::String(labels.join(", ")));
        }
    }
}
```

- [ ] **Step 4: Build the CLI to verify it compiles**

```bash
cd cli && cargo build 2>&1
```

Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
cd cli
git add src/serve/interactive.rs
git commit -m "feat(cli): preserve multiSelect flag and handle comma-joined multi-select answers"
```

---

## Task 2: Mobile — add `multiSelect` to TypeScript types

**Files:**
- Modify: `mobile/src/types.ts:82-87`

- [ ] **Step 1: Add `multi_select` to the question item interface**

In `mobile/src/types.ts`, find the `AskQuestionPayload` interface:

```ts
export interface AskQuestionPayload {
  ask_id: string;
  questions: Array<{
    id: string;
    text: string;
    options: { id: string; label: string }[];
  }>;
  allow_freeform: boolean;
}
```

Replace with:

```ts
export interface AskQuestionPayload {
  ask_id: string;
  questions: Array<{
    id: string;
    text: string;
    options: { id: string; label: string }[];
    multi_select?: boolean;
  }>;
  allow_freeform: boolean;
}
```

- [ ] **Step 2: Run TypeScript type-check**

```bash
cd mobile && pnpm typecheck 2>&1
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd mobile
git add src/types.ts
git commit -m "feat(mobile/types): add multi_select field to AskQuestionPayload question item"
```

---

## Task 3: Mobile — add multi-select mode to `AskQuestionCard`

**Files:**
- Modify: `mobile/src/features/chat/components/AskQuestionCard.tsx`

The card currently tracks `selectedId: string | null`. We add a `multiSelect` prop; when true, state becomes `Set<string>`, the radio dot becomes a checkbox square, and `onConfirm` passes all selected ids joined by comma.

- [ ] **Step 1: Update Props interface and state**

Replace the entire `AskQuestionCard.tsx` with the following (preserves all existing styles, adds checkbox behavior):

```tsx
import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { type AskQuestionOption } from '../types';

interface Props {
  question: string;
  subtitle?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
  onCancel: () => void;
  onConfirm: (selectedId: string) => void;
}

export default function AskQuestionCard({
  question,
  subtitle,
  options,
  multiSelect = false,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(false);

  const isReady = multiSelect ? selectedIds.size > 0 : selectedId !== null;

  const handleToggle = (id: string) => {
    if (answered) return;
    if (multiSelect) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    } else {
      setSelectedId(id);
    }
  };

  const handleConfirm = () => {
    if (!isReady || answered) return;
    setAnswered(true);
    if (multiSelect) {
      onConfirm(Array.from(selectedIds).join(','));
    } else {
      onConfirm(selectedId!);
    }
  };

  const handleCancel = () => {
    if (answered) return;
    setAnswered(true);
    onCancel();
  };

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Bot size={16} color="#20C20E" />
          <Text style={s.headerLabel}>{answered ? 'ANSWERED' : 'AGENT IS ASKING'}</Text>
        </View>
        <Info size={16} color="#2D8B2D" />
      </View>

      {/* Body */}
      <View style={s.body}>
        <Text style={s.question}>{question}</Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        {multiSelect && (
          <Text style={s.hint}>Select one or more</Text>
        )}

        {/* Options */}
        <View style={s.optsList}>
          {options.map((opt, index) => {
            const selected = multiSelect ? selectedIds.has(opt.id) : selectedId === opt.id;
            return (
              <TouchableOpacity
                key={`${opt.id}-${index}`}
                style={[s.option, selected && s.optionSelected, answered && s.optionReadonly]}
                onPress={() => handleToggle(opt.id)}
                activeOpacity={answered ? 1 : 0.7}
              >
                {multiSelect ? (
                  <View style={[s.checkbox, selected && s.checkboxSelected]}>
                    {selected && <View style={s.checkboxTick} />}
                  </View>
                ) : (
                  <View style={[s.radio, selected && s.radioSelected]} />
                )}
                <Text style={[s.optionLabel, answered && !selected && s.optionLabelMuted]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Actions — hidden after answer submitted */}
        {!answered && (
          <View style={s.actions}>
            <TouchableOpacity style={s.cancelBtn} onPress={handleCancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, !isReady && s.confirmBtnDisabled]}
              onPress={handleConfirm}
            >
              <Text style={s.confirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#061206',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    width: 320,
    overflow: 'hidden',
  },
  header: {
    height: 44,
    backgroundColor: '#0A1A0A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 1.5,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  question: {
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    color: '#20C20E',
    lineHeight: 21,
  },
  subtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#147A16',
  },
  hint: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#0F6B0F',
    letterSpacing: 0.5,
  },
  optsList: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 6,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 14,
    gap: 12,
  },
  optionSelected: {
    backgroundColor: '#0F2B0F',
    borderColor: '#33FF33',
  },
  optionReadonly: {
    opacity: 0.6,
  },
  optionLabelMuted: {
    color: '#2D8B2D',
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#2D8B2D',
  },
  radioSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#33FF33',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#2D8B2D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#33FF33',
  },
  checkboxTick: {
    width: 8,
    height: 8,
    backgroundColor: '#040D04',
    borderRadius: 1,
  },
  optionLabel: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  cancelBtn: {
    flex: 1,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 1,
  },
  confirmBtn: {
    flex: 1,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: '#040D04',
    letterSpacing: 1,
  },
});
```

- [ ] **Step 2: Run TypeScript type-check**

```bash
cd mobile && pnpm typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd mobile
git add src/features/chat/components/AskQuestionCard.tsx
git commit -m "feat(mobile): add multiSelect checkbox mode to AskQuestionCard"
```

---

## Task 4: Mobile — update `MessageBubble` routing for single-question multi-select

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx:149-163`

Currently the single-question branch always uses `onAnswer` (sends one `choice_id`). When `multi_select` is true we must instead call `onAnswerMulti` with `{ "0": "id1,id2" }`.

- [ ] **Step 1: Update the single-question `ask_question` case**

Find the `case 'ask_question':` block (around line 149). Replace the entire case:

```tsx
case 'ask_question': {
  const p = msg.payload as AskQuestionPayload;
  if (p.questions.length === 1) {
    const q = p.questions[0];
    if (q.multi_select) {
      return (
        <View style={s.aiWrap}>
          <AskQuestionCard
            question={q.text}
            options={q.options}
            multiSelect
            onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
            onConfirm={(ids) => onAnswerMulti?.(p.ask_id, { '0': ids })}
          />
        </View>
      );
    }
    return (
      <View style={s.aiWrap}>
        <AskQuestionCard
          question={q.text}
          options={q.options}
          onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
          onConfirm={(id) => onAnswer?.(p.ask_id, id)}
        />
      </View>
    );
  }
  return (
    <View style={s.aiWrap}>
      <MultiAskQuestionCard
        questions={p.questions}
        onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
        onConfirm={(answers) => onAnswerMulti?.(p.ask_id, answers)}
      />
    </View>
  );
}
```

- [ ] **Step 2: Run TypeScript type-check**

```bash
cd mobile && pnpm typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 3: Run existing tests**

```bash
cd mobile && pnpm test -- --watchAll=false 2>&1
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add src/features/chat/components/MessageBubble.tsx
git commit -m "feat(mobile): route single-question multiSelect to sendAnswerMulti path"
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Build CLI**

```bash
cd cli && cargo build 2>&1
```

Expected: `Finished` with no errors.

- [ ] **Step 2: Full mobile typecheck + tests**

```bash
cd mobile && pnpm typecheck && pnpm test -- --watchAll=false 2>&1
```

Expected: no type errors, all tests pass.

- [ ] **Step 3: Manual smoke test**

Start the CLI serve daemon and send an `AskUserQuestion` with `multiSelect: true` from Claude Code. Verify:
- Mobile card shows checkboxes (squares) instead of radio buttons
- Multiple options can be toggled
- Confirm button becomes active after selecting ≥1 option
- After confirm, CLI logs show the answer arriving as `choice_ids: { "0": "optLabel1, optLabel2" }`

---

## Self-Review Checklist

**Spec coverage:**
- [x] CLI preserves `multiSelect` → Task 1 Step 2
- [x] Mobile type updated → Task 2
- [x] UI supports checkbox mode → Task 3
- [x] Routing detects `multi_select` → Task 4
- [x] Backend answer deserialization handles comma-joined → Task 1 Step 3

**Placeholder scan:** None found — all steps contain actual code.

**Type consistency:**
- `AskQuestionPayload.questions[].multi_select` (snake_case) used consistently across `types.ts`, `interactive.rs` JSON output, and `MessageBubble.tsx` access (`q.multi_select`).
- `onConfirm: (selectedId: string) => void` signature unchanged — multi-select passes comma-joined string, keeping prop interface stable.
- `choice_ids: Record<string, string>` wire format unchanged — we pass `{ "0": "id1,id2" }` which fits existing type.
