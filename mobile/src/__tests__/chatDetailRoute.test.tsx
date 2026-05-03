import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Alert } from 'react-native';
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

test('animates the next agent text after sending a message', async () => {
  (fetchMessages as jest.Mock).mockResolvedValue([]);
  const { getByPlaceholderText, getByText } = render(<ChatDetailScreen />);

  fireEvent.changeText(getByPlaceholderText('Message...'), 'scan');
  fireEvent(getByPlaceholderText('Message...'), 'submitEditing');

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
  expect(getByTestId('attach-image-button')).toBeTruthy();
});

test('uploads selected image and renders the sent image message with local uri', async () => {
  const { getByLabelText, getByText, queryByTestId } = render(<ChatDetailScreen />);

  await act(async () => {
    fireEvent.press(getByLabelText('Attach image'));
  });
  await waitFor(() => expect(queryByTestId('img-preview-row')).not.toBeNull());

  fireEvent.press(getByLabelText('Send message'));

  await waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith(
      'http://localhost:8080',
      'token',
      'conv-1',
      '',
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
      fireEvent.press(getByTestId('attach-image-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).not.toBeNull();
    });
  });

  it('removes image when × badge tapped', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('attach-image-button'));
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
        fireEvent.press(getByTestId('attach-image-button'));
      });
    }
    await waitFor(() => expect(queryByTestId('remove-img-4')).toBeTruthy());

    const alertSpy = jest.spyOn(Alert, 'alert');
    await act(async () => {
      fireEvent.press(getByTestId('attach-image-button'));
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
      fireEvent.press(getByTestId('attach-image-button'));
    });

    // 第 2 次 attach 前切换 mock
    (uploadImage as jest.Mock).mockResolvedValueOnce({ file_id: 'file-2' });
    await act(async () => {
      fireEvent.press(getByTestId('attach-image-button'));
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
