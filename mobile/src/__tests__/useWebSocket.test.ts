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
let mockWsInstances: MockWebSocket[] = [];
const MockWebSocketConstructor = jest.fn().mockImplementation(() => {
  mockWs = new MockWebSocket();
  mockWsInstances.push(mockWs);
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
    mockWsInstances = [];
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (loadAnsweredAsks as jest.Mock).mockResolvedValue(new Map());
  });

  it('skips reconnect catch-up while initial history has not established a cursor', async () => {
    /// Initial cursor coordination：ChatDetail may open the WebSocket before
    /// its limited REST history request has resolved, so catch-up must be
    /// explicitly disabled until a non-legacy cursor exists.
    ///
    /// Data construction:
    ///   enableCatchUp = false.
    ///   catchUpAfterSeq is absent, so default lastSeqRef would otherwise be 0.
    ///   Legacy full-history request would be fetchMessages(..., 0).
    ///
    /// Execution process:
    ///   1. Mount useWebSocket with enableCatchUp=false.
    ///   2. Fire ws.onopen to simulate the first socket connection.
    ///   3. Flush one async tick for any accidental catch-up promise scheduling.
    ///
    /// Expected result:
    ///   - Positive assertion: WebSocket status reaches open through the normal path.
    ///   - Negative assertion: fetchMessages is not called with since_seq 0.
    ///   - Negative assertion: fetchMessages is not called at all during disabled catch-up.
    const { result, unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
        enableCatchUp: false,
      } as Parameters<typeof useWebSocket>[0] & { enableCatchUp: boolean }),
    );

    await act(async () => {
      mockWs.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: result.current.status,
      reason: 'socket should still transition to open when catch-up is disabled',
    }).toEqual({ actual: 'open', reason: expect.any(String) });
    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.some(([, , , sinceSeq]) => sinceSeq === 0),
      reason: 'disabled initial catch-up must not request legacy full history from seq 0',
    }).toEqual({ actual: false, reason: expect.any(String) });
    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.length,
      reason: 'disabled initial catch-up should not fetch messages on first open',
    }).toEqual({ actual: 0, reason: expect.any(String) });
    unmount();
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

  it('resets catch-up cursor when hook rerenders for a different conversation', async () => {
    /// Conversation switch catch-up：同一个 hook instance 从高 seq conversation
    /// 切到低 seq conversation 时，catch-up cursor 必须按新 conversation 重置。
    ///
    /// 数据构造（关键数值推导）：
    ///   conv-a catchUpAfterSeq = 1000，表示历史窗口已覆盖到 1000。
    ///   conv-b catchUpAfterSeq = 5，表示新 conversation 只应从 5 之后补齐。
    ///   如果沿用 conv-a cursor，则 conv-b 会请求 since_seq=1000，漏掉 6..1000。
    ///
    /// 执行过程：
    ///   1. Mount conv-a，打开 socket → catch-up 请求 conv-a since_seq=1000。
    ///   2. Rerender 到 conv-b，打开新 socket → 应重置 cursor 和去重 guard。
    ///   3. 检查所有 fetchMessages 调用，确认 conv-b 使用自己的低 cursor。
    ///
    /// 预期结果：
    ///   - 正断言：conv-a 首次 catch-up 使用 1000，证明测试先建立高 cursor。
    ///   - 正断言：conv-b catch-up 使用 5，证明 conversation 切换已重置 cursor。
    ///   - 负断言：conv-b 不使用 1000，否则会漏掉低 seq conversation 的消息。
    const { rerender, unmount } = renderHook(
      ({ conv_id, catchUpAfterSeq }: { conv_id: string; catchUpAfterSeq: number }) =>
        useWebSocket({
          base_url: 'http://localhost:8080',
          token: 'tok',
          conv_id,
          endpoint_id: 'ep-1',
          agent_id: 'agent-1',
          agent_name: 'Deploy Bot',
          catchUpAfterSeq,
        }),
      { initialProps: { conv_id: 'conv-a', catchUpAfterSeq: 1000 } },
    );

    await act(async () => {
      mockWsInstances[0]?.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.some(
        ([, , convId, sinceSeq]) => convId === 'conv-a' && sinceSeq === 1000,
      ),
      reason: 'conv-a should establish the initial high catch-up cursor',
    }).toEqual({ actual: true, reason: expect.any(String) });

    rerender({ conv_id: 'conv-b', catchUpAfterSeq: 5 });

    await act(async () => {
      mockWsInstances[1]?.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.some(
        ([, , convId, sinceSeq]) => convId === 'conv-b' && sinceSeq === 5,
      ),
      reason: 'conv-b should catch up from its own lower history cursor',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.some(
        ([, , convId, sinceSeq]) => convId === 'conv-b' && sinceSeq === 1000,
      ),
      reason: 'conv-b must not inherit conv-a high cursor or it can miss messages',
    }).toEqual({ actual: false, reason: expect.any(String) });
    unmount();
  });

  it('retries same-cursor catch-up after reconnect when earlier catch-up returned no messages', async () => {
    /// Reconnect same-cursor catch-up：同一个 since_seq 的空 catch-up 不能永久去重，
    /// 因为断线期间同一 cursor 后面可能新增消息。
    ///
    /// 数据构造（关键数值推导）：
    ///   catchUpAfterSeq = 100，表示本地已覆盖到 100。
    ///   第一次 fetchMessages(..., 100) 返回 []，lastSeq 仍为 100。
    ///   socket close 后重连，仍应 fetchMessages(..., 100) 再查一次断线窗口。
    ///
    /// 执行过程：
    ///   1. Mount 并打开第一个 socket → fetchMessages(..., 100) 返回空。
    ///   2. 关闭 socket，触发 reconnect timer。
    ///   3. 打开重连 socket → 同一 since_seq=100 必须再次发起 catch-up。
    ///
    /// 预期结果：
    ///   - 正断言：第一次 catch-up 使用 since_seq=100。
    ///   - 正断言：重连后第二次 catch-up 也使用 since_seq=100。
    ///   - 负断言：同一 cursor 只调用一次是不允许的，会丢失断线期间消息。
    jest.useFakeTimers();
    (fetchMessages as jest.Mock).mockResolvedValue([]);

    const { unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
        catchUpAfterSeq: 100,
      }),
    );

    await act(async () => {
      mockWsInstances[0]?.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.filter(([, , , sinceSeq]) => sinceSeq === 100)
        .length,
      reason: 'first connection should catch up from the provided cursor',
    }).toEqual({ actual: 1, reason: expect.any(String) });

    act(() => {
      mockWsInstances[0]?.onclose?.();
      jest.advanceTimersByTime(1000);
    });

    await act(async () => {
      mockWsInstances[1]?.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: (fetchMessages as jest.Mock).mock.calls.filter(([, , , sinceSeq]) => sinceSeq === 100)
        .length,
      reason: 'reconnect should retry catch-up at the same cursor after the previous empty result',
    }).toEqual({ actual: 2, reason: expect.any(String) });
    expect({
      actual:
        (fetchMessages as jest.Mock).mock.calls.filter(([, , , sinceSeq]) => sinceSeq === 100)
          .length === 1,
      reason: 'same-cursor dedupe must not suppress reconnect recovery',
    }).toEqual({ actual: false, reason: expect.any(String) });
    unmount();
    jest.useRealTimers();
  });

  /// Reconnect pending catch-up race：断线时旧 catch-up 仍 pending，重连不能被
  /// 同一 since_seq 的 in-flight guard 永久压住。
  ///
  /// 数据构造（关键数值推导）：
  ///   catchUpAfterSeq = 100，表示本地已覆盖到 seq 100。
  ///   第一次 fetchMessages(..., 100) 返回 pending Promise，不解析。
  ///   socket close 后重连，lastSeq 仍是 100，因此新 socket 也必须请求 since_seq=100。
  ///
  /// 执行过程：
  ///   1. 打开第一个 socket → 发起第 1 次 fetchMessages(..., 100)，保持 pending。
  ///   2. 关闭第一个 socket，推进 reconnect backoff 1000ms。
  ///   3. 打开第二个 socket → 必须在第 1 个 Promise resolve 前再次 fetchMessages(..., 100)。
  ///
  /// 预期结果：
  ///   - 正断言：第一个 socket 已发起一次 since_seq=100 catch-up。
  ///   - 正断言：重连 socket 在旧请求未完成前发起第二次 since_seq=100 catch-up。
  ///   - 负断言：调用次数不能停在 1，否则旧 pending 请求会遮蔽断线后的补齐窗口。
  it('starts same-cursor catch-up on reconnect while previous catch-up is still pending', async () => {
    jest.useFakeTimers();
    let resolveFirstCatchUp: (messages: []) => void = () => {};
    const firstCatchUp = new Promise<[]>((resolve) => {
      resolveFirstCatchUp = resolve;
    });
    (fetchMessages as jest.Mock).mockImplementationOnce(() => firstCatchUp).mockResolvedValue([]);

    const { unmount } = renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
        catchUpAfterSeq: 100,
      }),
    );

    await act(async () => {
      mockWsInstances[0]?.onopen?.();
      await Promise.resolve();
    });

    const callsAtSeq100 = () =>
      (fetchMessages as jest.Mock).mock.calls.filter(([, , , sinceSeq]) => sinceSeq === 100).length;

    expect({
      actual: callsAtSeq100(),
      reason: 'first socket should start catch-up from the provided cursor',
    }).toEqual({ actual: 1, reason: expect.any(String) });

    act(() => {
      mockWsInstances[0]?.onclose?.();
      jest.advanceTimersByTime(1000);
    });

    await act(async () => {
      mockWsInstances[1]?.onopen?.();
      await Promise.resolve();
    });

    expect({
      actual: callsAtSeq100(),
      reason: 'reconnect should start a fresh same-cursor catch-up before old request resolves',
    }).toEqual({ actual: 2, reason: expect.any(String) });
    expect({
      actual: callsAtSeq100() === 1,
      reason: 'pending old catch-up must not suppress reconnect recovery at the same cursor',
    }).toEqual({ actual: false, reason: expect.any(String) });

    resolveFirstCatchUp([]);
    await act(async () => {
      await firstCatchUp;
    });
    unmount();
    jest.useRealTimers();
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
