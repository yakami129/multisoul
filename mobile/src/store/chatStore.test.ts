import { type Conversation, type MessageRole, type WsMessage } from '@/types';
import { useChatStore } from './chatStore';

function makeConversation(id: string): Conversation {
  return {
    id,
    agent_id: 'agent-1',
    title: 'New Chat',
    created_at: 1,
    last_message_at: 1,
    status: 'running',
    endpoint_id: 'endpoint-1',
    agent_name: 'Settings Project',
  };
}

function makeMessage(seq: number, role: MessageRole = 'agent_text', text?: string): WsMessage {
  return {
    type: 'message',
    seq,
    role,
    payload:
      role === 'user_text'
        ? { text: text ?? `User ${seq}` }
        : role === 'task_status'
          ? {
              task_id: 'task-1',
              status: text === 'failed' ? 'failed' : text === 'running' ? 'running' : 'completed',
              importance: 'normal',
              summary: text ?? 'completed',
            }
          : { text: text ?? `Agent ${seq}` },
    created_at: seq,
  };
}

describe('chatStore conversation previews', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], messages: {} });
  });

  /// Conversation preview metadata: appendMessage records the first user prompt and latest AI reply
  ///
  /// Data:
  ///   conversation title = "New Chat"
  ///   user_text seq=1 text = "Build the settings screen"
  ///   agent_text seq=2 text = "I added the settings screen"
  ///
  /// Execution:
  ///   1. Seed chatStore with a new conversation whose title is still the default
  ///   2. appendMessage(user_text) updates first_user_message once
  ///   3. appendMessage(agent_text) updates last_ai_reply
  ///
  /// Expected:
  ///   - first_user_message is the first user prompt, so list titles can replace "New Chat"
  ///   - last_ai_reply is the latest agent text, so list subtitles can show AI progress
  it('updates conversation preview fields from appended messages', () => {
    useChatStore.getState().addConversation({
      id: 'conv-1',
      agent_id: 'agent-1',
      title: 'New Chat',
      created_at: 1,
      last_message_at: 1,
      status: 'running',
      endpoint_id: 'endpoint-1',
      agent_name: 'Settings Project',
    });

    useChatStore.getState().appendMessage('conv-1', {
      type: 'message',
      seq: 1,
      role: 'user_text',
      payload: { text: 'Build the settings screen' },
      created_at: 2,
    });
    useChatStore.getState().appendMessage('conv-1', {
      type: 'message',
      seq: 2,
      role: 'agent_text',
      payload: { text: 'I added the settings screen' },
      created_at: 3,
    });

    const conversation = useChatStore.getState().conversations[0];
    expect(conversation.first_user_message).toBe('Build the settings screen');
    expect(conversation.last_ai_reply).toBe('I added the settings screen');
    expect(conversation.title).toBe('New Chat');
  });

  /// Conversation preview metadata: later user messages must not overwrite the first prompt
  ///
  /// Data:
  ///   user_text seq=1 text = "First prompt"
  ///   user_text seq=2 text = "Follow up prompt"
  ///
  /// Execution:
  ///   1. Seed a default "New Chat" conversation
  ///   2. appendMessage(first user prompt)
  ///   3. appendMessage(follow-up user prompt)
  ///
  /// Expected:
  ///   - first_user_message remains "First prompt"
  ///   - first_user_message does not become "Follow up prompt"
  it('keeps the first user prompt when later user messages arrive', () => {
    useChatStore.getState().addConversation({
      id: 'conv-1',
      agent_id: 'agent-1',
      title: 'New Chat',
      created_at: 1,
      last_message_at: 1,
      status: 'running',
      endpoint_id: 'endpoint-1',
      agent_name: 'Settings Project',
    });

    useChatStore.getState().appendMessage('conv-1', {
      type: 'message',
      seq: 1,
      role: 'user_text',
      payload: { text: 'First prompt' },
      created_at: 2,
    });
    useChatStore.getState().appendMessage('conv-1', {
      type: 'message',
      seq: 2,
      role: 'user_text',
      payload: { text: 'Follow up prompt' },
      created_at: 3,
    });

    const conversation = useChatStore.getState().conversations[0];
    expect(conversation.first_user_message).toBe('First prompt');
    expect(conversation.first_user_message).not.toBe('Follow up prompt');
  });

  /// Message window merge: incoming overlap is deduped by seq without replacing the existing row
  ///
  /// Data construction:
  ///   existing history = seq 10, 11, 12
  ///   incoming page    = seq 12 duplicate + seq 13 new
  ///   expected window  = 4 unique seq values sorted ascending: [10, 11, 12, 13]
  ///
  /// Execution:
  ///   1. Seed the store with the current message window for conv-merge
  ///   2. mergeMessages receives one duplicate tail row and one new newer row
  ///   3. The store uses seq as stable identity, preserving the existing seq 12 payload
  ///
  /// Expected result:
  ///   - Positive: seq 13 exists after the merge because it was a new row
  ///   - Positive: seq 12 appears exactly once because duplicate seq values are deduped
  ///   - Negative: seq 12 is not replaced by the incoming duplicate payload
  it('merges messages by seq while preserving existing duplicates', () => {
    useChatStore.getState().addConversation(makeConversation('conv-merge'));
    useChatStore
      .getState()
      .setMessages('conv-merge', [
        makeMessage(10, 'user_text', 'Prompt 10'),
        makeMessage(11, 'agent_text', 'Reply 11'),
        makeMessage(12, 'agent_text', 'Original reply 12'),
      ]);

    useChatStore
      .getState()
      .mergeMessages('conv-merge', [
        makeMessage(12, 'agent_text', 'Incoming duplicate reply 12'),
        makeMessage(13, 'agent_text', 'Reply 13'),
      ]);

    const messages = useChatStore.getState().messages['conv-merge'];
    expect(messages.map((message) => message.seq)).toEqual([10, 11, 12, 13]);
    expect(messages.some((message) => message.seq === 13)).toBe(true);
    expect(messages.filter((message) => message.seq === 12)).toHaveLength(1);
    expect(messages.find((message) => message.seq === 12)?.payload).toEqual({
      text: 'Original reply 12',
    });
    expect(messages.find((message) => message.seq === 12)?.payload).not.toEqual({
      text: 'Incoming duplicate reply 12',
    });
  });

  /// Older page prepend: overlapping boundary row is deduped and the full window stays sorted
  ///
  /// Data construction:
  ///   existing latest window = seq 11, 12, 13, 14, 15
  ///   incoming older page    = seq 6, 7, 8, 9, 10, 11
  ///   expected range         = first seq 6, last seq 15, seq 11 appears once
  ///
  /// Execution:
  ///   1. Seed the store with the latest page for conv-prepend
  ///   2. prependMessages receives an older page that overlaps on seq 11
  ///   3. The merged window is sorted ascending for rendering and pagination math
  ///
  /// Expected result:
  ///   - Positive: first seq is 6 because older rows were added
  ///   - Positive: last seq is 15 because the latest window was preserved
  ///   - Positive: full seq list is [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] in ascending order
  ///   - Negative: seq 11 is not duplicated at the page boundary
  it('prepends older messages with boundary seq dedupe', () => {
    useChatStore.getState().addConversation(makeConversation('conv-prepend'));
    useChatStore.getState().setMessages(
      'conv-prepend',
      [11, 12, 13, 14, 15].map((seq) => makeMessage(seq)),
    );

    useChatStore.getState().prependMessages(
      'conv-prepend',
      [6, 7, 8, 9, 10, 11].map((seq) => makeMessage(seq)),
    );

    const messages = useChatStore.getState().messages['conv-prepend'];
    expect(messages[0]?.seq).toBe(6);
    expect(messages[messages.length - 1]?.seq).toBe(15);
    expect(messages.map((message) => message.seq)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(messages.filter((message) => message.seq === 11)).toHaveLength(1);
    expect(messages.map((message) => message.seq)).not.toEqual([11, 12, 13, 14, 15]);
  });

  /// Message window reset: current history is replaced by a sorted deduped incoming page
  ///
  /// Data construction:
  ///   existing history = seq 1 user_text "Old prompt"
  ///   incoming reset   = seq 3 task_status(completed), seq 2 user_text "New prompt", seq 3 duplicate
  ///   expected window  = unique sorted seq values [2, 3]
  ///
  /// Execution:
  ///   1. Seed conv-reset with an obsolete seq 1 history
  ///   2. resetMessages receives an unsorted page with a duplicate seq 3 status row
  ///   3. The store replaces old history, dedupes by seq, sorts ascending, and recalculates metadata
  ///
  /// Expected result:
  ///   - Positive: seq 2 and seq 3 remain after reset in ascending order
  ///   - Negative: seq 1 is gone because reset replaces the old window
  ///   - Positive: preview/status use the reset history, with first_user_message "New prompt" and status completed
  it('resets messages with sorted seq dedupe and recalculated preview status', () => {
    useChatStore.getState().addConversation(makeConversation('conv-reset'));
    useChatStore.getState().setMessages('conv-reset', [makeMessage(1, 'user_text', 'Old prompt')]);

    useChatStore
      .getState()
      .resetMessages('conv-reset', [
        makeMessage(3, 'task_status', 'completed'),
        makeMessage(2, 'user_text', 'New prompt'),
        makeMessage(3, 'task_status', 'failed'),
      ]);

    const messages = useChatStore.getState().messages['conv-reset'];
    const conversation = useChatStore.getState().conversations[0];
    expect(messages.map((message) => message.seq)).toEqual([2, 3]);
    expect(messages.some((message) => message.seq === 1)).toBe(false);
    expect(messages.filter((message) => message.seq === 3)).toHaveLength(1);
    expect(conversation.first_user_message).toBe('New prompt');
    expect(conversation.first_user_message).not.toBe('Old prompt');
    expect(conversation.status).toBe('completed');
    expect(conversation.status).not.toBe('failed');
  });

  /// mergeConversations: REST status must overwrite stale WS status for existing conversation
  ///
  /// Data:
  ///   conv-1 in chatStore with status 'running' (set by WS during active task)
  ///   REST fetchConversations returns conv-1 with status 'completed'
  ///
  /// Execution:
  ///   1. Seed chatStore with conv-1 status='running'
  ///   2. mergeConversations([conv-1 status='completed'])
  ///
  /// Expected:
  ///   - Positive: conv-1.status is 'completed' (REST result wins)
  ///   - Negative: conv-1.status is not 'running' (stale WS state cleared)
  ///
  /// Regression: addConversation skipped existing IDs so status was never updated on focus refresh
  it('overwrites stale status of existing conversations with REST result', () => {
    useChatStore.getState().addConversation(makeConversation('conv-1'));

    useChatStore
      .getState()
      .mergeConversations([{ ...makeConversation('conv-1'), status: 'completed' }]);

    const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-1');
    expect(conv?.status).toBe('completed');
    expect(conv?.status).not.toBe('running');
  });

  /// mergeConversations: new conversations are added without removing existing ones
  ///
  /// Data:
  ///   chatStore has conv-1
  ///   mergeConversations receives conv-2 (new)
  ///
  /// Expected:
  ///   - Positive: conv-1 still present
  ///   - Positive: conv-2 was added
  it('adds new conversations while preserving existing ones', () => {
    useChatStore.getState().addConversation(makeConversation('conv-1'));

    useChatStore.getState().mergeConversations([makeConversation('conv-2')]);

    const ids = useChatStore.getState().conversations.map((c) => c.id);
    expect(ids).toContain('conv-1');
    expect(ids).toContain('conv-2');
  });

  /// mergeConversations: handles mixed batch of updates and new additions in one call
  ///
  /// Data:
  ///   chatStore has conv-1 (running)
  ///   mergeConversations receives [conv-1 (idle), conv-2 (new running)]
  ///
  /// Expected:
  ///   - conv-1.status becomes 'idle'
  ///   - conv-2 exists in store
  it('updates existing and adds new conversations in a single merge', () => {
    useChatStore.getState().addConversation(makeConversation('conv-1'));

    useChatStore
      .getState()
      .mergeConversations([
        { ...makeConversation('conv-1'), status: 'idle' },
        makeConversation('conv-2'),
      ]);

    const state = useChatStore.getState();
    expect(state.conversations.find((c) => c.id === 'conv-1')?.status).toBe('idle');
    expect(state.conversations.some((c) => c.id === 'conv-2')).toBe(true);
  });

  /// Partial window reset: loaded pages must not erase server-provided preview fields
  ///
  /// Data construction:
  ///   conv-preserve preview = first_user_message "Original prompt", last_ai_reply "Existing reply"
  ///   conv-update preview   = first_user_message "Original prompt", last_ai_reply "Existing reply"
  ///   preserve reset window = seq 20 task_status(completed), no user_text, no agent_text
  ///   update reset window   = seq 30 task_status(running), seq 31 agent_text "Newer reply", no user_text
  ///
  /// Execution:
  ///   1. Seed both conversations with preview metadata from the server/conversation list
  ///   2. resetMessages(conv-preserve) loads a latest page that cannot supply preview replacement text
  ///   3. resetMessages(conv-update) loads a latest page with a newer agent_text but no original user_text
  ///
  /// Expected result:
  ///   - Positive: both conversations keep first_user_message "Original prompt" because neither window has user_text
  ///   - Positive: conv-preserve keeps last_ai_reply "Existing reply" because its window has no agent_text
  ///   - Positive: conv-update changes last_ai_reply to "Newer reply" because its window supplies agent_text
  ///   - Negative: first_user_message is not cleared to undefined by partial-window replay
  it('preserves preview fields when resetMessages receives a partial latest window', () => {
    useChatStore.getState().addConversation({
      ...makeConversation('conv-preserve'),
      first_user_message: 'Original prompt',
      last_ai_reply: 'Existing reply',
    });
    useChatStore.getState().addConversation({
      ...makeConversation('conv-update'),
      first_user_message: 'Original prompt',
      last_ai_reply: 'Existing reply',
    });

    useChatStore
      .getState()
      .resetMessages('conv-preserve', [makeMessage(20, 'task_status', 'completed')]);
    useChatStore
      .getState()
      .resetMessages('conv-update', [
        makeMessage(30, 'task_status', 'running'),
        makeMessage(31, 'agent_text', 'Newer reply'),
      ]);

    const preserveConversation = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === 'conv-preserve');
    const updateConversation = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === 'conv-update');
    expect(preserveConversation?.first_user_message).toBe('Original prompt');
    expect(preserveConversation?.first_user_message).not.toBeUndefined();
    expect(preserveConversation?.last_ai_reply).toBe('Existing reply');
    expect(preserveConversation?.last_ai_reply).not.toBeUndefined();
    expect(updateConversation?.first_user_message).toBe('Original prompt');
    expect(updateConversation?.first_user_message).not.toBeUndefined();
    expect(updateConversation?.last_ai_reply).toBe('Newer reply');
    expect(updateConversation?.last_ai_reply).not.toBe('Existing reply');
  });
});
