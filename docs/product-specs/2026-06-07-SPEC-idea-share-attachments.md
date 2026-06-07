# SPEC: Idea Quick Capture & Attachment Support

**Date**: 2026-06-07  
**Status**: ready

## Goals

1. Make idea attachments hold real content: link attachments store a URL, log attachments store text, image attachments store a local URI (compressed JPEG).
2. Add a `multisoul://new-idea` deep link route so iOS Shortcuts can pre-fill and open the idea editor directly.

## Acceptance Criteria

- **Link attachment**: shows a URL TextInput and a "Paste" button (reads clipboard); URL is persisted in `attachment.uri` on save.
- **Log attachment**: shows a multiline TextInput for paste; text persisted in `attachment.text` on save.
- **Image attachment**: shows a "Pick Image" button that opens the media library, compresses to JPEG 0.8, stores URI in `attachment.uri`; once set, shows thumbnail + "Change" button.
- **Remove**: each attachment has a remove (×) button that deletes the row.
- **Dirty check**: saving an idea with changed attachment content (uri/text) counts as dirty and triggers the "save before closing" dialog.
- **Deep link**: `multisoul://new-idea?body=<text>&url=<url>&title=<title>` opens the editor pre-filled; `url` param creates a link attachment pre-populated with that URL; on save the user is navigated to `/idea/<newId>`.
- **Typecheck**: `pnpm typecheck` passes with no errors.
- **Tests**: existing `IdeaEditorSheet` tests pass; new tests cover link URL input rendering and remove-attachment flow.

## Out of Scope

- iOS native Share Extension (system-level share sheet integration).
- Uploading image to server (upload stays in chat flow only; idea attachments store local URI).
- Android deep link / intent filter registration.
