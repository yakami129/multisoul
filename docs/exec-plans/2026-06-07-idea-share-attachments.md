# Implementation Plan: Idea 快速采集与附件支持

**Spec**: `docs/product-specs/2026-06-07-SPEC-idea-share-attachments.md`  
**Date**: 2026-06-07  
**Conversation**: 67aaadcd-b710-4d3e-a896-82ded7d0a085

---

## Overview

Implement iOS Share Extension for quick Idea capture, simplify IdeaEditorSheet attachments (remove Link/Log buttons, keep Image only), add image upload support, and implement Done → Ideas list navigation.

---

## Tasks

### Task 1: Simplify IdeaEditorSheet Attachments UI

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `mobile/src/features/specs/components/SpecsHomeScreen.tsx`
- `mobile/src/features/specs/components/SpecsHomeRows.tsx`

**Changes**:
1. Remove "Add Link" and "Add Log Snippet" buttons from IdeaEditorSheet
2. Keep only "Add Screenshot" button (rename to "Add Image")
3. Update `AttachmentPreset` type to only include `'image'`
4. Update CaptureRow mini actions: remove Link and Log, keep Text and Image
5. Update attachment list UI to show image thumbnails (48×48 rounded) for image attachments
6. Add swipe-to-delete for attachment rows

**Acceptance**:
- IdeaEditorSheet shows only "Add Image" button in Attachments section
- Specs Home CaptureRow shows only Text and Image mini actions
- Attachment list displays placeholder for images (actual upload in Task 3)
- Swipe-to-delete works on attachment rows

---

### Task 2: Add Image Picker Support

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `mobile/package.json` (verify expo-image-picker is installed)

**Changes**:
1. Install/verify `expo-image-picker` dependency
2. Add image picker logic to "Add Image" button:
   - Show ActionSheet: "Choose from Library" / "Take Photo" / "Cancel"
   - Request camera/media library permissions
   - Handle image selection and store in attachments with local URI
3. Update attachment row to show image thumbnail when `uri` is local file path
4. Add attachment status field: `'pending' | 'uploading' | 'done' | 'error'`
5. Display spinner for `uploading`, error icon + retry button for `error`

**Acceptance**:
- Tapping "Add Image" shows ActionSheet
- Selecting image from library adds attachment with thumbnail
- Taking photo adds attachment with thumbnail
- Attachment row shows correct status indicators

---

### Task 3: Implement Image Upload API

**Files**:
- `mobile/src/features/specs/services/specRepository.ts`
- `mobile/src/api.ts` (or create `mobile/src/features/specs/api/uploadApi.ts`)

**Changes**:
1. Create `uploadIdeaImage(imageUri: string): Promise<{ fileId: string }>` function
2. Compress image to ≤2MB JPEG using `expo-image-manipulator` (quality 0.8)
3. Use `FormData` to POST to `/api/v1/uploads`
4. Return `file_id` from server response
5. Handle 413 (too large), 415 (unsupported type), and network errors

**Acceptance**:
- Function compresses and uploads image to existing `/api/v1/uploads` endpoint
- Returns `file_id` on success
- Throws descriptive errors on failure (413, 415, network)

---

### Task 4: Integrate Upload into IdeaEditorSheet

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `mobile/src/features/specs/types.ts`

**Changes**:
1. Update `SpecIdeaAttachment` to add `status?: 'pending' | 'uploading' | 'done' | 'error'`
2. When image is selected, add attachment with status `'pending'` and local `uri`
3. Trigger upload immediately after adding attachment:
   - Set status to `'uploading'`
   - Call `uploadIdeaImage(uri)`
   - On success: set status to `'done'`, update `fileId` and `uri` to server path
   - On error: set status to `'error'`, store error message
4. Add "Retry" button for failed uploads
5. On "Done", validate all attachments are uploaded (status `'done'` or not image attachments)
6. If pending/uploading/error attachments exist, show Alert: "Some attachments failed. Continue anyway?"

**Acceptance**:
- Image attachments auto-upload after selection
- Upload progress shows spinner
- Failed uploads show error + retry button
- Done button validates upload status and prompts user if needed
- Successfully uploaded attachments include `fileId`

---

### Task 5: Update Specs Repository to Support Attachments

**Files**:
- `mobile/src/features/specs/services/specRepository.ts`
- `mobile/src/features/specs/types.ts`

**Changes**:
1. Update `CreateSpecIdeaInput` to accept `attachments` array
2. Update `createSpecIdea` function to include `attachments` in request body
3. Ensure attachments with `fileId` are properly serialized
4. Update local SQLite schema if needed (verify attachments column exists)

**Acceptance**:
- `createSpecIdea` sends attachments array in POST body
- Server receives and stores attachments correctly
- Created Idea includes attachments in response

---

### Task 6: Add Done → Ideas List Navigation

**Files**:
- `mobile/src/features/specs/components/SpecsHomeScreen.tsx`
- `mobile/app/(tabs)/specs/index.tsx` (Specs tab root route)

**Changes**:
1. Update `IdeaEditorSheet.onSave` callback to:
   - Call `onCreateIdea(value)` to save the Idea
   - Switch segment to `'ideas'` after save completes
   - Scroll to top of Ideas list (if possible)
2. If `onCreateIdea` is async, wait for it to complete before switching segment
3. Update SpecsHomeScreen to expose `setSegment` or add `afterCreate?: () => void` callback

**Acceptance**:
- After clicking Done and saving Idea, user sees Ideas list (segment switches to "ideas")
- Newly created Idea appears at top of Open Ideas list
- No manual navigation required

---

### Task 7: iOS Share Extension Setup (Part 1: Extension Target)

**Files**:
- `mobile/ios/` (Xcode project)
- `mobile/ios/MultiSoulShareExtension/` (new directory)
- `mobile/ios/MultiSoulShareExtension/Info.plist`
- `mobile/ios/MultiSoulShareExtension/ShareViewController.swift`

**Changes**:
1. Create Share Extension target in Xcode
2. Configure `Info.plist` to accept:
   - `NSExtensionActivationSupportsImageWithMaxCount = 1`
   - `NSExtensionActivationSupportsWebURLWithMaxCount = 1`
3. Implement `ShareViewController`:
   - Extract first image attachment → compress → save to shared container
   - Extract URL attachment → validate http(s) scheme
   - Build URL scheme: `multisoul://new-idea?type=image&path=...` or `type=link&url=...`
   - Open main app with URL using `openURL`
4. Add App Groups entitlement to both main app and Share Extension
5. Test Share Extension appears in iOS Share Sheet

**Acceptance**:
- Share Extension appears in iOS Share Sheet for images and URLs
- Selecting MultiSoul from Share Sheet opens main app
- Main app receives URL scheme with correct parameters

---

### Task 8: iOS Share Extension Setup (Part 2: Main App URL Handling)

**Files**:
- `mobile/app.json` (add URL scheme)
- `mobile/app/(tabs)/specs/index.tsx` or `mobile/app/_layout.tsx`
- `mobile/src/features/specs/components/SpecsHomeScreen.tsx`

**Changes**:
1. Add `multisoul://` URL scheme to `app.json`
2. Implement URL handling in Specs tab or root layout:
   - Parse `multisoul://new-idea?type=image&path=...&url=...`
   - If `type=image`, read image from shared container path
   - If `type=link`, use URL parameter
   - Open IdeaEditorSheet with pre-filled attachment
3. Handle app already running vs. cold start scenarios
4. Clear shared container file after reading

**Acceptance**:
- Sharing image from Photos → MultiSoul opens New Idea with image attachment
- Sharing URL from Safari → MultiSoul opens New Idea with link attachment
- Works for both cold start and app already running
- Shared container is cleaned up after use

---

### Task 9: Add URL Validation for Link Attachments

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `mobile/src/features/specs/utils/urlValidation.ts` (new file)

**Changes**:
1. Create `isValidHttpUrl(url: string): boolean` function
   - Check if URL starts with `http://` or `https://`
   - Return false for other schemes (file://, javascript:, etc.)
2. When receiving link attachment from Share Extension, validate URL
3. If invalid, show Alert: "Invalid URL. Only http(s) links are supported."
4. Filter out invalid URLs before adding to attachments

**Acceptance**:
- Only http(s) URLs are accepted
- Invalid URLs (javascript:, file:, etc.) show error alert
- Invalid URLs are not added to attachments

---

### Task 10: Display Attachment Details in Idea Detail Screen

**Files**:
- `mobile/src/features/specs/components/IdeaDetailScreen.tsx`

**Changes**:
1. Update Idea detail screen to display attachments section
2. For image attachments:
   - Show thumbnail, tap to open full-screen image viewer
   - Use `expo-image` or `react-native-image-viewing` for full-screen
3. For link attachments:
   - Show link icon + host name
   - Tap to open URL with `Linking.openURL`
4. Style attachments section consistent with design system

**Acceptance**:
- Idea detail shows all attachments
- Tapping image opens full-screen viewer
- Tapping link opens in Safari
- Attachment section follows design.md guidelines

---

### Task 11: Handle Offline and Upload Errors

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `mobile/src/features/specs/services/specRepository.ts`

**Changes**:
1. Add retry logic for failed uploads:
   - Store failed attachment locally
   - Show "Upload failed" with Retry button
   - Retry button re-triggers upload
2. Handle offline scenario:
   - Detect no network connection
   - Show "No connection. Will upload when online."
   - Store attachment as pending
   - Implement background upload on reconnect (future enhancement: mark as out-of-scope for V1)
3. Handle >2MB images:
   - If compression to 0.8 quality still >2MB, try 0.6, then 0.4
   - If still >2MB, show error: "Image too large. Please choose a smaller image."

**Acceptance**:
- Failed uploads show error + retry button
- Retry successfully re-uploads failed attachment
- Offline state shows appropriate message
- >2MB images show clear error message after compression attempts

---

### Task 12: Update Tests

**Files**:
- `mobile/src/features/specs/components/IdeaEditorSheet.test.tsx`
- `mobile/src/features/specs/components/SpecsHomeScreen.test.tsx`
- `mobile/src/features/specs/services/specRepository.test.ts`

**Changes**:
1. Update IdeaEditorSheet tests:
   - Remove Link/Log button tests
   - Add Image picker tests (mock expo-image-picker)
   - Add upload flow tests (pending → uploading → done/error)
   - Add retry button tests
2. Update SpecsHomeScreen tests:
   - Remove Link/Log mini action tests
   - Update segment switching tests for Done → Ideas flow
3. Add upload API tests:
   - Test compression logic
   - Test FormData construction
   - Test error handling (413, 415, network)

**Acceptance**:
- All updated tests pass
- `pnpm test -- --watchAll=false` succeeds
- Coverage maintained or improved

---

### Task 13: Update UI Checklist & Design Compliance

**Files**:
- `mobile/docs/design.md` (reference only)
- All modified components

**Changes**:
1. Verify all colors use design.md palette:
   - Accent: `#FF6B35` for action buttons
   - Success: `#4CAF50` for uploaded state
   - Error: `#DC2626` for failed uploads (add to palette if missing)
2. Verify spacing on 4px grid
3. Verify text styles (Inter font, correct sizes)
4. Run `scripts/check-mobile-colors.sh` to ensure compliance
5. Check `mobile/docs/rules/ui-pitfalls.md` for common issues

**Acceptance**:
- `scripts/check-mobile-colors.sh` passes
- All spacing follows 4px grid
- Typography matches design.md
- No UI pitfalls detected

---

### Task 14: Verification & Integration Testing

**Changes**:
1. Run full verification suite:
   - `cd mobile && pnpm typecheck`
   - `cd mobile && pnpm test -- --watchAll=false`
   - `cd cli && cargo test`
   - `cd cli && cargo build`
2. Manual testing on iOS device:
   - Share image from Photos → MultiSoul → Save → See in Ideas list
   - Share URL from Safari → MultiSoul → Save → See in Ideas list
   - App internal: Tap Image mini action → Pick photo → See thumbnail → Done → Ideas list
   - Test offline upload failure + retry
   - Test >2MB image compression
3. Verify all acceptance criteria from spec §9

**Acceptance**:
- All automated tests pass
- All manual test scenarios work as expected
- All spec acceptance criteria met
- No console errors or warnings

---

## Dependencies

- Task 2 depends on Task 1 (UI structure in place)
- Task 3 is independent (can run in parallel with Task 1-2)
- Task 4 depends on Task 2 and Task 3 (needs picker + upload API)
- Task 5 depends on Task 4 (needs attachment structure finalized)
- Task 6 depends on Task 5 (needs save flow working)
- Task 7-8 depend on Task 1-6 (core flow must work before Share Extension)
- Task 9 can run in parallel with Task 7-8
- Task 10 depends on Task 5 (needs attachments stored)
- Task 11 depends on Task 4 (needs upload flow in place)
- Task 12 runs throughout (update tests as components change)
- Task 13 runs at end (design compliance check)
- Task 14 is final (full integration test)

**Critical Path**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 14

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Share Extension memory limit (30MB) | Compress images in main app, Extension only passes file path |
| Image compression quality vs. size | Multi-tier compression (0.8 → 0.6 → 0.4), clear error if >2MB |
| Offline upload queue complexity | V1: simple retry button, no background queue (mark as future enhancement) |
| URL scheme conflicts | Use unique `multisoul://` scheme, register in app.json |
| Test coverage drop | Update tests in parallel with implementation |

---

## Out of Scope (Future Enhancements)

- Pure text sharing (user can paste manually)
- Multi-image sharing (V1 takes first image only)
- PDF/document/log file attachments
- Clipboard auto-detection for URLs
- Background upload queue on reconnect
- Attachment batch operations (select multiple to delete)
- Share Extension with Target picker (goes to default agent)

---

## Verification Checklist

After completing all tasks:

- [ ] Share Extension appears in iOS Share Sheet for images and URLs
- [ ] Sharing image from Photos creates Idea with image attachment
- [ ] Sharing URL from Safari creates Idea with link attachment
- [ ] IdeaEditorSheet shows only "Add Image" button (Link/Log removed)
- [ ] Image picker shows ActionSheet with Library/Camera options
- [ ] Image uploads automatically after selection
- [ ] Upload progress shows spinner
- [ ] Failed uploads show error + retry button
- [ ] Done button validates upload status
- [ ] After Done, user sees Ideas list with new Idea
- [ ] Idea detail screen displays image and link attachments correctly
- [ ] Tapping image opens full-screen viewer
- [ ] Tapping link opens in Safari
- [ ] >2MB images show error after compression attempts
- [ ] All colors comply with design.md palette
- [ ] All spacing follows 4px grid
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test -- --watchAll=false` passes
- [ ] `cargo test` passes
- [ ] `cargo build` succeeds
- [ ] `scripts/check-mobile-colors.sh` passes

---

*Generated: 2026-06-07*
