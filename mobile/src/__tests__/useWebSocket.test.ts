import { renderHook, act, waitFor } from '@testing-library/react-native';
import { fetchMessages } from '@/features/chat/services/chatService';
import { loadAnsweredAsks, markAskAnswered } from '@/features/inbox/services/inboxService';
import { buildAskQuestionInboxItem } from '@/features/inbox/utils/buildAskQuestionInboxItem';
import { useWebSocket } from '@/hooks/useWebSocket';

const mockAddItem = jest.fn().mockResolvedValue(undefined);
const mockRemoveAnsweredAsk = jest.fn().mockResolvedValue(undefined);
const mockMarkAnswered = jest.fn();
const mockUpdateConversation = jest.fn();

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn().mockResolvedValue([]),
  parseAnswerAcknowledgement: jest.fn((value: unknown) => {
    const envelope = value as {
      type?: string;
      ask_id?: string;
      ok?: boolean;
      status?: string;
      error?: string;
    };
    if (!envelope.ask_id) return null;
    if (envelope.type !== 'answer_ack' && envelope.type !== 'answer_status') return null;
    const status = envelope.status?.toLowerCase();
    const ok =
      typeof envelope.ok === 'boolean'
        ? envelope.ok
        : status === 'ok' || status === 'success'
          ? true
          : status === 'failed'
            ? false
            : null;
    if (ok == null) return null;
    return { ask_id: envelope.ask_id, ok, error: envelope.error };
  }),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  markAskAnswered: jest.fn(),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
  loadAnsweredAsks: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('@/services/notificationService', () => ({
  notifyTaskComplete: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      appendMessage: jest.fn(),
      setMessages: jest.fn(),
      markAnswered: mockMarkAnswered,
      updateConversation: mockUpdateConversation,
    }),
}));

jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({ addItem: mockAddItem, removeItem: jest.fn(), removeAnsweredAsk: mockRemoveAnsweredAsk }),
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
const MockWebSocketConstructor = jest.fn().mockImplementation(() => {
  mockWs = new MockWebSocket();
  return mockWs;
});
MockWebSocketConstructor.OPEN = MockWebSocket.OPEN;
global.WebSocket = MockWebSocketConstructor as unknown as typeof WebSocket;

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
    (loadAnsweredAsks as jest.Mock).mockResolvedValue(new Map());
  });

  it('updates conversation status when task_status arrives over websocket', async () => {
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
          seq: 6,
          role: 'task_status',
          payload: {
            task_id: 'conv-1',
            status: 'completed',
            importance: 'normal',
            summary: 'Done',
          },
          created_at: 1234,
        }),
      });
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('conv-1', {
      status: 'completed',
      last_message_at: 1234,
    });
    unmount();
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

  it('does NOT re-add ask_question to inbox when it was already answered (catch-up regression)', async () => {
    /// 回归：用户在 chat 中作答后返回 inbox，WebSocket catch-up 重新拉取消息时
    /// 不应将已回答的 ask_question 再次写入 inbox。
    ///
    /// 数据构造：
    ///   fetchMessages 返回 ask_id = 'ask-answered' 的 ask_question 消息
    ///   loadAnsweredAsks 返回包含 'ask-answered' 的 Map（模拟已作答）
    ///
    /// 执行过程：
    ///   1. ws.onopen 触发 catch-up
    ///   2. catch-up 拉取到包含 ask_id='ask-answered' 的消息
    ///   3. 应从 answered_asks 发现该问题已作答 → 不调用 addItem
    ///
    /// 预期结果：
    ///   - addItem 不被调用（已回答问题不重新写入 inbox）
    (fetchMessages as jest.Mock).mockResolvedValue([
      {
        type: 'message',
        seq: 10,
        role: 'ask_question',
        payload: {
          ask_id: 'ask-answered',
          allow_freeform: false,
          questions: [{ id: '0', text: 'Already answered?', options: [] }],
        },
        created_at: 10,
      },
    ]);
    (loadAnsweredAsks as jest.Mock).mockResolvedValue(
      new Map([['ask-answered', { choice_id: 'yes' }]]),
    );

    const { unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-answered',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Test Bot',
      }),
    );

    await act(async () => {
      mockWs.onopen?.();
    });

    // 等待 catch-up 的异步操作完成
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockAddItem).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps ask unanswered and pending when answer acknowledgement fails', async () => {
    /// Answer ack failure：server 明确拒绝 answer 时，mobile 不得提前隐藏 ask。
    ///
    /// 数据构造：
    ///   ask_id = 'ask-failed'
    ///   choice_id = 'yes'
    ///   WS failure envelope = { type: 'answer_ack', status: 'failed' }
    ///
    /// 执行过程：
    ///   1. 打开 WebSocket，调用 sendAnswer('ask-failed', 'yes')。
    ///   2. sendAnswer 只发送 answer payload，不触发 answered/inbox 副作用。
    ///   3. 服务端返回失败 ack。
    ///
    /// 预期结果：
    ///   - 正断言：answer payload 已发出，说明用户操作到达传输层。
    ///   - 负断言：markAnswered 不被调用，否则 Chat 卡片会被误标为 answered。
    ///   - 负断言：removeAnsweredAsk 不被调用，否则 pending inbox row 会被误删。
    ///   - 负断言：markAskAnswered 不被调用，否则 answered_asks 会污染历史渲染。
    ///   - 正断言：conversation 回到 awaiting_question，说明 UI 仍可恢复为待回答状态。
    const { result, unmount } = renderHook(() =>
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
    act(() => {
      result.current.sendAnswer('ask-failed', 'yes');
    });

    expect({
      actual: mockWs.send.mock.calls.some(
        ([payload]) =>
          payload === JSON.stringify({ type: 'answer', ask_id: 'ask-failed', choice_id: 'yes' }),
      ),
      reason: 'answer payload should still be sent before waiting for acknowledgement',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: mockMarkAnswered.mock.calls.length,
      reason: 'Chat card must not be marked answered before server acknowledgement',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: mockRemoveAnsweredAsk.mock.calls.length,
      reason: 'pending inbox row must not be removed before server acknowledgement',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: (markAskAnswered as jest.Mock).mock.calls.length,
      reason: 'answered_asks must not be persisted before server acknowledgement',
    }).toEqual({ actual: 0, reason: expect.any(String) });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'answer_ack',
          ask_id: 'ask-failed',
          status: 'failed',
          error: 'no waiting session',
        }),
      });
    });

    expect({
      actual: mockMarkAnswered.mock.calls.length,
      reason: 'failed ack must leave Chat card unanswered',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: mockRemoveAnsweredAsk.mock.calls.length,
      reason: 'failed ack must leave pending inbox row visible',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: (markAskAnswered as jest.Mock).mock.calls.length,
      reason: 'failed ack must not write answered_asks compatibility record',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: mockUpdateConversation.mock.calls.some(
        ([id, patch]) => id === 'conv-1' && patch.status === 'awaiting_question',
      ),
      reason: 'failed ack should restore awaiting_question status for retry',
    }).toEqual({ actual: true, reason: expect.any(String) });
    unmount();
  });

  it('marks ask answered only after successful answer acknowledgement', async () => {
    /// Answer ack success：只有 server 确认 answer 已路由/持久化后才更新本地 answered 状态。
    ///
    /// 数据构造：
    ///   ask_id = 'ask-success'
    ///   choice_ids = { '0': 'iad', '1': 'pg' }（多问题答案）
    ///   WS success envelope = { type: 'answer_status', ok: true }
    ///
    /// 执行过程：
    ///   1. 打开 WebSocket，调用 sendAnswerMulti。
    ///   2. ack 前检查没有 answered/inbox 副作用。
    ///   3. 服务端返回成功 ack。
    ///
    /// 预期结果：
    ///   - 正断言：Chat card 标记 answered，且保留原 multi choice payload。
    ///   - 正断言：matching inbox row 被删除。
    ///   - 正断言：answered_asks 记录被写入，用于历史 Chat 兼容渲染。
    ///   - 正断言：conversation 标记 running，表示 answer 已恢复 agent 执行。
    const { result, unmount } = renderHook(() =>
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
    act(() => {
      result.current.sendAnswerMulti('ask-success', { '0': 'iad', '1': 'pg' });
    });

    expect({
      actual: mockMarkAnswered.mock.calls.length,
      reason: 'Chat card must wait for success ack before answered state',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: mockRemoveAnsweredAsk.mock.calls.length,
      reason: 'inbox row must wait for success ack before removal',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    expect({
      actual: (markAskAnswered as jest.Mock).mock.calls.length,
      reason: 'answered_asks must wait for success ack before local compatibility write',
    }).toEqual({ actual: 0, reason: expect.any(String) });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'answer_status',
          ask_id: 'ask-success',
          ok: true,
        }),
      });
    });

    expect({
      actual: mockMarkAnswered.mock.calls.some(
        ([convId, askId, choiceId, choiceIds]) =>
          convId === 'conv-1' &&
          askId === 'ask-success' &&
          choiceId === undefined &&
          choiceIds?.['0'] === 'iad' &&
          choiceIds?.['1'] === 'pg',
      ),
      reason: 'success ack should mark Chat card answered with original multi-choice payload',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: mockRemoveAnsweredAsk.mock.calls.some(([askId]) => askId === 'ask-success'),
      reason: 'success ack should remove the matching pending inbox row',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: (markAskAnswered as jest.Mock).mock.calls.some(
        ([askId, convId, choiceId, choiceIds]) =>
          askId === 'ask-success' &&
          convId === 'conv-1' &&
          choiceId === undefined &&
          choiceIds?.['0'] === 'iad' &&
          choiceIds?.['1'] === 'pg',
      ),
      reason: 'success ack should write answered_asks compatibility record',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: mockUpdateConversation.mock.calls.some(
        ([id, patch]) => id === 'conv-1' && patch.status === 'running',
      ),
      reason: 'success ack should move conversation back to running',
    }).toEqual({ actual: true, reason: expect.any(String) });
    unmount();
  });
});
