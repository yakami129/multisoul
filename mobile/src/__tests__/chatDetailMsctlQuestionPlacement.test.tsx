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

function agentText(seq: number, text: string): WsMessage {
  return {
    type: 'message',
    seq,
    role: 'agent_text',
    payload: { text },
    created_at: seq,
  };
}

function askQuestion(
  seq: number,
  askId: string,
  text: string,
  responseMode?: 'user_message',
): WsMessage {
  return {
    type: 'message',
    seq,
    role: 'ask_question',
    payload: {
      ask_id: askId,
      allow_freeform: false,
      ...(responseMode ? { response_mode: responseMode } : {}),
      questions: [{ id: '0', text, options: [{ id: 'yes', label: 'Yes' }] }],
    },
    created_at: seq,
  };
}

function expectScrollToIndexCall(
  calls: Array<[params: { index: number; animated?: boolean; viewPosition?: number }]>,
  index: number,
  reason: string,
) {
  expectEqualWithReason(
    calls.some(
      ([args]) => args.index === index && args.animated === true && args.viewPosition === 0.1,
    ),
    true,
    reason,
  );
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
    agentText(1, 'first agent row'),
    askQuestion(2, 'ask-msctl', 'Pick one?', 'user_message'),
    askQuestion(3, 'ask-ordinary', 'Continue?'),
    agentText(4, 'later agent row'),
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

/// Chat Detail focus ask placement: focus scrolling must use the reordered
/// FlatList index after user-message-mode msctl ask cards move to the bottom.
///
/// Data construction:
///   route focus_ask_id = 'ask-msctl'
///   seq 1 = agent_text "first agent row"
///   seq 2 = ask_question ask-msctl with response_mode=user_message
///   seq 3 = agent_text "later agent row"
///   loaded window = 3 messages, all renderable transcript rows
///
/// Execution process:
///   1. Mock the initial Chat Detail history request with seq order [1, 2, 3].
///   2. Render ChatDetailScreen with focus_ask_id='ask-msctl'.
///   3. Wait until history reaches FlatList and msctl placement produces displayed order [1, 3, 2].
///   4. Inspect FlatList.scrollToIndex calls and trigger onContentSizeChange to catch bottom-scroll overrides.
///
/// Expected result:
///   - Positive: FlatList display seq order is [1, 3, 2].
///   - Positive: FlatList.scrollToIndex is called with index=2 for the displayed ask row.
///   - Negative: FlatList.scrollToIndex is not called with original index=1.
///   - Negative: FlatList.scrollToEnd is not called after focus scroll is available.
test('scrolls focus_ask_id to displayed msctl ask_question index after bottom placement', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-msctl',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  try {
    const loadedMessages: WsMessage[] = [
      agentText(1, 'first agent row'),
      askQuestion(2, 'ask-msctl', 'Pick one?', 'user_message'),
      agentText(3, 'later agent row'),
    ];
    (fetchMessages as jest.Mock).mockResolvedValue(loadedMessages);

    const { UNSAFE_getByType } = render(<ChatDetailScreen />);

    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
      expectEqualWithReason(
        data.map((message) => message.seq),
        [1, 3, 2],
        'focus_ask_id regression requires displayed FlatList order after msctl bottom placement',
      );
    });

    await waitFor(() => {
      expectScrollToIndexCall(
        scrollToIndexSpy.mock.calls,
        2,
        'focus_ask_id should scroll to displayed index 2 after msctl ask card moves to bottom',
      );
    });

    expectEqualWithReason(
      scrollToIndexSpy.mock.calls.some(([args]) => args.index === 1),
      false,
      'focus_ask_id must not scroll to original index 1 after displayed data is reordered',
    );

    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 640);
    });
    expectEqualWithReason(
      scrollToEndSpy.mock.calls.length,
      0,
      'focus_ask_id scroll must not be overridden by scrollToEnd after content size changes',
    );
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
  }
});

/// Chat Detail focus ask reroute: changing focus_ask_id on the same mounted
/// screen must scroll to the newly focused bottom-placed msctl ask.
///
/// Data construction:
///   initial route focus_ask_id = 'ask-one'
///   rerender route focus_ask_id = 'ask-two'
///   seq 1 = agent_text "first agent row"
///   seq 2 = ask_question ask-one with response_mode=user_message
///   seq 3 = ask_question ask-two with response_mode=user_message
///   seq 4 = agent_text "later agent row"
///   loaded window = 4 messages, reordered to displayed seq order [1, 4, 2, 3]
///   displayed ask-one index = 2, displayed ask-two index = 3
///
/// Execution process:
///   1. Render ChatDetailScreen with focus_ask_id='ask-one' and load the shared history.
///   2. Wait until msctl bottom placement produces displayed order [1, 4, 2, 3].
///   3. Trigger content size change so ask-one performs a focus scroll after initial reset effects.
///   4. Assert the first focus scroll targets displayed index 2 for ask-one.
///   5. Change mockSearchParams.focus_ask_id to 'ask-two' and rerender the same mounted screen.
///   6. Assert the second focus scroll targets displayed index 3 for ask-two.
///
/// Expected result:
///   - Positive: first focus scroll reaches ask-one's displayed index 2.
///   - Positive: second focus scroll reaches ask-two's displayed index 3 after rerender.
///   - Negative: scroll calls do not only contain the first focus target.
test('scrolls to a new focus_ask_id when the same mounted Chat Detail screen rerenders', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-one',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  try {
    const loadedMessages: WsMessage[] = [
      agentText(1, 'first agent row'),
      askQuestion(2, 'ask-one', 'Pick first?', 'user_message'),
      askQuestion(3, 'ask-two', 'Pick second?', 'user_message'),
      agentText(4, 'later agent row'),
    ];
    (fetchMessages as jest.Mock)
      .mockResolvedValueOnce(loadedMessages)
      .mockImplementation(() => new Promise<WsMessage[]>(() => {}));

    const { UNSAFE_getByType, rerender } = render(<ChatDetailScreen />);

    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
      expectEqualWithReason(
        data.map((message) => message.seq),
        [1, 4, 2, 3],
        'reroute regression requires the two msctl ask cards to have distinct displayed indexes',
      );
    });

    act(() => {
      UNSAFE_getByType(FlatList).props.onContentSizeChange(320, 640);
    });

    await waitFor(() => {
      expectScrollToIndexCall(
        scrollToIndexSpy.mock.calls,
        2,
        'initial focus_ask_id should scroll to ask-one at displayed index 2',
      );
    });
    const callsBeforeReroute = scrollToIndexSpy.mock.calls.length;

    mockSearchParams = {
      id: 'conv-1',
      endpoint_id: 'endpoint-1',
      focus_ask_id: 'ask-two',
    };
    rerender(<ChatDetailScreen />);

    await waitFor(() => {
      expectScrollToIndexCall(
        scrollToIndexSpy.mock.calls.slice(callsBeforeReroute),
        3,
        'rerendered focus_ask_id should scroll to ask-two at displayed index 3',
      );
    });

    expectEqualWithReason(
      scrollToIndexSpy.mock.calls.some(([args]) => args.index === 2),
      true,
      'regression setup must include the first focus scroll before checking the rerender',
    );
    expectEqualWithReason(
      scrollToIndexSpy.mock.calls.slice(callsBeforeReroute).some(([args]) => args.index === 3),
      true,
      'focus reroute must not only keep the first focus target after focus_ask_id changes',
    );
  } finally {
    scrollToIndexSpy.mockRestore();
  }
});

/// Chat Detail failed focus retry reroute: a delayed scroll retry from the old
/// focus_ask_id must not run after the mounted screen reroutes to a new ask.
///
/// Data construction:
///   initial route focus_ask_id = 'ask-one'
///   rerender route focus_ask_id = 'ask-two'
///   seq 1 = agent_text "first agent row"
///   seq 2 = ask_question ask-one with response_mode=user_message
///   seq 3 = ask_question ask-two with response_mode=user_message
///   seq 4 = agent_text "later agent row"
///   loaded window = 4 messages, reordered to displayed seq order [1, 4, 2, 3]
///   failed retry delay = 50ms; ask-one index = 2, ask-two index = 3
///
/// Execution process:
///   1. Render ChatDetailScreen with focus_ask_id='ask-one' and load [1, 2, 3, 4].
///   2. Wait for the initial focus scroll to ask-one at displayed index 2.
///   3. Enable fake timers and trigger onScrollToIndexFailed({ index: 2, averageItemLength: 72 }).
///   4. Rerender the same mounted screen with focus_ask_id='ask-two' before the 50ms retry fires.
///   5. Wait for the reroute focus scroll to ask-two at displayed index 3.
///   6. Run pending timers and inspect only the post-reroute scroll calls.
///
/// Expected result:
///   - Positive: ask-two index 3 is the latest focus target after pending timers run.
///   - Negative: no delayed post-reroute retry scrolls back to ask-one index 2.
test('does not run stale failed-scroll retry after focus_ask_id reroutes', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-one',
  };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  try {
    const loadedMessages: WsMessage[] = [
      agentText(1, 'first agent row'),
      askQuestion(2, 'ask-one', 'Pick first?', 'user_message'),
      askQuestion(3, 'ask-two', 'Pick second?', 'user_message'),
      agentText(4, 'later agent row'),
    ];
    (fetchMessages as jest.Mock)
      .mockResolvedValueOnce(loadedMessages)
      .mockImplementation(() => new Promise<WsMessage[]>(() => {}));

    const { UNSAFE_getByType, rerender } = render(<ChatDetailScreen />);

    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
      expectEqualWithReason(
        data.map((message) => message.seq),
        [1, 4, 2, 3],
        'stale retry regression requires ask-one and ask-two to have displayed indexes 2 and 3',
      );
    });

    await waitFor(() => {
      expectScrollToIndexCall(
        scrollToIndexSpy.mock.calls,
        2,
        'initial focus_ask_id should scroll to ask-one before scheduling a failed-scroll retry',
      );
    });

    jest.useFakeTimers();
    act(() => {
      UNSAFE_getByType(FlatList).props.onScrollToIndexFailed({
        index: 2,
        averageItemLength: 72,
      });
    });

    mockSearchParams = {
      id: 'conv-1',
      endpoint_id: 'endpoint-1',
      focus_ask_id: 'ask-two',
    };
    rerender(<ChatDetailScreen />);

    await waitFor(() => {
      expectScrollToIndexCall(
        scrollToIndexSpy.mock.calls,
        3,
        'rerendered focus_ask_id should scroll to ask-two before the old retry timer fires',
      );
    });
    const callsBeforeRetryTimers = scrollToIndexSpy.mock.calls.length;

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const callsAfterRetryTimers = scrollToIndexSpy.mock.calls.slice(callsBeforeRetryTimers);
    expectEqualWithReason(
      callsAfterRetryTimers.some(([args]) => args.index === 2),
      false,
      'old failed-scroll retry must not scroll back to ask-one index 2 after reroute to ask-two',
    );
    expectEqualWithReason(
      scrollToIndexSpy.mock.calls.at(-1)?.[0].index,
      3,
      'ask-two index 3 must remain the latest focus target after pending retry timers run',
    );
  } finally {
    jest.useRealTimers();
    scrollToIndexSpy.mockRestore();
  }
});
