/// Tests that useWebSocket does not create duplicate local notifications for
/// task_status messages. Completion push is owned by the CLI.

import { renderHook, act } from '@testing-library/react-native';
import { useWebSocket } from '@/hooks/useWebSocket';
import { notifyTaskComplete } from '@/services/notificationService';

jest.mock('@/services/notificationService', () => ({
  notifyTaskComplete: jest.fn().mockResolvedValue(undefined),
}));

const mockNotifyTaskComplete = notifyTaskComplete as jest.MockedFunction<typeof notifyTaskComplete>;

// Mock dependencies
jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/features/inbox/services/inboxService', () => ({
  markAskAnswered: jest.fn(),
}));
jest.mock('@/features/inbox/utils/buildAskQuestionInboxItem', () => ({
  buildAskQuestionInboxItem: jest.fn(),
}));
jest.mock('@/store/chatStore', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      messages: {},
      appendMessage: jest.fn(),
      setMessages: jest.fn(),
      markAnswered: jest.fn(),
      updateConversation: jest.fn(),
    }),
}));
jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({ addItem: jest.fn(), removeItem: jest.fn(), removeAnsweredAsk: jest.fn() }),
}));

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => this.onclose?.());
}
let mockWs: MockWebSocket;
global.WebSocket = jest.fn().mockImplementation(() => {
  mockWs = new MockWebSocket();
  return mockWs;
}) as unknown as typeof WebSocket;

describe('useWebSocket task_status notification dedupe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT call notifyTaskComplete when task_status completed message arrives', async () => {
    const { unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
      }),
    );

    await act(async () => {
      mockWs.onopen?.();
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          seq: 5,
          role: 'task_status',
          payload: {
            task_id: 'task-abc',
            status: 'completed',
            importance: 'normal',
            summary: 'Build succeeded',
          },
          created_at: Date.now(),
        }),
      });
    });

    expect(mockNotifyTaskComplete).not.toHaveBeenCalled();

    unmount();
  });

  it('does NOT call notifyTaskComplete for task_status with status=running', async () => {
    const { unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
      }),
    );

    await act(async () => {
      mockWs.onopen?.();
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          seq: 3,
          role: 'task_status',
          payload: {
            task_id: 'task-abc',
            status: 'running',
            importance: 'normal',
            summary: '',
          },
          created_at: Date.now(),
        }),
      });
    });

    expect(mockNotifyTaskComplete).not.toHaveBeenCalled();

    unmount();
  });
});
