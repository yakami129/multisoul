# Chat Input Enhanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ChatInputBar to match Pencil Enhanced Input design with integrated image preview, text input, and toolbar in a single card container.

**Architecture:** Move image preview UI from chat/[id].tsx into ChatInputBar component. Replace two-layer layout (container + inputSurface) with single card container holding three rows: conditional image preview, text input, and toolbar. Update all styles to match Pencil design spec (10px radius, #111111 background, #222222 border).

**Tech Stack:** React Native, TypeScript, Lucide icons, expo-image-manipulator

---

## File Structure

**Modified files:**
- `mobile/src/features/chat/components/ChatInputBar.tsx` — Add image preview row, update layout and styles
- `mobile/src/features/chat/components/ChatInputBar.test.tsx` — Add tests for image preview functionality
- `mobile/app/chat/[id].tsx` — Remove standalone image preview, pass pendingImages props
- `mobile/app/chat/styles.ts` — Remove image preview styles

**No new files created** — This is a refactor of existing components.

---

### Task 1: Update ChatInputBar Props Interface

**Files:**
- Modify: `mobile/src/features/chat/components/ChatInputBar.tsx:5-15`

- [ ] **Step 1: Add PendingImage interface and update Props**

Add after the existing imports:

```typescript
interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onPickImage: () => void;
  onOpenCommands: () => void;
  disabled: boolean;
  isAgentRunning: boolean;
  onStop: () => void;
  placeholder?: string;
  pendingImages: PendingImage[];
  onRemoveImage: (index: number) => void;
}
```

- [ ] **Step 2: Run typecheck to verify interface**

```bash
cd mobile && pnpm typecheck
```

Expected: Type errors in ChatInputBar.tsx (missing props in usage) and chat/[id].tsx (not passing new props yet). This is expected.

- [ ] **Step 3: Commit interface changes**

```bash
git add mobile/src/features/chat/components/ChatInputBar.tsx
git commit -m "feat(chat): add pendingImages props to ChatInputBar interface"
```

---

### Task 2: Add Image Preview Row to ChatInputBar

**Files:**
- Modify: `mobile/src/features/chat/components/ChatInputBar.tsx:1-4,17-120`

- [ ] **Step 1: Add missing imports**

Update imports at the top of the file:

```typescript
import { ArrowUp, ImagePlus, Mic, Square, Terminal, X } from 'lucide-react-native';
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
```

- [ ] **Step 2: Add image preview row before text input**

Replace the component's return statement (lines 33-119) with:

```typescript
export default function ChatInputBar({
  value,
  onChangeText,
  onSend,
  onPickImage,
  onOpenCommands,
  disabled,
  isAgentRunning,
  onStop,
  placeholder = 'Message Grok...',
  pendingImages,
  onRemoveImage,
}: Props) {
  const hasText = value.trim().length > 0;
  const handleVoicePress = () => Alert.alert('语音功能即将上线，敬请期待');
  const charCount = `${value.length} / 4096`;
  const actionDisabled = disabled && !isAgentRunning;

  return (
    <View style={s.card}>
      {pendingImages.length > 0 && (
        <ScrollView
          testID="img-preview-row"
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.imgStrip}
          contentContainerStyle={s.imgStripContent}
        >
          {pendingImages.map((img, idx) => (
            <View key={img.localUri} style={s.thumbWrapper}>
              <Image source={{ uri: img.localUri }} style={s.thumb} />
              {img.status === 'uploading' && (
                <View style={s.thumbOverlay}>
                  <Text style={s.thumbOverlayText}>...</Text>
                </View>
              )}
              {img.status === 'failed' && (
                <View style={[s.thumbOverlay, s.thumbFailed]}>
                  <Text style={s.thumbOverlayText}>!</Text>
                </View>
              )}
              <Pressable
                testID={`remove-img-${idx}`}
                style={s.removeBadge}
                onPress={() => onRemoveImage(idx)}
                accessibilityLabel="Remove image"
                accessibilityRole="button"
              >
                <X size={8} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={s.textRow}>
        <TextInput
          testID="message-input"
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor="#3A3A3A"
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          maxLength={4096}
          returnKeyType="default"
          scrollEnabled
        />
        {isAgentRunning ? (
          <TouchableOpacity
            testID="stop-btn"
            accessibilityLabel="Stop conversation"
            accessibilityRole="button"
            onPress={onStop}
            style={[s.actionBtn, s.stopBtn]}
          >
            <Square size={14} color="#FF4444" />
          </TouchableOpacity>
        ) : hasText ? (
          <TouchableOpacity
            testID="send-btn"
            accessibilityLabel="Send message"
            accessibilityRole="button"
            accessibilityState={{ disabled: actionDisabled }}
            onPress={onSend}
            disabled={actionDisabled}
            style={[s.actionBtn, s.sendBtn, actionDisabled && s.toolBtnDisabled]}
          >
            <ArrowUp size={18} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="mic-btn"
            accessibilityLabel="Voice input (coming soon)"
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={s.actionBtn}
          >
            <Mic size={17} color="#666666" />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.toolbar}>
        <View style={s.toolbarLeft}>
          <TouchableOpacity
            testID="attach-btn"
            accessibilityLabel="Attach image"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onPickImage}
            disabled={disabled}
            style={[s.toolBtn, disabled && s.toolBtnDisabled]}
          >
            <ImagePlus size={22} color={disabled ? '#555555' : '#888888'} />
          </TouchableOpacity>

          <TouchableOpacity
            testID="command-btn"
            accessibilityLabel="Open commands"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onOpenCommands}
            disabled={disabled}
            style={[s.commandPill, disabled && s.toolBtnDisabled]}
          >
            <Terminal size={14} color={disabled ? '#555555' : '#FF6B35'} />
            <Text style={[s.commandPillText, disabled && s.disabledText]}>Commands</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.charCount}>{charCount}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: Still type errors in chat/[id].tsx (not passing new props yet), but ChatInputBar.tsx should have no errors.

- [ ] **Step 4: Commit component structure changes**

```bash
git add mobile/src/features/chat/components/ChatInputBar.tsx
git commit -m "feat(chat): add image preview row to ChatInputBar"
```

---

### Task 3: Update ChatInputBar Styles

**Files:**
- Modify: `mobile/src/features/chat/components/ChatInputBar.tsx:122-216`

- [ ] **Step 1: Replace all styles with new design**

Replace the entire `StyleSheet.create` block (lines 122-215) with:

```typescript
const s = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222222',
    padding: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  imgStrip: {
    maxHeight: 68,
  },
  imgStripContent: {
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbWrapper: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  thumb: {
    width: 52,
    height: 52,
  },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFailed: {
    backgroundColor: '#FF444499',
  },
  thumbOverlayText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#000000CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textRow: {
    minHeight: 40,
    maxHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 24,
    maxHeight: 98,
    padding: 0,
    margin: 0,
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  toolBtnDisabled: { opacity: 0.4 },
  commandPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B3588',
    backgroundColor: '#1A1A1A',
  },
  commandPillText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B35',
  },
  disabledText: { color: '#555555' },
  charCount: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#333333',
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: '#FF6B35' },
  stopBtn: { backgroundColor: '#252525', borderWidth: 1, borderColor: '#FF4444' },
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: Still type errors in chat/[id].tsx (not passing new props yet), but ChatInputBar.tsx should have no errors.

- [ ] **Step 3: Commit style changes**

```bash
git add mobile/src/features/chat/components/ChatInputBar.tsx
git commit -m "style(chat): update ChatInputBar styles to match Pencil design"
```

---

### Task 4: Update Parent Component (chat/[id].tsx)

**Files:**
- Modify: `mobile/app/chat/[id].tsx:429-485`

- [ ] **Step 1: Remove standalone image preview ScrollView**

Delete lines 429-459 (the entire `{pendingImages.length > 0 && ...}` block before `<ChatInputBar`).

- [ ] **Step 2: Add new props to ChatInputBar**

Update the ChatInputBar component call (around line 460, now line 430 after deletion):

```typescript
<ChatInputBar
  value={input}
  onChangeText={handleInputChange}
  onSend={() => {
    void handleSend();
  }}
  onPickImage={() => {
    void pickImage();
  }}
  onOpenCommands={() => setCommandPopupVisible(true)}
  disabled={composerDisabled}
  isAgentRunning={isAgentRunning}
  onStop={() => {
    if (endpoint) {
      void abortConversation(endpoint.base_url, endpoint.token, conv_id)
        .then(() => {
          setIsAwaitingResponse(false);
        })
        .catch((e: unknown) => {
          recordDiagnosticsEvent('warn', 'chat.abort', 'abort request failed', {
            conv_id,
            endpoint_id,
            error: e,
          });
        });
    }
  }}
  pendingImages={pendingImages}
  onRemoveImage={(idx) => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
/>
```

- [ ] **Step 3: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: No type errors. All props are now correctly passed.

- [ ] **Step 4: Commit parent component changes**

```bash
git add mobile/app/chat/[id].tsx
git commit -m "refactor(chat): integrate image preview into ChatInputBar"
```

---

### Task 5: Clean Up Unused Styles

**Files:**
- Modify: `mobile/app/chat/styles.ts:37-68`

- [ ] **Step 1: Remove image preview styles**

Delete the following style definitions from the StyleSheet.create block:

```typescript
  previewRow: { backgroundColor: '#111111', maxHeight: 88 },
  previewRowContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbWrapper: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: { width: 64, height: 64 },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFailed: { backgroundColor: '#FF444499' },
  thumbOverlayText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000000CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: No errors. Styles are no longer referenced.

- [ ] **Step 3: Commit style cleanup**

```bash
git add mobile/app/chat/styles.ts
git commit -m "chore(chat): remove unused image preview styles"
```

---

### Task 6: Add Tests for Image Preview in ChatInputBar

**Files:**
- Modify: `mobile/src/features/chat/components/ChatInputBar.test.tsx`

- [ ] **Step 1: Add test for image preview row visibility**

Add after existing tests:

```typescript
describe('Image Preview', () => {
  it('should not render image preview row when pendingImages is empty', () => {
    const { queryByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onPickImage={jest.fn()}
        onOpenCommands={jest.fn()}
        disabled={false}
        isAgentRunning={false}
        onStop={jest.fn()}
        pendingImages={[]}
        onRemoveImage={jest.fn()}
      />,
    );

    expect(queryByTestId('img-preview-row')).toBeNull();
  });

  it('should render image preview row when pendingImages has items', () => {
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
      { localUri: 'file:///test2.jpg', fileId: null, status: 'uploading' as const },
    ];

    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onPickImage={jest.fn()}
        onOpenCommands={jest.fn()}
        disabled={false}
        isAgentRunning={false}
        onStop={jest.fn()}
        pendingImages={pendingImages}
        onRemoveImage={jest.fn()}
      />,
    );

    expect(getByTestId('img-preview-row')).toBeTruthy();
  });

  it('should call onRemoveImage when remove button is pressed', () => {
    const onRemoveImage = jest.fn();
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
    ];

    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onPickImage={jest.fn()}
        onOpenCommands={jest.fn()}
        disabled={false}
        isAgentRunning={false}
        onStop={jest.fn()}
        pendingImages={pendingImages}
        onRemoveImage={onRemoveImage}
      />,
    );

    fireEvent.press(getByTestId('remove-img-0'));
    expect(onRemoveImage).toHaveBeenCalledWith(0);
  });

  it('should show uploading overlay for uploading images', () => {
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: null, status: 'uploading' as const },
    ];

    const { getByText } = render(
      <ChatInputBar
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onPickImage={jest.fn()}
        onOpenCommands={jest.fn()}
        disabled={false}
        isAgentRunning={false}
        onStop={jest.fn()}
        pendingImages={pendingImages}
        onRemoveImage={jest.fn()}
      />,
    );

    expect(getByText('...')).toBeTruthy();
  });

  it('should show failed overlay for failed images', () => {
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: null, status: 'failed' as const },
    ];

    const { getByText } = render(
      <ChatInputBar
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onPickImage={jest.fn()}
        onOpenCommands={jest.fn()}
        disabled={false}
        isAgentRunning={false}
        onStop={jest.fn()}
        pendingImages={pendingImages}
        onRemoveImage={jest.fn()}
      />,
    );

    expect(getByText('!')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd mobile && pnpm test ChatInputBar.test.tsx --watchAll=false
```

Expected: All tests pass.

- [ ] **Step 3: Commit test additions**

```bash
git add mobile/src/features/chat/components/ChatInputBar.test.tsx
git commit -m "test(chat): add image preview tests for ChatInputBar"
```

---

### Task 7: Run Full Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run full typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: No type errors across the entire mobile codebase.

- [ ] **Step 2: Run all tests**

```bash
cd mobile && pnpm test --watchAll=false
```

Expected: All tests pass. Some snapshot tests may need updating due to visual changes.

- [ ] **Step 3: Update snapshots if needed**

If snapshot tests fail with visual changes only:

```bash
cd mobile && pnpm test --watchAll=false -u
```

Then review the snapshot diffs to ensure they match the expected design changes.

- [ ] **Step 4: Commit snapshot updates (if any)**

```bash
git add mobile/src/**/__snapshots__
git commit -m "test(chat): update snapshots for ChatInputBar redesign"
```

- [ ] **Step 5: Visual verification checklist**

Run the app on iOS/Android simulator and verify:

- [ ] Image preview row appears when images are selected
- [ ] Thumbnails are 52×52px with 8px rounded corners
- [ ] Delete button (X icon) appears on top-right of each thumbnail
- [ ] Uploading images show "..." overlay
- [ ] Failed images show "!" overlay
- [ ] Card container has 10px rounded corners
- [ ] Card background is #111111 with #222222 border
- [ ] Text input placeholder color is #3A3A3A
- [ ] No visual regressions in toolbar or action buttons

---

## Spec Coverage Review

**Spec requirements implemented:**

1. ✅ Single card container with three-row layout (Task 2, 3)
2. ✅ Image preview row with horizontal scroll (Task 2)
3. ✅ Thumbnails 52×52px, rounded 8px, border #2A2A2A (Task 3)
4. ✅ Delete button 16×16px with X icon (Task 2, 3)
5. ✅ Upload status overlays (uploading "...", failed "!") (Task 2, 3)
6. ✅ Text input row with updated styles (Task 2, 3)
7. ✅ Toolbar row with updated layout (Task 2, 3)
8. ✅ Container styles: 10px radius, #111111 bg, #222222 border (Task 3)
9. ✅ Props interface with pendingImages and onRemoveImage (Task 1)
10. ✅ Parent component integration (Task 4)
11. ✅ Cleanup unused styles (Task 5)
12. ✅ Test coverage for image preview (Task 6)

**No gaps identified.** All spec requirements are covered by the implementation tasks.
