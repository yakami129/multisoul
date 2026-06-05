import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Alert, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchAgent } from '@/features/agents';
import {
  fetchMessages,
  fetchRuntimeModels,
  postMessage,
  switchConversationModel,
  uploadImage,
} from '@/features/chat/services/chatService';
import {
  fetchTranscriptTurns,
  fetchTurnHiddenMessages,
} from '@/features/chat/services/transcriptService';
import type { TranscriptPage } from '@/features/chat/types';
import type { ChatTranscriptDisplayItem } from '@/features/chat/utils/chatRenderState';
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
  resolveUserMessageImageUri: (
    msg: WsMessage,
    baseUrl: string,
    token: string,
    localUris: Map<string, string>,
  ) => {
    if (msg.role !== 'user_text') return undefined;
    const fileId = (msg.payload as { file_id?: string }).file_id;
    if (!fileId) return undefined;
    const base = baseUrl.replace(/\/$/, '');
    const encodedFileId = encodeURIComponent(fileId);
    const encodedToken = encodeURIComponent(token);
    return localUris.get(fileId) ?? `${base}/api/v1/uploads/${encodedFileId}?token=${encodedToken}`;
  },
}));

jest.mock('@/features/chat/services/transcriptService', () => ({
  fetchTranscriptTurns: jest.fn(),
  fetchTurnHiddenMessages: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  loadAnsweredAsks: jest.fn().mockResolvedValue(new Map()),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg, typewriter, waiting, imageUri }: any) => {
    const { Text } = require('react-native');
    return (
      <Text>
        {waiting ? 'waiting' : msg.payload.text}
        {typewriter ? ' [typewriter]' : ''}
        {imageUri ? ` ${imageUri}` : ''}
      </Text>
    );
  },
}));

const historyMessages: WsMessage[] = [
  {
    type: 'message',
    seq: 1,
    role: 'user_text',
    payload: { text: 'hello' },
    created_at: 1,
  },
  {
    type: 'message',
    seq: 2,
    role: 'agent_text',
    payload: { text: 'historical response' },
    created_at: 2,
  },
];

function makeNumberedMessages(start: number, end: number): WsMessage[] {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const seq = start + index;
    return {
      type: 'message',
      seq,
      role: seq % 2 === 0 ? 'agent_text' : 'user_text',
      payload: { text: `cached message ${seq}` },
      created_at: seq,
    };
  });
}

function inferTranscriptStatus(convId: string, messages: WsMessage[]): TranscriptPage['status'] {
  const taskStatus = [...messages].reverse().find((msg) => msg.role === 'task_status');
  const status = (taskStatus?.payload as { status?: TranscriptPage['status'] } | undefined)?.status;
  if (status) return status;
  return useChatStore.getState().conversations.find((conv) => conv.id === convId)?.status ?? 'idle';
}

function makeRawTranscriptPage(convId: string, messages: WsMessage[]): TranscriptPage {
  const firstSeq = messages[0]?.seq ?? null;
  const firstUserSeq = messages.find((msg) => msg.role === 'user_text')?.seq ?? firstSeq;
  return {
    conversation_id: convId,
    status: inferTranscriptStatus(convId, messages),
    items:
      firstUserSeq == null
        ? []
        : [
            {
              kind: 'current_turn_raw',
              turn_id: `turn-${firstUserSeq}`,
              start_seq: firstUserSeq,
              messages,
            },
          ],
    page_info: {
      oldest_turn_id: firstUserSeq == null ? null : `turn-${firstUserSeq}`,
      has_older: firstSeq != null && firstSeq > 1,
    },
  };
}

async function fetchMessagesBackedTranscript(
  baseUrl: string,
  token: string,
  convId: string,
  options?: { beforeTurn?: string; aroundAskId?: string },
): Promise<TranscriptPage> {
  const beforeSeq = options?.beforeTurn?.startsWith('turn-')
    ? Number(options.beforeTurn.slice('turn-'.length))
    : null;
  const messageOptions = options?.aroundAskId
    ? { around_ask_id: options.aroundAskId, limit: 100 }
    : beforeSeq
      ? { before_seq: beforeSeq, limit: 30 }
      : { limit: 25 };
  const messages = await (fetchMessages as jest.Mock)(baseUrl, token, convId, messageOptions);
  return makeRawTranscriptPage(convId, messages);
}

function displayItemSeq(item: ChatTranscriptDisplayItem | undefined): number | undefined {
  return item?.kind === 'message' ? item.message.seq : undefined;
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
  (fetchMessages as jest.Mock).mockResolvedValue(historyMessages);
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
  (postMessage as jest.Mock).mockResolvedValue(undefined);
  (uploadImage as jest.Mock).mockResolvedValue({ file_id: 'file-1' });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///picked.jpg' }],
  });
  (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
    uri: 'file:///compressed.jpg',
  });
});

async function pickImageFromComposer(getByTestId: (testID: string) => any) {
  await act(async () => {
    fireEvent.press(getByTestId('composer-plus-btn'));
  });
  await act(async () => {
    fireEvent.press(getByTestId('composer-action-upload'));
  });
}

test('renders fetched historical agent text without typewriter replay', async () => {
  const { getByText, queryByText } = render(<ChatDetailScreen />);

  // Drain deeply-chained promise effects (fetchAgent→fetchRuntimeModels→setRuntimeModels,
  // Promise.all([fetchMessages,loadAnsweredAsks])→resetMessages). Two macrotask yields
  // ensure even slow CI runners flush all microtask chains before assertions.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await waitFor(() => expect(getByText('historical response')).toBeTruthy(), { timeout: 10000 });

  expect(queryByText('historical response [typewriter]')).toBeNull();
}, 15000);

test('lazy-loads worked row hidden messages only after expansion', async () => {
  const user: WsMessage = {
    type: 'message',
    seq: 10,
    role: 'user_text',
    payload: { text: 'ship it' },
    created_at: 10,
  };
  const finalAgent: WsMessage = {
    type: 'message',
    seq: 14,
    role: 'agent_text',
    payload: { text: 'done' },
    created_at: 14,
  };
  const hiddenAgent: WsMessage = {
    type: 'message',
    seq: 11,
    role: 'agent_text',
    payload: { text: 'thinking privately' },
    created_at: 11,
  };
  (fetchTranscriptTurns as jest.Mock).mockResolvedValue({
    conversation_id: 'conv-1',
    status: 'completed',
    items: [
      {
        kind: 'turn_summary',
        turn_id: 'turn-10',
        start_seq: 10,
        end_seq: 14,
        user,
        worked: {
          id: 'worked-turn-10',
          label: 'Worked for 4s',
          duration_ms: 4_000,
          hidden_count: 1,
          first_hidden_seq: 11,
          last_hidden_seq: 11,
        },
        asks: [],
        final_agent: finalAgent,
      },
    ],
    page_info: { oldest_turn_id: 'turn-10', has_older: false },
  });
  (fetchTurnHiddenMessages as jest.Mock).mockResolvedValue({
    conversation_id: 'conv-1',
    turn_id: 'turn-10',
    messages: [hiddenAgent],
  });

  const { getByTestId, getByText, queryByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('Worked for 4s')).toBeTruthy());
  expect(queryByText('thinking privately')).toBeNull();
  expect(fetchTurnHiddenMessages).not.toHaveBeenCalled();

  fireEvent.press(getByTestId('worked-row'));

  await waitFor(() => expect(getByText('thinking privately')).toBeTruthy());
  expect(fetchTurnHiddenMessages).toHaveBeenCalledWith(
    'http://localhost:8080',
    'token',
    'conv-1',
    'turn-10',
  );
});

/// Initial history request: opening ChatDetail should fetch the latest server
/// transcript page using the configured initial turn limit.
///
/// Data construction:
///   route conv_id = "conv-1"
///   endpoint      = http://localhost:8080 with token "token"
///   initial limit = 20 turns
///
/// Execution process:
///   1. Render ChatDetailScreen for conv-1.
///   2. Wait for the mocked historical response to render.
///   3. Inspect fetchTranscriptTurns calls.
///
/// Expected result:
///   - Positive: fetchTranscriptTurns requests conv-1 with limit 20.
///   - Negative: no beforeTurn cursor is sent on initial latest-page load.
test('loads the initial chat history with the latest 20-turn limit', async () => {
  const { getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('historical response')).toBeTruthy());

  expect({
    actual: (fetchTranscriptTurns as jest.Mock).mock.calls.some(
      ([baseUrl, token, convId, options]) =>
        baseUrl === 'http://localhost:8080' &&
        token === 'token' &&
        convId === 'conv-1' &&
        options?.limit === 20,
    ),
    reason: 'initial history request should use the 20-turn transcript page limit',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: (fetchTranscriptTurns as jest.Mock).mock.calls.some(
      ([, , convId, options]) => convId === 'conv-1' && options?.beforeTurn != null,
    ),
    reason: 'initial latest page must not include an older-turn cursor',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Server transcript authority: reopening a conversation with a large raw-message
/// cache must wait for the transcript-turns response instead of deriving history
/// rows from the local raw cache.
///
/// Data construction:
///   cached store rows = seq 1..200, total 200 messages
///   transcript request = unresolved, so the assertion inspects the pre-response render
///
/// Execution process:
///   1. Seed chatStore with 200 cached rows for conv-1.
///   2. Render ChatDetailScreen while the initial transcript request stays pending.
///   3. Inspect the FlatList data used for the first render.
///
/// Expected result:
///   - Positive: FlatList data length is 0 until transcript-turns resolves.
///   - Positive: transcript-turns is requested for the latest turn page.
///   - Negative: cached seq 176..200 are not treated as authoritative display rows.
test('does not derive the initial transcript from cached raw store history', () => {
  useChatStore.setState((state) => ({
    ...state,
    messages: { 'conv-1': makeNumberedMessages(1, 200) },
  }));
  (fetchTranscriptTurns as jest.Mock).mockImplementation(() => new Promise(() => {}));

  const { UNSAFE_getByType } = render(<ChatDetailScreen />);
  const data = UNSAFE_getByType(FlatList).props.data as ChatTranscriptDisplayItem[];

  expect({
    actual: data.length,
    reason: 'raw cache must not render before the server transcript page arrives',
  }).toEqual({ actual: 0, reason: expect.any(String) });
  expect({
    actual: (fetchTranscriptTurns as jest.Mock).mock.calls[0]?.[3],
    reason: 'initial history should request the latest transcript turn page',
  }).toEqual({ actual: { limit: 20, aroundAskId: undefined }, reason: expect.any(String) });
  expect({
    actual: data.some((item) => displayItemSeq(item) === 176 || displayItemSeq(item) === 200),
    reason: 'cached raw message rows must not become display rows before server metadata',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Initial scroll guard: FlatList can emit a top-position scroll during layout
/// or programmatic settling, but that is not the user's upward history gesture.
///
/// Data construction:
///   initial latest page = seq 11 only
///   older page cursor   = before_seq 11
///   top threshold       = y 0 < 80, but no user drag has begun
///
/// Execution process:
///   1. Render ChatDetailScreen and wait for seq 11 latest page.
///   2. Fire FlatList onScroll at y=0 without onScrollBeginDrag.
///   3. Inspect fetchMessages calls for older pagination.
///
/// Expected result:
///   - Positive: latest prompt renders from the initial page.
///   - Negative: before_seq 11 is not requested without a user drag.
test('does not load older history from initial top scroll before user drag', async () => {
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'should not load from layout scroll' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });

  const beforeSeqCalls = (fetchMessages as jest.Mock).mock.calls.filter(
    ([, , , options]) => options?.before_seq === 11,
  );
  expect({
    actual: beforeSeqCalls.length,
    reason: 'layout/programmatic top scroll must not request older history before user drag',
  }).toEqual({ actual: 0, reason: expect.any(String) });
});

/// Initial history race: a live WebSocket message appended while the limited
/// REST history request is in flight must not be erased by the history commit.
///
/// Data construction:
///   REST latest page returns seq 1 and seq 2 after a delayed promise resolves.
///   Live WebSocket/store append inserts seq 101 before that promise resolves.
///   responseMax = 2, currentMax = 101, so reset would drop the newer row.
///
/// Execution process:
///   1. Render ChatDetailScreen and keep the initial fetch unresolved.
///   2. Append seq 101 to chatStore to simulate a live WebSocket message.
///   3. Resolve the initial fetch with only seq 1 and seq 2.
///
/// Expected result:
///   - Positive assertion: "live response" still renders after history resolves.
///   - Positive assertion: historical seq 2 renders, proving REST history still committed.
///   - Negative assertion: the conversation message list must not shrink to only seq 1 and seq 2.
test('preserves live messages appended before initial history resolves', async () => {
  let resolveInitial: ((messages: WsMessage[]) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { limit?: number }) => {
      if (options?.limit === 25) {
        return new Promise((resolve) => {
          resolveInitial = resolve;
        });
      }
      return Promise.resolve([]);
    },
  );
  const { getByText } = render(<ChatDetailScreen />);

  await waitFor(() =>
    expect({
      actual: typeof resolveInitial,
      reason: 'initial limited history request should be pending before live append',
    }).toEqual({ actual: 'function', reason: expect.any(String) }),
  );
  act(() => {
    useChatStore.getState().appendMessage('conv-1', {
      type: 'message',
      seq: 101,
      role: 'agent_text',
      payload: { text: 'live response' },
      created_at: 101,
    });
  });
  await act(async () => {
    resolveInitial?.(historyMessages);
  });

  await waitFor(() => expect(getByText(/live response/)).toBeTruthy());
  expect({
    actual: getByText('historical response') != null,
    reason: 'initial REST history should still be merged into the transcript',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: useChatStore.getState().messages['conv-1'].map((msg) => msg.seq),
    reason: 'initial history commit must preserve newer live seq 101',
  }).not.toEqual({ actual: [1, 2], reason: expect.any(String) });
});

/// WebSocket catch-up cursor: ChatDetail must not ask the socket hook to fetch
/// legacy full history before the limited initial page has established a cursor.
///
/// Data construction:
///   Initial REST page returns seq 1 and seq 2.
///   Missing cursor would be represented by catchUpAfterSeq = 0.
///   Correct cursor after initial load is max(1, 2) = 2.
///
/// Execution process:
///   1. Render ChatDetailScreen.
///   2. Inspect the first useWebSocket options before initial history resolves.
///   3. Wait for initial history to render and inspect later options.
///
/// Expected result:
///   - Positive assertion: first hook call disables catch-up while cursor is unknown.
///   - Positive assertion: later hook call enables catch-up after seq 2.
///   - Negative assertion: no hook call passes catchUpAfterSeq = 0.
test('seeds websocket catch-up only after initial history establishes a cursor', async () => {
  const { getByText } = render(<ChatDetailScreen />);

  expect({
    actual: (useWebSocket as jest.Mock).mock.calls[0]?.[0]?.enableCatchUp,
    reason: 'first ChatDetail mount must not enable catch-up before initial history cursor exists',
  }).toEqual({ actual: false, reason: expect.any(String) });

  await waitFor(() => expect(getByText('historical response')).toBeTruthy());

  expect({
    actual: (useWebSocket as jest.Mock).mock.calls.some(
      ([options]) => options.catchUpAfterSeq === 2,
    ),
    reason: 'ChatDetail should seed WebSocket catch-up from the max seq in the initial page',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: (useWebSocket as jest.Mock).mock.calls.some(
      ([options]) => options.catchUpAfterSeq === 0,
    ),
    reason: 'catchUpAfterSeq=0 would request legacy full history on first socket open',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Older pagination request: a user-driven top scroll should fetch the page
/// before the first loaded seq with the configured older-page limit.
///
/// Data construction:
///   latest page first seq = 11
///   older page cursor     = before_seq 11
///   older page limit      = 30 messages
///
/// Execution process:
///   1. Render ChatDetailScreen and wait for latest seq 11.
///   2. Mark the scroll as user-driven with onScrollBeginDrag.
///   3. Fire a top scroll and inspect the older fetch call.
///
/// Expected result:
///   - Positive: older response renders after the top scroll.
///   - Positive: before_seq 11 is requested with limit 30.
///   - Negative: the old 50-row older limit is not used.
test('loads older messages before the first loaded seq when scrolled near the top', async () => {
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'older response' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });

  await waitFor(() => expect(getByText('older response')).toBeTruthy());
  expect({
    actual: (fetchMessages as jest.Mock).mock.calls.some(
      ([baseUrl, token, convId, options]) =>
        baseUrl === 'http://localhost:8080' &&
        token === 'token' &&
        convId === 'conv-1' &&
        options?.before_seq === 11 &&
        options?.limit === 30,
    ),
    reason: 'older history request should use before_seq 11 and the new 30-message limit',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: (fetchMessages as jest.Mock).mock.calls.some(
      ([, , , options]) => options?.before_seq === 11 && options?.limit === 50,
    ),
    reason: 'older history request must not use the previous 50-message limit',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Older prepend anchor restore: when the user is reading history away from the
/// bottom, a content-size change from older pagination must keep the first
/// visible display item anchored instead of jumping to the newest message.
///
/// Data construction:
///   latest page = seq 11, 12, 13
///   anchor visible item = seq 12, expected display key "message-12"
///   older page before_seq 11 returns seq 10
///   after prepend, visible display order = 10, 11, 12, 13, so anchor index = 2
///
/// Execution process:
///   1. Render ChatDetailScreen and wait for latest seq 11..13.
///   2. Mark a user drag and emit a scroll where distanceFromBottom is large.
///   3. Record seq 12 through FlatList.onViewableItemsChanged.
///   4. Let older seq 10 prepend, then trigger FlatList.onContentSizeChange.
///
/// Expected result:
///   - Positive: scrollToIndex restores the anchored display row at index 2.
///   - Negative: content-size handling does not call scrollToEnd while away from bottom.
test('restores the first visible display item after older prepend while away from bottom', async () => {
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  try {
    (fetchMessages as jest.Mock).mockImplementation(
      (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
        if (options?.before_seq === 11) {
          return Promise.resolve([
            {
              type: 'message',
              seq: 10,
              role: 'agent_text',
              payload: { text: 'older anchor response' },
              created_at: 10,
            },
          ]);
        }
        return Promise.resolve([
          {
            type: 'message',
            seq: 11,
            role: 'user_text',
            payload: { text: 'latest anchor prompt' },
            created_at: 11,
          },
          {
            type: 'message',
            seq: 12,
            role: 'agent_text',
            payload: { text: 'visible anchor row' },
            created_at: 12,
          },
          {
            type: 'message',
            seq: 13,
            role: 'agent_text',
            payload: { text: 'below anchor row' },
            created_at: 13,
          },
        ]);
      },
    );
    const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

    await waitFor(() => expect(getByText('visible anchor row')).toBeTruthy());
    scrollToIndexSpy.mockClear();
    scrollToEndSpy.mockClear();

    await act(async () => {
      const list = UNSAFE_getByType(FlatList);
      list.props.onScrollBeginDrag?.({ nativeEvent: {} });
      list.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 200 },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 1600 },
        },
      });
      list.props.onViewableItemsChanged?.({
        viewableItems: [{ item: list.props.data[1], index: 1, isViewable: true }],
        changed: [],
      });
    });

    await waitFor(() => expect(getByText('older anchor response')).toBeTruthy());
    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 1800);
    });

    expect({
      actual: scrollToIndexSpy.mock.calls.some(
        ([args]) => args.index === 2 && args.animated === false && args.viewPosition === 0,
      ),
      reason: 'older prepend should restore the recorded first visible display item at index 2',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: scrollToEndSpy.mock.calls.length,
      reason: 'away-from-bottom older prepend must not jump to the newest transcript row',
    }).toEqual({ actual: 0, reason: expect.any(String) });
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
  }
});

/// Focus ask plus older prepend anchor restore: a deep-linked ask must not block
/// away-from-bottom anchor restoration after older history is prepended.
///
/// Data construction:
///   route focus_ask_id = "ask-anchor"
///   latest page = seq 11 user, seq 12 ask-anchor, seq 13 agent
///   anchor visible item = seq 13, expected display key "message-13"
///   older page before_seq 11 returns seq 10
///   after prepend, visible display order = 10, 11, 12, 13, so anchor index = 3
///
/// Execution process:
///   1. Render ChatDetailScreen with focus_ask_id and wait for the ask row.
///   2. Let the initial focus scroll complete, then clear scroll spies.
///   3. Mark a user drag and emit a scroll where distanceFromBottom is large.
///   4. Record seq 13 through FlatList.onViewableItemsChanged.
///   5. Let older seq 10 prepend, then trigger FlatList.onContentSizeChange.
///
/// Expected result:
///   - Positive: scrollToIndex restores the anchored display row at index 3.
///   - Negative: focus_ask_id does not suppress away-from-bottom anchor restoration.
///   - Negative: content-size handling does not call scrollToEnd while away from bottom.
test('restores older prepend anchor while focus ask is already visible', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-anchor',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  try {
    (fetchMessages as jest.Mock).mockImplementation(
      (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
        if (options?.before_seq === 11) {
          return Promise.resolve([
            {
              type: 'message',
              seq: 10,
              role: 'agent_text',
              payload: { text: 'older focused anchor response' },
              created_at: 10,
            },
          ]);
        }
        return Promise.resolve([
          {
            type: 'message',
            seq: 11,
            role: 'user_text',
            payload: { text: 'focused anchor prompt' },
            created_at: 11,
          },
          {
            type: 'message',
            seq: 12,
            role: 'ask_question',
            payload: {
              ask_id: 'ask-anchor',
              allow_freeform: false,
              questions: [{ id: '0', text: 'Choose?', options: [{ id: 'yes', label: 'Yes' }] }],
            },
            created_at: 12,
          },
          {
            type: 'message',
            seq: 13,
            role: 'agent_text',
            payload: { text: 'focused visible anchor row' },
            created_at: 13,
          },
        ]);
      },
    );
    const { UNSAFE_getByType, getByTestId, getByText } = render(<ChatDetailScreen />);

    await waitFor(() => expect(getByTestId('chat-ask-ask-anchor')).toBeTruthy());
    await waitFor(() =>
      expect({
        actual: scrollToIndexSpy.mock.calls.some(
          ([args]) => args.index === 1 && args.animated === true,
        ),
        reason: 'initial focus_ask_id should scroll to the visible ask row at index 1',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );
    scrollToIndexSpy.mockClear();
    scrollToEndSpy.mockClear();

    await act(async () => {
      const list = UNSAFE_getByType(FlatList);
      list.props.onScrollBeginDrag?.({ nativeEvent: {} });
      list.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 200 },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 1600 },
        },
      });
      list.props.onViewableItemsChanged?.({
        viewableItems: [{ item: list.props.data[2], index: 2, isViewable: true }],
        changed: [],
      });
    });

    await waitFor(() => expect(getByText('older focused anchor response')).toBeTruthy());
    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 1800);
    });

    expect({
      actual: scrollToIndexSpy.mock.calls.some(
        ([args]) => args.index === 3 && args.animated === false && args.viewPosition === 0,
      ),
      reason:
        'focus_ask_id must not block restoring the recorded visible display item after older prepend',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: scrollToEndSpy.mock.calls.length,
      reason: 'away-from-bottom focused older prepend must not jump to the newest row',
    }).toEqual({ actual: 0, reason: expect.any(String) });
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
  }
});

/// Top-load threshold: user upward scroll should start older pagination before
/// reaching the absolute top of the transcript.
///
/// Data construction:
///   latest page first seq = 11
///   new threshold         = 300 px
///   y = 301 px            = just outside loading range
///   y = 299 px            = just inside loading range
///
/// Execution process:
///   1. Render ChatDetailScreen and wait for the latest prompt.
///   2. Mark the gesture as user-driven with onScrollBeginDrag.
///   3. Fire scroll at y=301 and verify no older request.
///   4. Fire scroll at y=299 and verify older request starts.
///
/// Expected result:
///   - Positive: before_seq 11 is requested once at y=299 with limit 30.
///   - Negative: y=301 does not request older history.
test('starts older pagination when user scrolls within the 300px top threshold', async () => {
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'older threshold response' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest threshold prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest threshold prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 301 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });
  expect({
    actual: (fetchMessages as jest.Mock).mock.calls.some(
      ([, , , options]) => options?.before_seq === 11,
    ),
    reason: 'scroll y=301 is outside the 300px threshold and must not request older messages',
  }).toEqual({ actual: false, reason: expect.any(String) });

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 299 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() => expect(getByText('older threshold response')).toBeTruthy());
  const beforeSeqCalls = (fetchMessages as jest.Mock).mock.calls.filter(
    ([, , , options]) => options?.before_seq === 11,
  );
  expect({
    actual: beforeSeqCalls.length,
    reason: 'scroll y=299 should start exactly one older-page request',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: beforeSeqCalls[0]?.[3],
    reason: 'older-page request should use before_seq 11 and the new 30-row limit',
  }).toEqual({ actual: { before_seq: 11, limit: 30 }, reason: expect.any(String) });
});

test('does not repeatedly fetch the same older page when the first seq is unchanged', async () => {
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return Promise.resolve([
          {
            type: 'message',
            seq: 11,
            role: 'user_text',
            payload: { text: 'latest prompt' },
            created_at: 11,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });

  const duplicateBeforeSeqCalls = (fetchMessages as jest.Mock).mock.calls.filter(
    ([, , , options]) => options?.before_seq === 11,
  );
  expect(duplicateBeforeSeqCalls).toHaveLength(1);
});

/// Older pagination retry: a failed page request should not consume its
/// before_seq guard.
///
/// Data construction:
///   Latest page first seq = 11.
///   First older request before_seq = 11 rejects with a temporary error.
///   Second older request before_seq = 11 returns seq 10.
///
/// Execution process:
///   1. Render the latest page containing seq 11.
///   2. Trigger top scroll once -> older fetch rejects.
///   3. Trigger top scroll again -> same before_seq is allowed to retry.
///
/// Expected result:
///   - Positive assertion: "retried older response" renders after retry.
///   - Positive assertion: fetchMessages is called twice with before_seq 11.
///   - Negative assertion: the duplicate guard must not permanently block retry.
test('retries the same older page after a transient fetch failure', async () => {
  let olderAttempts = 0;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        olderAttempts += 1;
        if (olderAttempts === 1) return Promise.reject(new Error('temporary older page failure'));
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'retried older response' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });

  await waitFor(() => expect(getByText('retried older response')).toBeTruthy());
  const retryCalls = (fetchMessages as jest.Mock).mock.calls.filter(
    ([, , , options]) => options?.before_seq === 11,
  );
  expect(retryCalls).toHaveLength(2);
});

/// Older loading UI: a network older-page request should show the top loading
/// indicator while pending and hide it after the messages are prepended.
///
/// Data construction:
///   latest page first seq = 11
///   older request before_seq = 11 remains pending until the test resolves it
///   loading UI test id = older-messages-loading
///
/// Execution process:
///   1. Render latest page.
///   2. Start a user top-scroll older request.
///   3. Assert loading indicator is visible before resolving the request.
///   4. Resolve with seq 10 and wait for prepend.
///
/// Expected result:
///   - Positive: loading indicator appears while request is pending.
///   - Positive: older response renders after resolve.
///   - Negative: loading indicator disappears after resolve.
test('shows and hides the older loading indicator around network pagination', async () => {
  let resolveOlder: ((messages: WsMessage[]) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest loading prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText, getByTestId, queryByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest loading prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() =>
    expect({
      actual: getByTestId('older-messages-loading') != null,
      reason: 'pending older network request should render the top loading indicator',
    }).toEqual({ actual: true, reason: expect.any(String) }),
  );
  await act(async () => {
    resolveOlder?.([
      {
        type: 'message',
        seq: 10,
        role: 'agent_text',
        payload: { text: 'older loaded after spinner' },
        created_at: 10,
      },
    ]);
  });

  await waitFor(() => expect(getByText('older loaded after spinner')).toBeTruthy());
  await waitFor(() =>
    expect({
      actual: queryByTestId('older-messages-loading'),
      reason: 'older loading indicator must disappear after a successful prepend',
    }).toEqual({ actual: null, reason: expect.any(String) }),
  );
});

/// Older loading failure: failed older-page requests should clear the loading
/// indicator and keep the existing retry behavior.
///
/// Data construction:
///   latest page first seq = 11
///   first older request rejects
///   second older request resolves with seq 10
///
/// Execution process:
///   1. Render latest page.
///   2. Trigger top-scroll request and let it reject.
///   3. Verify loading disappears.
///   4. Trigger top-scroll again and verify retry can load seq 10.
///
/// Expected result:
///   - Positive: loading indicator appears during the failed request.
///   - Positive: retry renders the older message.
///   - Negative: failed request does not leave loading stuck on screen.
test('clears the older loading indicator after pagination failure and still retries', async () => {
  let olderAttempts = 0;
  let rejectFirstOlder: ((error: Error) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        olderAttempts += 1;
        if (olderAttempts === 1) {
          return new Promise((_resolve, reject) => {
            rejectFirstOlder = reject;
          });
        }
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'older retry after loading failure' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest failure prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText, getByTestId, queryByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest failure prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });
  await waitFor(() => expect(getByTestId('older-messages-loading')).toBeTruthy());
  await act(async () => {
    rejectFirstOlder?.(new Error('temporary older failure'));
  });
  await waitFor(() =>
    expect({
      actual: queryByTestId('older-messages-loading'),
      reason: 'failed older request must clear loading before retry',
    }).toEqual({ actual: null, reason: expect.any(String) }),
  );

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() => expect(getByText('older retry after loading failure')).toBeTruthy());
  expect({
    actual: olderAttempts,
    reason: 'same before_seq must remain retryable after a transient failure',
  }).toEqual({ actual: 2, reason: expect.any(String) });
});

/// Cached raw history no longer drives older pagination. Older loading should
/// start only after the server transcript page has established an oldest turn.
///
/// Data construction:
///   cached store rows = seq 1..60
///   transcript request = unresolved, so no oldest_turn_id is available
///
/// Execution process:
///   1. Seed chatStore with 60 cached rows and keep transcript-turns pending.
///   2. Trigger user top-scroll.
///   3. Verify cached rows are not expanded and no older request starts.
///
/// Expected result:
///   - Positive: no older loading indicator is rendered.
///   - Negative: cached seq 6 is not visible.
///   - Negative: no beforeTurn request is made without server metadata.
test('does not expand cached raw rows as older transcript history', async () => {
  useChatStore.setState((state) => ({
    ...state,
    messages: { 'conv-1': makeNumberedMessages(1, 60) },
  }));
  (fetchTranscriptTurns as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const { UNSAFE_getByType, queryByTestId, queryByText } = render(<ChatDetailScreen />);

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 1400 },
      },
    });
  });

  expect({
    actual: queryByTestId('older-messages-loading'),
    reason: 'cached raw rows must not start the older transcript loader',
  }).toEqual({ actual: null, reason: expect.any(String) });
  expect({
    actual: queryByText('cached message 6'),
    reason: 'cached raw rows must not become transcript rows before server metadata',
  }).toEqual({ actual: null, reason: expect.any(String) });
  expect({
    actual: (fetchTranscriptTurns as jest.Mock).mock.calls.some(
      ([, , , options]) => options?.beforeTurn != null,
    ),
    reason: 'older transcript requests require an oldest_turn_id from the server',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Older loading lifecycle: a stale transcript request from a previous route
/// must not block a newer route from starting its own older turn request.
///
/// Data construction:
///   conv-1 cached store rows = seq 1..60, transcript request remains pending
///   route then changes to conv-2 before that RAF fires
///   conv-2 latest page first seq = 11
///   conv-2 older request before_turn = turn-11 remains pending
///
/// Execution process:
///   1. Trigger conv-1 top scroll while its transcript request is pending.
///   2. Rerender the route as conv-2 and wait for its latest page.
///   3. Start a conv-2 network older request.
///
/// Expected result:
///   - Positive: conv-2 network older request shows the loading indicator.
///   - Positive: conv-2 before_turn turn-11 request is pending.
///   - Negative: conv-1 cached raw history never starts an older request.
test('starts a newer route older loader after a stale transcript route reset', async () => {
  useChatStore.setState((state) => ({
    ...state,
    conversations: [
      ...state.conversations,
      {
        id: 'conv-2',
        agent_id: 'agent-1',
        title: 'Second Chat',
        created_at: 0,
        last_message_at: 0,
        status: 'idle',
        endpoint_id: 'endpoint-1',
        agent_name: 'Agent',
      },
    ],
    messages: { 'conv-1': makeNumberedMessages(1, 60) },
  }));
  let resolveConv2Older: ((messages: WsMessage[]) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, convId: string, options?: { before_seq?: number }) => {
      if (convId === 'conv-2' && options?.before_seq === 11) {
        return new Promise((resolve) => {
          resolveConv2Older = resolve;
        });
      }
      if (convId === 'conv-2') {
        return Promise.resolve([
          {
            type: 'message',
            seq: 11,
            role: 'user_text',
            payload: { text: 'conv two latest prompt' },
            created_at: 11,
          },
        ]);
      }
      return new Promise(() => {});
    },
  );
  const { UNSAFE_getByType, getByTestId, getByText, queryByTestId, rerender } = render(
    <ChatDetailScreen />,
  );

  try {
    await act(async () => {
      UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
      UNSAFE_getByType(FlatList).props.onScroll({
        nativeEvent: {
          contentOffset: { y: 0 },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 1400 },
        },
      });
    });
    expect({
      actual: queryByTestId('older-messages-loading'),
      reason: 'conv-1 cached raw history must not start older loading before transcript metadata',
    }).toEqual({ actual: null, reason: expect.any(String) });
    expect({
      actual: (fetchTranscriptTurns as jest.Mock).mock.calls.some(
        ([, , convId, options]) => convId === 'conv-1' && options?.beforeTurn != null,
      ),
      reason: 'conv-1 should not request older turns without an oldest_turn_id',
    }).toEqual({ actual: false, reason: expect.any(String) });

    mockSearchParams = { id: 'conv-2', endpoint_id: 'endpoint-1' };
    rerender(<ChatDetailScreen />);
    await waitFor(() => expect(getByText('conv two latest prompt')).toBeTruthy());
    await act(async () => {
      UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
      UNSAFE_getByType(FlatList).props.onScroll({
        nativeEvent: {
          contentOffset: { y: 0 },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 900 },
        },
      });
    });

    expect({
      actual: typeof resolveConv2Older,
      reason: 'conv-2 older network request should remain pending while loader is visible',
    }).toEqual({ actual: 'function', reason: expect.any(String) });
    expect({
      actual: getByTestId('older-messages-loading') != null,
      reason: 'conv-2 network request should show the current older loading indicator',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: queryByTestId('older-messages-loading') != null,
      reason: 'stale conv-1 route must not clear the newer conv-2 network loader',
    }).toEqual({ actual: true, reason: expect.any(String) });
  } finally {
    jest.useRealTimers();
  }
});

/// Older pagination stale completion: ignored older results must still release
/// the loader so the current route generation can fetch older pages again.
///
/// Data construction:
///   Latest page first seq = 11.
///   First older request before_seq = 11 remains pending.
///   Route agent_name changes, which starts a new history generation.
///   Stale older request resolves with seq 9 and must be ignored.
///   Later older request before_seq = 11 returns seq 10 for the current generation.
///
/// Execution process:
///   1. Render latest page, then trigger a top scroll to start older request #1.
///   2. Change route agent_name and rerender to invalidate the older request generation.
///   3. Resolve stale older request #1, then trigger top scroll again.
///
/// Expected result:
///   - Positive assertion: "fresh older after stale" renders after the second top scroll.
///   - Positive assertion: before_seq 11 is requested twice.
///   - Negative assertion: "stale older ignored" does not render.
test('allows older pagination after a stale older request completes', async () => {
  let olderAttempts = 0;
  let resolveStaleOlder: ((messages: WsMessage[]) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        olderAttempts += 1;
        if (olderAttempts === 1)
          return new Promise((resolve) => {
            resolveStaleOlder = resolve;
          });
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'fresh older after stale' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText, queryByText, rerender } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });
  await waitFor(() => expect(olderAttempts).toBe(1));

  mockSearchParams = { id: 'conv-1', endpoint_id: 'endpoint-1', agent_name: 'Renamed Agent' };
  rerender(<ChatDetailScreen />);
  await waitFor(() =>
    expect(
      (fetchMessages as jest.Mock).mock.calls.filter(([, , , options]) => options?.limit === 25),
    ).toHaveLength(2),
  );

  await act(async () => {
    resolveStaleOlder?.([
      {
        type: 'message',
        seq: 9,
        role: 'agent_text',
        payload: { text: 'stale older ignored' },
        created_at: 9,
      },
    ]);
  });
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 800 },
      },
    });
  });

  await waitFor(() => expect(getByText('fresh older after stale')).toBeTruthy());
  expect(
    (fetchMessages as jest.Mock).mock.calls.filter(([, , , options]) => options?.before_seq === 11),
  ).toHaveLength(2);
  expect(queryByText('stale older ignored')).toBeNull();
});

test('shows the current agent name in the header', async () => {
  const { getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('Agent')).toBeTruthy());
});

/// Deep-linked model switch: selecting a model from the composer still works
/// when ChatDetail was opened from Activity/notification and the conversation
/// row is not in store yet.
///
/// Data construction:
///   route conv_id   = "conv-1"（Activity/notification only passes the id）
///   route agent_id  = "agent-1"（enough to load runtime model capabilities）
///   store convs     = []（conversation metadata has not been seeded）
///   model option    = "gpt-5.3-codex"（concrete Codex model）
///
/// Execution process:
///   1. Render ChatDetailScreen with route params but no stored conversation.
///   2. Wait for runtime models to load and open the selector from the composer model chip.
///   3. Press the concrete "Codex 5.3" row and accept the warning.
///
/// Expected result:
///   - Positive: switchConversationModel is called for conv-1 with "gpt-5.3-codex".
///   - Positive: the returned conversation is inserted into chatStore.
///   - Negative: the selection must not silently stop because conversation was missing locally.
test('switches model from a deep-linked chat without a seeded conversation row', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    agent_id: 'agent-1',
    agent_name: 'Agent',
  };
  useChatStore.setState({ conversations: [], messages: {} });
  (fetchRuntimeModels as jest.Mock).mockResolvedValue([
    { id: 'default', label: 'Default', is_default: true, source: 'builtin', available: true },
    {
      id: 'gpt-5.3-codex',
      label: 'Codex 5.3',
      is_default: false,
      source: 'builtin',
      available: true,
    },
  ]);
  const switched = {
    id: 'conv-1',
    agent_id: 'agent-1',
    title: 'Existing Chat',
    created_at: 0,
    last_message_at: 3,
    status: 'completed' as const,
    model_id: 'gpt-5.3-codex',
    endpoint_id: 'endpoint-1',
    agent_name: 'Agent',
  };
  (switchConversationModel as jest.Mock).mockResolvedValue(switched);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.[1]?.onPress?.();
  });

  const { getByTestId, getByText } = render(<ChatDetailScreen />);

  await waitFor(() =>
    expect({
      actual: (fetchRuntimeModels as jest.Mock).mock.calls.length > 0,
      reason: 'route agent_id should be enough to load runtime models for a deep link',
    }).toEqual({ actual: true, reason: expect.any(String) }),
  );
  fireEvent.press(getByTestId('composer-model-chip'));
  await waitFor(() => expect(getByText('Codex 5.3')).toBeTruthy());
  fireEvent.press(getByText('Codex 5.3'));

  await waitFor(() =>
    expect({
      actual: (switchConversationModel as jest.Mock).mock.calls.some(
        (call) =>
          call[0] === 'http://localhost:8080' &&
          call[1] === 'token' &&
          call[2] === 'conv-1' &&
          call[3] === 'endpoint-1' &&
          call[4] === 'Agent' &&
          call[5] === 'gpt-5.3-codex',
      ),
      reason: 'selecting a concrete row must PATCH even when conversation is not locally cached',
    }).toEqual({ actual: true, reason: expect.any(String) }),
  );
  expect({
    actual: useChatStore.getState().conversations.some((conv) => conv.id === 'conv-1'),
    reason: 'successful PATCH should seed the missing conversation row for future updates',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: (switchConversationModel as jest.Mock).mock.calls.length,
    reason: 'missing local conversation must not make model selection a silent no-op',
  }).not.toEqual({ actual: 0, reason: expect.any(String) });
});

test('updates the status badge when conversation metadata changes', async () => {
  const { getByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByTestId('status-badge-text').props.children).toBe('IDLE'));

  act(() => {
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === 'conv-1' ? { ...conv, status: 'running' } : conv,
      ),
    }));
  });

  await waitFor(() => expect(getByTestId('status-badge-text').props.children).toBe('RUNNING'));
});

test('syncs stale running badge from task_status embedded in fetched history', async () => {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conv) =>
      conv.id === 'conv-1' ? { ...conv, status: 'running' } : conv,
    ),
  }));
  (fetchMessages as jest.Mock).mockResolvedValue([
    ...historyMessages,
    {
      type: 'message',
      seq: 99,
      role: 'task_status',
      payload: {
        task_id: 'conv-1',
        status: 'completed',
        importance: 'normal',
        summary: '',
      },
      created_at: 99,
    },
  ]);
  const { getByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => {
    expect(getByTestId('status-badge-text').props.children).toBe('COMPLETED');
  });

  await waitFor(() => {
    expect(useChatStore.getState().conversations.find((c) => c.id === 'conv-1')?.status).toBe(
      'completed',
    );
  });
});

test('animates the next agent text after sending a message', async () => {
  (fetchMessages as jest.Mock).mockResolvedValue([]);
  const { getByTestId, getByText } = render(<ChatDetailScreen />);

  await act(async () => {
    fireEvent.changeText(getByTestId('message-input'), 'scan');
  });
  await act(async () => {
    fireEvent.press(getByTestId('send-btn'));
  });

  act(() => {
    useChatStore.getState().setMessages('conv-1', [
      {
        type: 'message',
        seq: 1,
        role: 'user_text',
        payload: { text: 'scan' },
        created_at: 1,
      },
      {
        type: 'message',
        seq: 2,
        role: 'agent_text',
        payload: { text: 'new response' },
        created_at: 2,
      },
    ]);
  });

  await waitFor(() => expect(getByText('new response [typewriter]')).toBeTruthy());
});

test('animates agent text that arrives after initial history is loaded', async () => {
  const { getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('historical response')).toBeTruthy());

  act(() => {
    useChatStore.getState().setMessages('conv-1', [
      ...historyMessages,
      {
        type: 'message',
        seq: 3,
        role: 'agent_text',
        payload: { text: 'fresh websocket response' },
        created_at: 3,
      },
    ]);
  });

  await waitFor(() => expect(getByText('fresh websocket response [typewriter]')).toBeTruthy());
});

test('mirrors unanswered historical ask_question messages to inbox', async () => {
  const askMessage: WsMessage = {
    type: 'message',
    seq: 3,
    role: 'ask_question',
    payload: {
      ask_id: 'ask-1',
      allow_freeform: false,
      questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
    },
    created_at: 3,
  };
  (fetchMessages as jest.Mock).mockResolvedValue([askMessage]);

  render(<ChatDetailScreen />);

  await waitFor(() =>
    expect(useInboxStore.getState().items[0]).toMatchObject({
      id: 'ask-1',
      kind: 'pending_question',
      body: 'Deploy now?',
    }),
  );
});

test('fetches an around_ask_id window when focus_ask_id is outside the latest page', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-focus',
  };
  const askMessage: WsMessage = {
    type: 'message',
    seq: 3,
    role: 'ask_question',
    payload: {
      ask_id: 'ask-focus',
      allow_freeform: false,
      questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
    },
    created_at: 3,
  };
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { around_ask_id?: string }) => {
      if (options?.around_ask_id === 'ask-focus') return Promise.resolve([askMessage]);
      return Promise.resolve([
        {
          type: 'message',
          seq: 50,
          role: 'agent_text',
          payload: { text: 'latest page only' },
          created_at: 50,
        },
      ]);
    },
  );

  const { getByTestId, queryByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByTestId('chat-ask-ask-focus')).toBeTruthy());
  expect(queryByText('latest page only')).toBeNull();
  expect(fetchTranscriptTurns).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
    limit: 20,
    aroundAskId: 'ask-focus',
  });
});

/// Focus ask routing: Chat Detail must keep `focus_ask_id` behavior for
/// Activity and notification entries that deep-link to a pending decision.
///
/// Data construction:
///   route id = 'conv-1'
///   route focus_ask_id = 'ask-focus'
///   loaded ask seq = 3, index = 0 in FlatList data
///
/// Execution process:
///   1. Render ChatDetailScreen with focus_ask_id in route params.
///   2. Load history containing one ask_question with ask_id='ask-focus'.
///   3. Wait for the focused ask wrapper to render.
///
/// Expected result:
///   - Positive: focused ask wrapper exists, so the route id matched a Chat card.
///   - Positive: FlatList.scrollToIndex is called with index=0, proving focus scroll remains wired.
///   - Positive: the initial transcript request uses aroundAskId as the server focus cursor.
test('scrolls to focus_ask_id after focused ask row lays out', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-focus',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
    scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  const scrollToOffsetSpy = jest.spyOn(flatListPrototype, 'scrollToOffset').mockImplementation();
  try {
    const askMessage: WsMessage = {
      type: 'message',
      seq: 3,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-focus',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
      },
      created_at: 3,
    };
    (fetchMessages as jest.Mock).mockResolvedValue([
      { type: 'message', seq: 1, role: 'agent_text', payload: { text: 'first' }, created_at: 1 },
      { type: 'message', seq: 2, role: 'user_text', payload: { text: 'second' }, created_at: 2 },
      askMessage,
    ]);

    const { UNSAFE_getByType, getByTestId } = render(<ChatDetailScreen />);

    await waitFor(() =>
      expect({
        actual: getByTestId('chat-ask-ask-focus') != null,
        reason: 'focused ask wrapper should render for the route focus_ask_id',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );

    expect({
      actual: scrollToIndexSpy.mock.calls.some(
        ([args]) => args.index === 2 && args.animated === true,
      ),
      reason: 'focus_ask_id should scroll to the matching FlatList item index',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: (fetchTranscriptTurns as jest.Mock).mock.calls.some(
        ([, , , options]) => options?.aroundAskId === 'ask-focus',
      ),
      reason: 'focus_ask_id should be sent to the server transcript focus cursor',
    }).toEqual({ actual: true, reason: expect.any(String) });

    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 640);
    });
    expect({
      actual: scrollToEndSpy.mock.calls.length,
      reason: 'focus_ask_id scroll must not be overridden by same-pass scrollToEnd',
    }).toEqual({ actual: 0, reason: expect.any(String) });

    const callsBeforeFailedRetry = scrollToIndexSpy.mock.calls.length;
    jest.useFakeTimers();
    act(() => {
      UNSAFE_getByType(FlatList).props.onScrollToIndexFailed({
        index: 2,
        averageItemLength: 72,
      });
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    expect({
      actual: scrollToEndSpy.mock.calls.length,
      reason: 'focus_ask_id failed index scroll must retry focus instead of scrolling to end',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect(scrollToOffsetSpy).toHaveBeenCalledWith({ offset: 144, animated: false });
    expect({
      actual: scrollToIndexSpy.mock.calls.length > callsBeforeFailedRetry,
      reason: 'focus_ask_id failed index scroll should retry scrollToIndex for the target',
    }).toEqual({ actual: true, reason: expect.any(String) });
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
    scrollToOffsetSpy.mockRestore();
    jest.useRealTimers();
  }
});

/// Route reuse scroll state: changing conversations without changing
/// focus_ask_id must reset the scroll hook's focus and anchor refs.
///
/// Data construction:
///   conv-1 focus_ask_id = "ask-shared", ask row index = 1
///   conv-1 user scroll y = 200, content height = 1600, viewport = 400
///     distanceFromBottom = 1600 - (200 + 400) = 1000 > sticky threshold, so not near bottom
///   conv-1 first visible display item = seq 1, key "message-1"
///   conv-2 focus_ask_id = "ask-shared", ask row index = 0
///
/// Execution process:
///   1. Render conv-1 and wait for ask-shared to scroll at index 1.
///   2. Record a non-bottom scroll plus a visible anchor in conv-1.
///   3. Rerender the same route component as conv-2 with the same focus_ask_id.
///   4. Wait for conv-2 ask-shared and inspect FlatList scroll calls.
///
/// Expected result:
///   - Positive: conv-2 performs a fresh focus scroll to index 0.
///   - Negative: conv-2 focus is not suppressed by conv-1's lastScrolledFocusAskIdRef.
test('resets focus and anchor scroll state when route changes with the same focus ask id', async () => {
  useChatStore.setState((state) => ({
    ...state,
    conversations: [
      ...state.conversations,
      {
        id: 'conv-2',
        agent_id: 'agent-1',
        title: 'Second Chat',
        created_at: 0,
        last_message_at: 0,
        status: 'idle',
        endpoint_id: 'endpoint-1',
        agent_name: 'Agent',
      },
    ],
  }));
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-shared',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  try {
    const askMessage = (seq: number): WsMessage => ({
      type: 'message',
      seq,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-shared',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
      },
      created_at: seq,
    });
    (fetchMessages as jest.Mock).mockImplementation(
      (_baseUrl: string, _token: string, convId: string) => {
        if (convId === 'conv-2') return Promise.resolve([askMessage(20)]);
        return Promise.resolve([
          {
            type: 'message',
            seq: 1,
            role: 'user_text',
            payload: { text: 'conv one' },
            created_at: 1,
          },
          askMessage(2),
        ]);
      },
    );

    const { UNSAFE_getByType, getByTestId, rerender } = render(<ChatDetailScreen />);

    await waitFor(() => expect(getByTestId('chat-ask-ask-shared')).toBeTruthy());
    await waitFor(() =>
      expect({
        actual: scrollToIndexSpy.mock.calls.some(
          ([args]) => args.index === 1 && args.animated === true,
        ),
        reason: 'conv-1 should perform the initial focus scroll before route reuse',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );

    await act(async () => {
      const list = UNSAFE_getByType(FlatList);
      list.props.onScrollBeginDrag?.({ nativeEvent: {} });
      list.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 200 },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 1600 },
        },
      });
      list.props.onViewableItemsChanged?.({
        viewableItems: [{ item: list.props.data[0], index: 0, isViewable: true }],
        changed: [],
      });
    });
    scrollToIndexSpy.mockClear();

    mockSearchParams = {
      id: 'conv-2',
      endpoint_id: 'endpoint-1',
      focus_ask_id: 'ask-shared',
    };
    rerender(<ChatDetailScreen />);

    await waitFor(() => expect(getByTestId('chat-ask-ask-shared')).toBeTruthy());
    await waitFor(() =>
      expect({
        actual: scrollToIndexSpy.mock.calls.some(
          ([args]) => args.index === 0 && args.animated === true,
        ),
        reason:
          'conv-2 with the same focus_ask_id must scroll again after route-change state reset',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );
  } finally {
    scrollToIndexSpy.mockRestore();
  }
});

test('renders composer plus button and upload image action in chat detail composer', () => {
  const { getByText, getByTestId, queryByTestId } = render(<ChatDetailScreen />);

  expect(getByTestId('composer-plus-btn')).toBeTruthy();
  expect(queryByTestId('composer-action-upload')).toBeNull();
  fireEvent.press(getByTestId('composer-plus-btn'));
  expect(getByText('Upload Image')).toBeTruthy();
  expect(getByTestId('composer-action-upload')).toBeTruthy();
});

/// Chat detail bottom edge: the screen-level safe area must not reserve bottom
/// inset space below the composer.
///
/// Data construction:
///   iOS home-indicator inset ≈ 34 px on common full-screen iPhones.
///   ChatInputBar already paints the bottom composer surface.
///   Applying SafeAreaView bottom edge would add ≈ 34 px of blank space under it.
///
/// Execution process:
///   1. Render ChatDetailScreen with the default conversation fixture.
///   2. Inspect the screen-level SafeAreaView edge list.
///
/// Expected result:
///   - Positive assertion: top edge should be present, so the header remains
///     protected from the notch/status bar.
///   - Negative assertion: bottom edge should be absent, otherwise the input
///     sits above a visible blank safe-area gap.
///   - Boundary assertion: the full edge list should be exactly top/left/right.
test('chat detail safe area excludes the bottom edge under the composer', () => {
  const { UNSAFE_getByType } = render(<ChatDetailScreen />);

  const safeArea = UNSAFE_getByType(SafeAreaView);

  expect(safeArea.props.edges).toContain(
    'top',
    'chat detail safe area must keep top protection for the header',
  );
  expect(safeArea.props.edges).not.toContain(
    'bottom',
    'chat detail safe area must not add bottom inset space under the composer',
  );
  expect(safeArea.props.edges).toEqual(
    ['top', 'left', 'right'],
    'chat detail safe area should protect only top and horizontal edges',
  );
});

test('uploads selected image and renders the sent image message with local uri', async () => {
  const { getByLabelText, getByTestId, getByText, queryByTestId } = render(<ChatDetailScreen />);

  await pickImageFromComposer(getByTestId);
  await waitFor(() => expect(queryByTestId('img-preview-row')).not.toBeNull());

  // Type text so the send button becomes visible
  await act(async () => {
    fireEvent.changeText(getByTestId('message-input'), 'send');
  });

  fireEvent.press(getByLabelText('Send message'));

  await waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith(
      'http://localhost:8080',
      'token',
      'conv-1',
      'send',
      'file-1',
    ),
  );

  act(() => {
    useChatStore.getState().setMessages('conv-1', [
      {
        type: 'message',
        seq: 5,
        role: 'user_text',
        payload: { text: '', file_id: 'file-1' },
        created_at: 5,
      },
    ]);
  });

  await waitFor(() => expect(getByText(' file:///compressed.jpg')).toBeTruthy());
});

describe('Analyzing… bubble — new conversation not pre-seeded in store', () => {
  // Regression: when navigating from Agents screen, the newly created conversation
  // was never added to chatStore.conversations.  updateConversation('running') was
  // therefore a no-op, a sync useEffect saw isAwaitingResponse=true but
  // conversationStatus='idle' and immediately reset isAwaitingResponse to false,
  // so the Analyzing… bubble never rendered.
  beforeEach(() => {
    useChatStore.setState({ conversations: [], messages: {} });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (postMessage as jest.Mock).mockImplementation(() => new Promise(() => {})); // never resolves
  });

  it('shows the Analyzing… waiting bubble after sending the first message', async () => {
    const { getByTestId, queryByText } = render(<ChatDetailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByTestId('send-btn'));
    });

    await waitFor(() => {
      expect(queryByText('waiting')).toBeTruthy();
    });
  });
});

describe('send/stop button', () => {
  beforeEach(() => {
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (postMessage as jest.Mock).mockImplementation(() => new Promise(() => {})); // never resolves
  });

  it('keeps stop icon visible even after an agent_text message arrives (race condition regression)', async () => {
    // Bug: isAwaitingResponse was reset to false as soon as ANY agent activity arrived,
    // even while the agent was still running. This caused the stop button to disappear
    // mid-run after the first agent_text message.
    //
    // The fix: stop-button visibility must remain until conversation.status
    // explicitly returns to non-running (idle / completed / failed).
    //
    // Scenario:
    //   1. User sends message → stop-btn appears
    //   2. Agent sends first agent_text (still running) → stop-btn MUST stay
    const { getByTestId } = render(<ChatDetailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByTestId('send-btn'));
    });

    await waitFor(() => expect(getByTestId('stop-btn')).toBeTruthy());

    // Simulate agent sending its first message while still running
    act(() => {
      useChatStore.getState().setMessages('conv-1', [
        { type: 'message', seq: 1, role: 'user_text', payload: { text: 'hello' }, created_at: 1 },
        {
          type: 'message',
          seq: 2,
          role: 'agent_text',
          payload: { text: 'thinking...' },
          created_at: 2,
        },
      ]);
      // conversation.status remains 'running' — agent has not finished
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === 'conv-1' ? { ...c, status: 'running' } : c,
        ),
      }));
    });

    // Stop button must still be visible — agent is still running
    await waitFor(() => {
      expect(getByTestId('stop-btn')).toBeTruthy();
    });
  });

  it('hides stop icon after conversation.status returns to idle (agent finished)', async () => {
    // After the agent finishes (status → idle / completed), the stop button should disappear.
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByTestId('send-btn'));
    });

    await waitFor(() => expect(getByTestId('stop-btn')).toBeTruthy());

    // Agent finishes — status returns to idle
    act(() => {
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === 'conv-1' ? { ...c, status: 'idle' } : c,
        ),
      }));
    });

    await waitFor(() => {
      expect(queryByTestId('stop-btn')).toBeNull();
    });
  });

  it('shows stop icon when isAwaitingResponse', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);

    // Initially no stop button
    expect(queryByTestId('stop-btn')).toBeNull();

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByTestId('send-btn'));
    });

    await waitFor(() => {
      expect(getByTestId('stop-btn')).toBeTruthy();
    });
  });

  it('calls abortConversation when stop button pressed', async () => {
    const { abortConversation } = require('@/features/chat/services/chatService');
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByTestId('send-btn'));
    });

    await waitFor(() => expect(getByTestId('stop-btn')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('stop-btn'));
    });

    await waitFor(() => {
      expect(abortConversation).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'conv-1',
      );
    });

    await waitFor(() => {
      expect(useChatStore.getState().conversations.find((c) => c.id === 'conv-1')?.status).toBe(
        'idle',
      );
    });
    await waitFor(() => {
      expect(queryByTestId('stop-btn')).toBeNull();
    });
  });
});

describe('Header status badge', () => {
  it('shows RUNNING badge when conversation.status is running', async () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-1',
          agent_id: 'agent-1',
          title: 'T',
          created_at: 1,
          last_message_at: 1,
          endpoint_id: 'endpoint-1',
          agent_name: 'Agent',
          status: 'running',
        },
      ],
      messages: {},
    });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('status-badge-text').props.children).toBe('RUNNING');
    });
  });

  it('shows AWAITING badge when conversation.status is awaiting_question', async () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-1',
          agent_id: 'agent-1',
          title: 'T',
          created_at: 1,
          last_message_at: 1,
          endpoint_id: 'endpoint-1',
          agent_name: 'Agent',
          status: 'awaiting_question',
        },
      ],
      messages: {},
    });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('status-badge-text').props.children).toBe('AWAITING');
    });
  });

  it('shows IDLE badge when conversation.status is idle', async () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-1',
          agent_id: 'agent-1',
          title: 'T',
          created_at: 1,
          last_message_at: 1,
          endpoint_id: 'endpoint-1',
          agent_name: 'Agent',
          status: 'idle',
        },
      ],
      messages: {},
    });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('status-badge-text').props.children).toBe('IDLE');
    });
  });
});

describe('multi-image upload', () => {
  beforeEach(() => {
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (uploadImage as jest.Mock).mockResolvedValue({ file_id: 'file-abc' });
    (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
      uri: 'compressed://img.jpg',
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://img.jpg' }],
    });
  });

  it('shows image preview row after selecting an image', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => expect(queryByTestId('img-preview-row')).toBeNull());

    await pickImageFromComposer(getByTestId);

    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).not.toBeNull();
    });
  });

  it('removes image when × badge tapped', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await pickImageFromComposer(getByTestId);
    await waitFor(() => expect(queryByTestId('img-preview-row')).not.toBeNull());

    await act(async () => {
      fireEvent.press(getByTestId('remove-img-0'));
    });
    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).toBeNull();
    });
  });

  it('does not add more than 5 images', async () => {
    /// 5 枚上限：第 6 次按 attach 时 Alert 被触发，图片数量不超过 5
    ///
    /// 执行过程：
    ///   1. 连续按 5 次 attach → 各上传成功 → remove-img-4 出现
    ///   2. 第 6 次按 attach → pickImage 早期 return，Alert 被调用
    ///
    /// 预期结果：
    ///   - Alert.alert 被调用，参数为 '最多选择 5 张图片'
    ///   - remove-img-5 不存在（第 6 张未被加入）
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);

    for (let i = 0; i < 5; i++) {
      await pickImageFromComposer(getByTestId);
    }
    await waitFor(() => expect(queryByTestId('remove-img-4')).toBeTruthy());

    const alertSpy = jest.spyOn(Alert, 'alert');
    await pickImageFromComposer(getByTestId);

    expect(alertSpy).toHaveBeenCalledWith('最多选择 5 张图片');
    expect(queryByTestId('remove-img-5')).toBeNull();

    alertSpy.mockRestore();
  });

  it('sends multiple images as separate messages', async () => {
    /// 多图逐条发送：2 张图 → postMessage 被调用 2 次，最后一次携带文字
    ///
    /// 数据构造：
    ///   - 第 1 次 uploadImage → file_id: 'file-1'（mockResolvedValueOnce）
    ///   - 第 2 次 uploadImage → file_id: 'file-2'（第 2 次 attach 前再 mock）
    ///   - input text: 'hello'
    ///
    /// 执行过程：
    ///   1. 清空 postMessage 的调用记录，防止 outer beforeEach 遗留
    ///   2. 第 1 次 attach → compressed → uploaded file-1
    ///   3. 重设 uploadImage mock → 第 2 次 attach → uploaded file-2
    ///   4. 等待 remove-img-1 出现（两张图均已 uploaded）
    ///   5. 输入 'hello'，点 Send
    ///   6. handleSend 遍历：i=0 → postMessage(…, '', 'file-1')
    ///                       i=1 → postMessage(…, 'hello', 'file-2')
    ///
    /// 预期结果：
    ///   - postMessage 共调用 2 次（不多不少）
    ///   - 最后一次：text='hello', file_id='file-2'

    // 清空外层 beforeEach 遗留的调用记录
    (postMessage as jest.Mock).mockClear();
    (uploadImage as jest.Mock).mockClear();

    (uploadImage as jest.Mock).mockResolvedValueOnce({ file_id: 'file-1' });

    const { getByTestId, getByLabelText } = render(<ChatDetailScreen />);

    await pickImageFromComposer(getByTestId);

    // 第 2 次 attach 前切换 mock
    (uploadImage as jest.Mock).mockResolvedValueOnce({ file_id: 'file-2' });
    await pickImageFromComposer(getByTestId);

    await waitFor(() => expect(getByTestId('remove-img-1')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Send message'));
    });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(2);
    });

    expect(postMessage).toHaveBeenLastCalledWith(
      'http://localhost:8080',
      'token',
      'conv-1',
      'hello',
      'file-2',
    );
  });
});
