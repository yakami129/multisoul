import { useChatStore } from './chatStore';

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
});
