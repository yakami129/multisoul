import { renderHook, act, waitFor } from '@testing-library/react-native';
import { fetchMessages } from '@/features/chat/services/chatService';
import { buildAskQuestionInboxItem } from '@/features/inbox/utils/buildAskQuestionInboxItem';
import { useWebSocket } from '@/hooks/useWebSocket';

const mockAddItem = jest.fn().mockResolvedValue(undefined);

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  markAskAnswered: jest.fn(),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/notificationService', () => ({
  notifyTaskComplete: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      appendMessage: jest.fn(),
      setMessages: jest.fn(),
      markAnswered: jest.fn(),
    }),
}));

jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({ addItem: mockAddItem, removeItem: jest.fn() }),
}));

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

describe('buildAskQuestionInboxItem', () => {
  const askPayload = {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [
      {
        id: '0',
        text: 'Need input?',
        options: [{ id: '0', label: 'Yes' }],
      },
    ],
  };

  it('prefers agent_name for inbox title', () => {
    const item = buildAskQuestionInboxItem({
      askPayload,
      endpoint_id: 'ep-1',
      agent_id: 'agent-123',
      agent_name: 'Release Bot',
      conversation_id: 'conv-1',
      received_at: 1,
    });

    expect(item.title).toBe('Release Bot');
    expect(item.body).toBe('Need input?');
  });

  it('falls back to agent_id when agent_name is empty', () => {
    const item = buildAskQuestionInboxItem({
      askPayload,
      endpoint_id: 'ep-1',
      agent_id: 'agent-123',
      agent_name: '   ',
      conversation_id: 'conv-1',
      received_at: 1,
    });

    expect(item.title).toBe('agent-123');
  });
});

describe('useWebSocket ask_question inbox mirroring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchMessages as jest.Mock).mockResolvedValue([]);
  });

  it('mirrors ask_question messages fetched during reconnect catch-up to inbox', async () => {
    (fetchMessages as jest.Mock).mockResolvedValue([
      {
        type: 'message',
        seq: 5,
        role: 'ask_question',
        payload: {
          ask_id: 'ask-catchup',
          allow_freeform: false,
          questions: [
            {
              id: '0',
              text: 'Continue deployment?',
              options: [{ id: 'yes', label: 'Yes' }],
            },
          ],
        },
        created_at: 5,
      },
    ]);

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

    await waitFor(() =>
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ask-catchup',
          kind: 'pending_question',
          body: 'Continue deployment?',
        }),
      ),
    );
    unmount();
  });
});
