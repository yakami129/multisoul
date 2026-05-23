import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchMessages, postMessage, uploadImage } from '@/features/chat/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import type { WsMessage } from '@/types';
import ChatDetailScreen from '../../app/chat/[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'conv-1', endpoint_id: 'endpoint-1' }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    status: 'open',
    sendAnswer: jest.fn(),
    sendAnswerMulti: jest.fn(),
  }),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn(),
  postMessage: jest.fn(),
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

beforeEach(() => {
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

test('renders fetched historical agent text without typewriter replay', async () => {
  const { getByText, queryByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('historical response')).toBeTruthy());

  expect(queryByText('historical response [typewriter]')).toBeNull();
});

test('shows the current agent name in the header', async () => {
  const { getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('Agent')).toBeTruthy());
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

test('renders image picker button in chat list detail composer', () => {
  const { getByLabelText, getByTestId } = render(<ChatDetailScreen />);

  expect(getByLabelText('Attach image')).toBeTruthy();
  expect(getByTestId('attach-btn')).toBeTruthy();
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

  await act(async () => {
    fireEvent.press(getByLabelText('Attach image'));
  });
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

    await act(async () => {
      fireEvent.press(getByTestId('attach-btn'));
    });

    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).not.toBeNull();
    });
  });

  it('removes image when × badge tapped', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('attach-btn'));
    });
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
      await act(async () => {
        fireEvent.press(getByTestId('attach-btn'));
      });
    }
    await waitFor(() => expect(queryByTestId('remove-img-4')).toBeTruthy());

    const alertSpy = jest.spyOn(Alert, 'alert');
    await act(async () => {
      fireEvent.press(getByTestId('attach-btn'));
    });

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

    await act(async () => {
      fireEvent.press(getByTestId('attach-btn'));
    });

    // 第 2 次 attach 前切换 mock
    (uploadImage as jest.Mock).mockResolvedValueOnce({ file_id: 'file-2' });
    await act(async () => {
      fireEvent.press(getByTestId('attach-btn'));
    });

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
