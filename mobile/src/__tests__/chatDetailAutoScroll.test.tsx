import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { FlatList } from 'react-native';
import { fetchAgent } from '@/features/agents';
import { fetchMessages, fetchRuntimeModels } from '@/features/chat/services/chatService';
import {
  fetchTranscriptTurns,
  fetchTurnHiddenMessages,
} from '@/features/chat/services/transcriptService';
import type { TranscriptPage } from '@/features/chat/types';
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

jest.mock('@/features/agents', () => ({ fetchAgent: jest.fn() }));

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn(),
  fetchRuntimeModels: jest.fn(),
  postMessage: jest.fn().mockResolvedValue(undefined),
  switchConversationModel: jest.fn(),
  uploadImage: jest.fn(),
  abortConversation: jest.fn().mockResolvedValue(undefined),
  resolveUserMessageImageUri: jest.fn(),
}));

jest.mock('@/features/chat/services/transcriptService', () => ({
  fetchTranscriptTurns: jest.fn(),
  fetchTurnHiddenMessages: jest.fn(),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  loadAnsweredAsks: jest.fn().mockResolvedValue(new Map()),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg, waiting }: { msg: WsMessage; waiting?: boolean }) => {
    const { Text } = require('react-native');
    return <Text>{waiting ? 'waiting' : msg.payload.text}</Text>;
  },
}));

function userText(seq: number, text: string): WsMessage {
  return {
    type: 'message',
    seq,
    role: 'user_text',
    payload: { text },
    created_at: seq,
  };
}

function makeRawTranscriptPage(convId: string, messages: WsMessage[]): TranscriptPage {
  const firstSeq = messages[0]?.seq ?? null;
  return {
    conversation_id: convId,
    status: 'idle',
    items:
      firstSeq == null
        ? []
        : [
            {
              kind: 'current_turn_raw',
              turn_id: `turn-${firstSeq}`,
              start_seq: firstSeq,
              messages,
            },
          ],
    page_info: {
      oldest_turn_id: firstSeq == null ? null : `turn-${firstSeq}`,
      has_older: false,
    },
  };
}

async function fetchMessagesBackedTranscript(
  baseUrl: string,
  token: string,
  convId: string,
): Promise<TranscriptPage> {
  const messages = await (fetchMessages as jest.Mock)(baseUrl, token, convId, { limit: 25 });
  return makeRawTranscriptPage(convId, messages);
}

beforeEach(() => {
  jest.clearAllMocks();
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
  (useWebSocket as jest.Mock).mockClear();
  (fetchMessages as jest.Mock).mockResolvedValue([
    userText(1, 'first prompt'),
    userText(2, 'more'),
  ]);
  (fetchTranscriptTurns as jest.Mock).mockImplementation(fetchMessagesBackedTranscript);
  (fetchTurnHiddenMessages as jest.Mock).mockResolvedValue({
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    messages: [],
  });
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

test('falls back to bottom placement when opening a transcript without AI messages', async () => {
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  try {
    const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

    await waitFor(() => expect(getByText('more')).toBeTruthy());
    scrollToIndexSpy.mockClear();
    scrollToEndSpy.mockClear();

    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 900);
    });

    expect({
      actual: scrollToIndexSpy.mock.calls.length,
      reason: 'transcripts without agent_text should not try to target an AI row',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: scrollToEndSpy.mock.calls,
      reason: 'transcripts without agent_text should fall back to bottom placement',
    }).toEqual({ actual: [[{ animated: false }]], reason: expect.any(String) });
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
  }
});
