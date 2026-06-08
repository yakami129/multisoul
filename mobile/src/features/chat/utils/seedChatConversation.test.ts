import { useChatStore } from '@/store/chatStore';
import type { Conversation } from '@/types';
import { seedChatConversation } from './seedChatConversation';

function makeConversation(id: string, status: Conversation['status']): Conversation {
  return {
    id,
    agent_id: 'agent-existing',
    title: 'Existing',
    created_at: 1,
    last_message_at: 1,
    status,
    model_id: null,
    endpoint_id: 'ep-existing',
    agent_name: 'Existing Agent',
  };
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], messages: {} });
});

/// Missing conversation + running seed: a freshly-started interview/implementation
/// turn must register a running conversation so the Analyzing… bubble can render.
test('inserts a missing conversation with the forced running status', () => {
  seedChatConversation({
    id: 'conv-new',
    endpointId: 'ep-1',
    agentId: 'agent-1',
    agentName: 'Codex',
    status: 'running',
  });

  const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-new');
  expect(conv).toMatchObject({
    id: 'conv-new',
    endpoint_id: 'ep-1',
    agent_id: 'agent-1',
    agent_name: 'Codex',
    status: 'running',
  });
});

/// Existing stale conversation + running seed: opening a freshly-started turn must
/// override a stale non-running status (e.g. a polled "completed") with running.
test('forces running status onto an already-stored stale conversation', () => {
  useChatStore.setState({
    conversations: [makeConversation('conv-old', 'completed')],
    messages: {},
  });

  seedChatConversation({ id: 'conv-old', status: 'running' });

  expect(useChatStore.getState().conversations.find((c) => c.id === 'conv-old')?.status).toBe(
    'running',
  );
});

/// No-status seed (open existing chat): insert as idle if missing and let the
/// transcript fetch / WebSocket reconcile, without forcing a status.
test('inserts a missing conversation as idle when no status is provided', () => {
  seedChatConversation({ id: 'conv-open', endpointId: 'ep-2', agentId: 'agent-2' });

  expect(useChatStore.getState().conversations.find((c) => c.id === 'conv-open')?.status).toBe(
    'idle',
  );
});

/// No-status seed must not clobber an existing conversation's live status.
test('does not override an existing conversation status when no status is provided', () => {
  useChatStore.setState({
    conversations: [makeConversation('conv-live', 'awaiting_question')],
    messages: {},
  });

  seedChatConversation({ id: 'conv-live' });

  expect(useChatStore.getState().conversations.find((c) => c.id === 'conv-live')?.status).toBe(
    'awaiting_question',
  );
});
