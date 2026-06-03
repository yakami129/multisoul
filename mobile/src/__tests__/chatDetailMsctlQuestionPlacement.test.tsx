import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { FlatList } from 'react-native';
import { fetchAgent } from '@/features/agents';
import { fetchMessages, fetchRuntimeModels } from '@/features/chat/services/chatService';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import type { WsMessage } from '@/types';
import ChatDetailScreen from '../../app/chat/[id]';

let mockSearchParams: Record<string, string | undefined> = {
  id: 'conv-1',
  endpoint_id: 'endpoint-1',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: jest.fn(() => ({
    status: 'open',
    sendAnswer: jest.fn(),
    sendAnswerMulti: jest.fn(),
  })),
}));

jest.mock('@/features/agents', () => ({
  fetchAgent: jest.fn(),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn(),
  fetchRuntimeModels: jest.fn(),
  postMessage: jest.fn(),
  switchConversationModel: jest.fn(),
  uploadImage: jest.fn(),
  abortConversation: jest.fn().mockResolvedValue(undefined),
  resolveUserMessageImageUri: jest.fn(),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  loadAnsweredAsks: jest.fn().mockResolvedValue(new Map()),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg }: { msg: WsMessage }) => {
    const { Text } = require('react-native');
    return <Text>{msg.payload.text}</Text>;
  },
}));

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason: expect.any(String) });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useWebSocket as jest.Mock).mockClear();
  mockSearchParams = { id: 'conv-1', endpoint_id: 'endpoint-1' };
  useChatStore.setState({
    conversations: [
      {
        id: 'conv-1',
        agent_id: 'agent-1',
        title: 'Existing Chat',
        created_at: 0,
        last_message_at: 0,
        status: 'idle',
        endpoint_id: 'endpoint-1',
        agent_name: 'Agent',
      },
    ],
    messages: {},
  });
  useEndpointStore.setState({
    endpoints: [
      {
        id: 'endpoint-1',
        label: 'Local',
        base_url: 'http://localhost:8080',
        token: 'token',
        last_seen_at: null,
      },
    ],
  });
  useInboxStore.setState({ items: [] });
  (fetchAgent as jest.Mock).mockResolvedValue({
    id: 'agent-1',
    name: 'Agent',
    project_path: '/tmp/project',
    runtime: 'codex',
    created_at: 0,
    endpoint_id: 'endpoint-1',
    endpoint_label: 'Local',
  });
  (fetchRuntimeModels as jest.Mock).mockResolvedValue([
    {
      id: 'default',
      label: 'Default',
      is_default: true,
      source: 'builtin',
      available: true,
    },
  ]);
});

/// Chat Detail msctl ask placement: loaded user-message-mode ask cards are
/// displayed at the bottom of the FlatList transcript data.
///
/// Data construction:
///   seq 1 = agent_text "first agent row"
///   seq 2 = ask_question ask-msctl with response_mode=user_message
///   seq 3 = ordinary ask_question ask-ordinary without response_mode
///   seq 4 = agent_text "later agent row"
///   loaded window = 4 messages, all renderable transcript rows
///
/// Execution process:
///   1. Mock the initial Chat Detail history request with seq order [1, 2, 3, 4].
///   2. Render ChatDetailScreen for conv-1 and wait until history reaches FlatList.
///   3. Read FlatList.props.data and inspect the displayed seq order.
///
/// Expected result:
///   - Positive: FlatList display seq order is [1, 3, 4, 2].
///   - Positive: ordinary ask seq 3 remains before later agent_text seq 4.
///   - Negative: msctl ask seq 2 does not remain at original index 1.
test('displays loaded msctl ask_question cards at the bottom of Chat Detail FlatList data', async () => {
  const loadedMessages: WsMessage[] = [
    {
      type: 'message',
      seq: 1,
      role: 'agent_text',
      payload: { text: 'first agent row' },
      created_at: 1,
    },
    {
      type: 'message',
      seq: 2,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-msctl',
        allow_freeform: false,
        response_mode: 'user_message',
        questions: [{ id: '0', text: 'Pick one?', options: [{ id: 'yes', label: 'Yes' }] }],
      },
      created_at: 2,
    },
    {
      type: 'message',
      seq: 3,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-ordinary',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Continue?', options: [{ id: 'go', label: 'Go' }] }],
      },
      created_at: 3,
    },
    {
      type: 'message',
      seq: 4,
      role: 'agent_text',
      payload: { text: 'later agent row' },
      created_at: 4,
    },
  ];
  (fetchMessages as jest.Mock).mockResolvedValue(loadedMessages);

  const { UNSAFE_getByType } = render(<ChatDetailScreen />);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await waitFor(() => {
    const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
    expectEqualWithReason(
      data.map((message) => message.seq),
      [1, 3, 4, 2],
      'Chat Detail FlatList data should append loaded msctl ask cards after regular rows',
    );
  });

  const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
  expectEqualWithReason(
    data.findIndex((message) => message.seq === 3) < data.findIndex((message) => message.seq === 4),
    true,
    'ordinary ask_question without response_mode must remain before the later agent_text row',
  );
  expectEqualWithReason(
    data[1]?.seq === 2,
    false,
    'msctl ask_question must not remain at original display index 1',
  );
});
