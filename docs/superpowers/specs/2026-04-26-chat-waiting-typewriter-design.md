# Chat Waiting And Typewriter Design

## Goal

Improve `mobile/src/features/chat/components/ChatScreen.tsx` so sending a chat message has visible waiting feedback and assistant responses render with a hacker-style typewriter reveal.

## Requirements

- After a non-empty send, clear the input, disable the input and send button, and show an assistant-side waiting bubble.
- The waiting bubble should match the existing dark green terminal aesthetic and feel explicitly hacker-themed.
- When a new assistant message arrives, remove the waiting bubble and render that latest assistant response through a typewriter effect.
- Existing historical assistant messages should render fully when the screen opens, avoiding replaying old conversations.
- Keep changes local to the chat screen component unless tests reveal a hook-level state is necessary.

## Design

`ChatScreen` keeps a local `isAwaitingResponse` flag that is set after `handleSend()` calls `onSend(text)`. It derives whether a new assistant message arrived by comparing the latest assistant message id to the last assistant id present on initial render or after a send. While awaiting, the input is disabled and a synthetic assistant waiting bubble is appended to the rendered list.

The typewriter effect is applied only to the latest assistant message that arrives while awaiting a response. The component tracks the active message id and a visible character count, incrementing it on a timer until the full text is visible. During this local reveal, the message keeps a block cursor even if the server has already marked streaming as done.

## Testing

Add component tests for:

- Sending a message shows the waiting bubble and disables input.
- Receiving an assistant message removes the waiting bubble.
- The latest assistant message reveals text over timers instead of displaying all content immediately.
