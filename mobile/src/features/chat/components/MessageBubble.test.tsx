import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { clearDiagnosticsEntries, getDiagnosticsLogText } from '@/services/diagnosticsLog';
import type { WsMessage } from '@/types';
import { MessageBubble } from './MessageBubble';

const originalFetch = global.fetch;
function assertTrue(value: boolean, message: string) {
  if (!value) throw new Error(message);
  expect(value).toBe(true);
}

function assertFalse(value: boolean, message: string) {
  if (value) throw new Error(message);
  expect(value).toBe(false);
}

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

const agentMessage: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'agent_text',
  payload: { text: 'system online' },
  created_at: 0,
};

/// System event separator: model changes render as lightweight transcript text, not AI bubbles.
///
/// Data setup:
///   role = "system_event", event = "model_changed"
///   labels = "Default" -> "Codex 5.3"
///
/// Execution:
///   1. Render MessageBubble with the system event message.
///   2. Query for the separator text and for agent text bubble chrome.
///
/// Expected result:
///   - Positive: "Model changed: Default -> Codex 5.3" is visible.
///   - Negative: no agent-text-bubble is rendered for a system event.
it('renders model_changed system event as separator text', () => {
  const { getByText, queryByTestId } = render(
    <MessageBubble
      msg={{
        type: 'message',
        seq: 5,
        role: 'system_event',
        created_at: 1,
        payload: {
          event: 'model_changed',
          from_model_id: null,
          to_model_id: 'gpt-5.3-codex',
          from_label: 'Default',
          to_label: 'Codex 5.3',
        },
      }}
    />,
  );

  assertTrue(
    !!getByText('Model changed: Default -> Codex 5.3'),
    'model_changed system event should render a visible separator label',
  );
  assertTrue(
    queryByTestId('agent-text-bubble') === null,
    'system event must not render inside the agent text bubble chrome',
  );
});

test('renders minimal shining waiting status', () => {
  jest.useFakeTimers();
  const { getByLabelText, queryByText } = render(<MessageBubble msg={agentMessage} waiting />);

  expect(getByLabelText('Thinking...')).toBeTruthy();
  expect(queryByText('ACCESSING NEURAL LINK')).toBeNull();
  expect(queryByText('awaiting encrypted response▋')).toBeNull();
  expect(queryByText('Planning...')).toBeNull();
});

it('renders three pulsing dots with testIDs when waiting=true', () => {
  jest.useFakeTimers();
  const msg: WsMessage = {
    type: 'message',
    seq: -1,
    role: 'agent_text',
    payload: { text: '' },
    created_at: 0,
  };
  const { getByTestId } = render(<MessageBubble msg={msg} waiting />);
  expect(getByTestId('waiting-dot-0')).toBeTruthy();
  expect(getByTestId('waiting-dot-1')).toBeTruthy();
  expect(getByTestId('waiting-dot-2')).toBeTruthy();
  expect(getByTestId('waiting-analyzing-text')).toBeTruthy();
});

test('reveals agent text with scanner cursor while preserving original color', () => {
  jest.useFakeTimers();
  const { queryByText, getByText } = render(<MessageBubble msg={agentMessage} typewriter />);

  expect(queryByText('system online')).toBeNull();

  act(() => {
    jest.advanceTimersByTime(28);
  });

  const scanningText = getByText('s▌');
  expect(StyleSheet.flatten(scanningText.props.style).color).toBe('#0D0D0D');

  act(() => {
    jest.advanceTimersByTime(500);
  });

  expect(getByText('system online')).toBeTruthy();
});

describe('MessageBubble image rendering', () => {
  const makeUserMsg = (payload: object): WsMessage => ({
    type: 'message',
    seq: 1,
    role: 'user_text',
    payload: payload as WsMessage['payload'],
    created_at: 0,
  });

  it('renders image thumbnail when imageUri is provided', () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByTestId } = render(<MessageBubble msg={msg} imageUri="file:///local/photo.jpg" />);
    expect(getByTestId('user-image-thumb')).toBeTruthy();
  });

  /// 多图消息组：连续图片 user_text 在 UI 上应共用一个气泡，气泡内显示多张缩略图。
  ///
  /// 数据构造：
  ///   display msg payload.text = "compare these"
  ///   imageAttachments = file-1 + file-2
  ///
  /// 执行过程：
  ///   1. render MessageBubble with imageAttachments
  ///   2. 查询图片网格和缩略图数量
  ///
  /// 预期结果：
  ///   - 正断言：一个 user-image-grid 包含 2 个 user-image-thumb
  ///   - 正断言：caption 文本仍显示在同一个气泡中
  it('renders multiple image attachments in one user bubble', () => {
    const msg = makeUserMsg({ text: 'compare these', file_id: 'file-2.jpg' });
    const { getByTestId, getAllByTestId, getByText } = render(
      <MessageBubble
        msg={msg}
        imageAttachments={[
          { seq: 1, fileId: 'file-1.jpg', imageUri: 'file:///local/one.jpg' },
          { seq: 2, fileId: 'file-2.jpg', imageUri: 'file:///local/two.jpg' },
        ]}
      />,
    );

    expect(getByTestId('user-image-grid')).toBeTruthy();
    expect(getAllByTestId('user-image-thumb')).toHaveLength(2);
    expect(getByText('compare these')).toBeTruthy();
  });

  it('renders attachment placeholder when file_id present but no imageUri', () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('📎 Image')).toBeTruthy();
  });

  /// 图片加载失败：不要留下空白缩略图，显示可诊断占位。
  ///
  /// 数据构造：
  ///   WsMessage role='user_text'
  ///   payload.file_id = 'abc.jpg'
  ///   imageUri = 'http://localhost:8080/api/v1/uploads/abc.jpg?token=tok'
  ///
  /// 执行过程：
  ///   1. render MessageBubble → 显示 user-image-thumb
  ///   2. 对缩略图 Image 触发 onError，模拟 401/404/网络失败
  ///   3. 组件设置 imageLoadFailed=true
  ///
  /// 预期结果：
  ///   - 正断言：显示 "Image unavailable"，用户不再看到空白块
  ///   - 负断言：user-image-thumb 不存在，失败图片不会继续占住空白缩略图
  it('shows image unavailable placeholder when image loading fails', async () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByTestId, getByText, queryByTestId } = render(
      <MessageBubble msg={msg} imageUri="http://localhost:8080/api/v1/uploads/abc.jpg?token=tok" />,
    );

    await act(async () => {
      fireEvent(getByTestId('user-image'), 'onError');
    });

    expect(getByText('Image unavailable')).toBeTruthy();
    expect(queryByTestId('user-image-thumb')).toBeNull();
  });

  /// 图片加载失败诊断：失败后主动探测 URL，记录 HTTP 状态。
  ///
  /// 数据构造：
  ///   WsMessage role='user_text'
  ///   payload.file_id = 'abc.jpg'
  ///   imageUri = 'http://localhost:8080/api/v1/uploads/abc.jpg?token=tok'
  ///   fetch mock status = 404, content-type = text/plain
  ///
  /// 执行过程：
  ///   1. clearDiagnosticsEntries() 清空前置日志
  ///   2. render MessageBubble → 显示图片缩略图
  ///   3. 触发 Image onError → 组件记录 image load failed，并执行 fetch 探测
  ///   4. 等待 diagnosticsLog 收到 chat.image.probe
  ///
  /// 预期结果：
  ///   - 正断言：日志包含 chat.image.probe，说明发布版能采集 HTTP 诊断
  ///   - 正断言：日志包含 status 404，能区分服务端缺文件/旧 CLI
  ///   - 正断言：日志包含 token=tok，方便直接复现图片 URL
  it('records an HTTP probe after image loading fails', async () => {
    await clearDiagnosticsEntries();
    global.fetch = jest.fn().mockResolvedValue({
      status: 404,
      ok: false,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/plain' : null),
      },
    }) as typeof fetch;
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByTestId } = render(
      <MessageBubble msg={msg} imageUri="http://localhost:8080/api/v1/uploads/abc.jpg?token=tok" />,
    );

    await act(async () => {
      fireEvent(getByTestId('user-image'), 'onError');
    });

    await waitFor(() => {
      expect(getDiagnosticsLogText()).toContain('[chat.image.probe]');
    });
    expect(getDiagnosticsLogText()).toContain('"status":404');
    expect(getDiagnosticsLogText()).toContain('token=tok');
  });

  it('renders plain text bubble when no file_id', () => {
    const msg = makeUserMsg({ text: 'hello' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('hello')).toBeTruthy();
  });

  /// 用户文本消息：普通文字应支持系统长按选择/复制
  ///
  /// 数据构造：
  ///   WsMessage role='user_text'
  ///   payload.text = "copy this user message"
  ///   payload.file_id 不存在（纯文本消息）
  ///
  /// 执行过程：
  ///   1. render MessageBubble → user_text 分支
  ///   2. 找到内容 Text 节点
  ///   3. 读取 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：用户消息 Text selectable=true，长按可触发原生复制菜单
  ///   - 负断言：纯文本消息不应渲染代码块 copy-btn，避免把普通消息误当代码块
  it('makes user text selectable for native copy', () => {
    const msg = makeUserMsg({ text: 'copy this user message' });
    const { getByText, queryByTestId } = render(<MessageBubble msg={msg} />);

    expect(getByText('copy this user message').props.selectable).toBe(
      true,
      'user text should set selectable=true so native copy is available',
    );
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'plain user text should not render the code-block copy button',
    );
  });

  /// 全屏预览：点击缩略图 → Modal 出现；点击关闭按钮 → Modal 消失
  ///
  /// 数据构造：
  ///   WsMessage with role='user_text', payload.file_id='abc.jpg', imageUri='file://img.jpg'
  ///
  /// 执行过程：
  ///   1. 初始渲染 → Modal 不在 DOM（previewVisible=false）
  ///   2. 按 user-image-thumb → previewVisible=true → fullscreen-modal 出现
  ///   3. 按 fullscreen-close-btn → previewVisible=false → fullscreen-modal 消失
  ///
  /// 预期结果：
  ///   - 初始：queryByTestId('fullscreen-modal') 为 null（Modal 隐藏不在树中）
  ///   - 按下缩略图后：getByTestId('fullscreen-modal') 为 truthy
  ///   - 按下关闭按钮后：queryByTestId('fullscreen-modal') 为 null
  it('opens fullscreen preview when image bubble tapped', async () => {
    const msg: WsMessage = {
      type: 'message',
      seq: 1,
      role: 'user_text',
      payload: { text: '', file_id: 'abc.jpg' } as WsMessage['payload'],
      created_at: 1,
    };
    const { getByTestId, queryByTestId } = render(
      <MessageBubble msg={msg} imageUri="file://img.jpg" />,
    );

    // Modal 初始不可见（visible=false 时 RNTL 不渲染子树）
    expect(queryByTestId('fullscreen-modal')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId('user-image-thumb'));
    });

    // Modal 出现
    expect(getByTestId('fullscreen-modal')).toBeTruthy();

    // 关闭
    await act(async () => {
      fireEvent.press(getByTestId('fullscreen-close-btn'));
    });

    expect(queryByTestId('fullscreen-modal')).toBeNull();
  });

  /// "Tap to enlarge →" 提示文字：有 file_id + imageUri 时必须显示
  ///
  /// 数据构造：
  ///   WsMessage with role='user_text', payload.file_id='abc.jpg', imageUri='file://img.jpg'
  ///
  /// 执行过程：
  ///   1. 渲染 MessageBubble → user_text 分支 → hasImage=true，imageUri 存在
  ///
  /// 预期结果：
  ///   - getByText('Tap to enlarge →') 为 truthy（enlargeHint 文字渲染出来）
  it('shows Tap to enlarge hint on image bubble', () => {
    const msg: WsMessage = {
      type: 'message',
      seq: 1,
      role: 'user_text',
      payload: { text: '', file_id: 'abc.jpg' } as WsMessage['payload'],
      created_at: 1,
    };
    const { getByText } = render(<MessageBubble msg={msg} imageUri="file://img.jpg" />);
    expect(getByText('Tap to enlarge →')).toBeTruthy();
  });
});

// ── Markdown 渲染测试 ──────────────────────────────────────────────

describe('MessageBubble agent_text markdown rendering', () => {
  const makeAgentMsg = (text: string): WsMessage => ({
    type: 'message',
    seq: 10,
    role: 'agent_text',
    payload: { text },
    created_at: 0,
  });

  /// 流式 AI 回复：打字机阶段的纯 Text 也必须可复制
  ///
  /// 数据构造：
  ///   agent_text msg with text = "copy streaming answer"
  ///   typewriter = true
  ///   TYPEWRITER_INTERVAL_MS = 18ms
  ///
  /// 执行过程：
  ///   1. render MessageBubble(typewriter=true) → isStreaming=true
  ///   2. advanceTimersByTime(18ms) → 显示首字符和光标 "c▌"
  ///   3. 读取流式 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：流式 AI Text selectable=true，回复生成中也能复制已显示内容
  ///   - 负断言：流式阶段不应渲染 markdown-root，避免打字机路径被绕过
  it('makes streaming agent text selectable for native copy', () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('copy streaming answer');
    const { getByText, queryByTestId } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(18);
    });

    expect(getByText('c▌').props.selectable).toBe(
      true,
      'streaming agent text should set selectable=true while the typewriter is active',
    );
    expect(queryByTestId('markdown-root') === null).toBe(
      true,
      'streaming agent text should stay on the Text path until typewriter finishes',
    );
    jest.useRealTimers();
  });

  /// AI 回复气泡宽度：agent_text 应尽量占满 chat 列表可用宽度
  ///
  /// 数据构造：
  ///   agent_text msg with text = "wide answer"
  ///   typewriter = false（历史/已完成回复，走 MarkdownMessage 分支）
  ///
  /// 执行过程：
  ///   1. render MessageBubble → agent_text 分支 → aiWrap(width='100%')
  ///   2. agent_text 内容进入 testID="agent-text-bubble" 的 aiBubble
  ///   3. 读取 agent-text-bubble style
  ///
  /// 预期结果：
  ///   - 正断言：aiBubble.width 应为 '100%'，让 AI 回复尽量接近全屏可用宽度
  ///   - 负断言：aiBubble.maxWidth 不应为 280，避免长回复被固定窄卡片限制
  it('lets agent text bubbles use the full available row width', () => {
    const msg = makeAgentMsg('wide answer');
    const { getByTestId } = render(<MessageBubble msg={msg} />);

    const bubbleStyle = StyleSheet.flatten(getByTestId('agent-text-bubble').props.style);

    expect(bubbleStyle?.width).toBe(
      '100%',
      'agent text bubble should fill the available chat row width',
    );
    expect(bubbleStyle?.maxWidth).not.toBe(
      280,
      'agent text bubble must not keep the old fixed 280px max width',
    );
  });

  /// tool_call 使用紧凑 chip（非整行 aiBubble），与历史实现一致
  it('renders tool_call as compact ToolCallRow without outer aiBubble', () => {
    const msg: WsMessage = {
      type: 'message',
      seq: 50,
      role: 'tool_call',
      payload: { tool: 'Read', args: '{}', call_id: 'call-1' },
      created_at: 0,
    };
    const { getByTestId, queryByTestId } = render(<MessageBubble msg={msg} />);

    expect(getByTestId('tool-call-row')).toBeTruthy();
    expect(queryByTestId('tool-call-bubble')).toBeNull();
    expect(queryByTestId('agent-text-bubble')).toBeNull();
  });

  /// 历史消息（typewriter=false）：直接渲染 MarkdownMessage，不走 Text 分支
  ///
  /// 数据构造：
  ///   agent_text msg with text = "# Title"
  ///   typewriter = false（历史消息，不打字）
  ///
  /// 执行过程：
  ///   1. render MessageBubble without typewriter prop
  ///   2. MessageBubble agent_text case: isStreaming = false → MarkdownMessage
  ///
  /// 预期结果：
  ///   - testID="markdown-root" 存在（MarkdownMessage mock 渲染）
  ///   - 不存在光标字符 "▌"
  it('renders MarkdownMessage for historical message (no typewriter)', () => {
    const msg = makeAgentMsg('# Title\n\nhello world');
    const { getByTestId, queryByText } = render(<MessageBubble msg={msg} />);
    // 断言失败 = 历史消息没有走 MarkdownMessage 分支，仍在用纯 Text 渲染
    expect(getByTestId('markdown-root')).toBeTruthy();
    // 断言失败 = 光标字符不应出现在历史消息中
    expect(queryByText(/▌/)).toBeNull();
  });

  /// forceComplete=true 时：立即渲染 MarkdownMessage（不走打字机 interval）
  ///
  /// 数据构造：
  ///   agent_text msg, typewriter=true, forceComplete=true
  ///   即使 typewriter=true，forceComplete 应使其跳过流式分支
  ///
  /// 执行过程：
  ///   1. render MessageBubble with typewriter=true, forceComplete=true
  ///   2. isStreaming = typewriter && !forceComplete && ... = true && false = false
  ///   3. 走 MarkdownMessage 分支
  ///
  /// 预期结果：
  ///   - testID="markdown-root" 存在（MarkdownMessage 渲染）
  ///   - 不存在光标 "▌"（未进入打字机 interval）
  it('renders MarkdownMessage immediately when forceComplete=true even if typewriter=true', () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('hello world');
    const { getByTestId, queryByText } = render(
      <MessageBubble msg={msg} typewriter forceComplete />,
    );
    // 断言失败 = forceComplete=true 时没有立即走 MarkdownMessage 分支
    expect(getByTestId('markdown-root')).toBeTruthy();
    // 断言失败 = forceComplete=true 时不应出现打字机光标
    expect(queryByText(/▌/)).toBeNull();
    jest.useRealTimers();
  });

  /// typewriter 自然结束后切换到 MarkdownMessage
  ///
  /// 数据构造：
  ///   agent_text msg with short text "hi"（2 chars）
  ///   typewriter=true, TYPEWRITER_INTERVAL_MS=18ms
  ///
  /// 执行过程：
  ///   1. 初始：isStreaming=true，显示光标
  ///   2. advanceTimersByTime(60ms)：visibleChars >= 2，isStreaming=false
  ///   3. 渲染 MarkdownMessage
  ///
  /// 预期结果：
  ///   - 60ms 后 testID="markdown-root" 存在
  it('switches to MarkdownMessage after typewriter completes naturally', () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('hi');
    const { getByTestId } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(60); // 2 chars × 18ms + buffer
    });

    // 断言失败 = typewriter 结束后没有切换到 MarkdownMessage
    expect(getByTestId('markdown-root')).toBeTruthy();
    jest.useRealTimers();
  });

  /// typewriter 从 true 变 false 时：visibleChars 跳到末尾（不截断内容）
  ///
  /// 数据构造：
  ///   agent_text msg with text "abcdefghij"（10 chars）
  ///   先以 typewriter=true 渲染，推进 18ms（只显示 1 char）
  ///   然后 rerender 为 typewriter=false（模拟 forceComplete 或强制停止）
  ///
  /// 执行过程：
  ///   1. render typewriter=true → 18ms 后 visibleChars=1
  ///   2. rerender typewriter=false → prevTypewriterRef=true → setVisibleChars(10)
  ///   3. isStreaming = false → MarkdownMessage
  ///
  /// 预期结果：
  ///   - rerender 后 testID="markdown-root" 存在（完整内容，不截断）
  it('jumps to full content and renders MD when typewriter switches false', async () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('abcdefghij');
    const { rerender, getByTestId } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(18);
    }); // visibleChars = 1

    await act(async () => {
      rerender(<MessageBubble msg={msg} typewriter={false} />);
    });

    // 断言失败 = typewriter→false 时没有跳到末尾并切换 MarkdownMessage
    expect(getByTestId('markdown-root')).toBeTruthy();
    jest.useRealTimers();
  });

  /// 长流式回复：积压明显时应先按段落/行块状显示，避免每个字都慢慢追。
  ///
  /// 数据构造：
  ///   firstLine = "First paragraph arrives as one readable chunk.\n"（46 code units）
  ///   tail = "tail " × 35 ≈ 175 code units
  ///   Total ≈ 221 code units，超过 bulk 阈值 140
  ///   初始 typewriter=true → visible count = 0
  ///
  /// 执行过程：
  ///   1. render MessageBubble(typewriter=true)，agent_text 一次收到整段长文
  ///   2. advanceTimersByTime(18ms)，打字机执行首轮追赶
  ///   3. 首轮 backlog ≈ 221 > 140，应推进到第一处换行边界
  ///
  /// 预期结果：
  ///   - 正断言：首行完整显示并带光标，读者能马上看到一个语义块
  ///   - 负断言：不应只显示 "F▌"，否则长回复会按单字拖慢
  it('reveals the first line as a chunk when streamed text has a large backlog', () => {
    jest.useFakeTimers();
    const firstLine = 'First paragraph arrives as one readable chunk.\n';
    const msg = makeAgentMsg(`${firstLine}${'tail '.repeat(35)}`);
    const { getByText, queryByText } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(18);
    });

    assertTrue(
      !!getByText(`${firstLine}▌`),
      'large backlog should reveal through the first line boundary on the first tick',
    );
    assertFalse(
      !!queryByText('F▌'),
      'large backlog must not use the old one-character reveal path',
    );
    jest.useRealTimers();
  });

  /// Emoji 字素：首轮显示不能截断 surrogate pair / ZWJ 序列。
  ///
  /// 数据构造：
  ///   agent_text = "👩‍💻 done"
  ///   "👩‍💻" 是一个用户感知字素，但包含多个 UTF-16 code units
  ///   初始 visible count = 0
  ///
  /// 执行过程：
  ///   1. render MessageBubble(typewriter=true)
  ///   2. advanceTimersByTime(18ms)，首轮显示第一个字素
  ///
  /// 预期结果：
  ///   - 正断言：显示完整 "👩‍💻▌"
  ///   - 负断言：不应显示 replacement character，说明没有截断 emoji code unit
  it('reveals one complete grapheme at a time so emoji are not split', () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('👩‍💻 done');
    const { getByText, queryByText } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(18);
    });

    assertTrue(!!getByText('👩‍💻▌'), 'first tick should reveal the full emoji grapheme');
    assertFalse(
      !!queryByText(/�/),
      'typewriter output must not contain replacement characters from split emoji',
    );
    jest.useRealTimers();
  });

  /// 新 agent 消息：同一组件继续 typewriter=true 时，替换文本必须重置进度。
  ///
  /// 数据构造：
  ///   old msg seq=10, text="abcdef"
  ///   new msg seq=11, text="uvwxyz"
  ///   旧消息 advance 36ms → 已显示 2 个字素
  ///
  /// 执行过程：
  ///   1. render old message with typewriter=true
  ///   2. advanceTimersByTime(36ms) → old visible count = 2
  ///   3. rerender new seq while typewriter 仍为 true
  ///   4. advanceTimersByTime(18ms) → 新消息从 0 开始显示第 1 个字素
  ///
  /// 预期结果：
  ///   - 正断言：新消息首轮只显示 "u▌"
  ///   - 负断言：不应立即显示 "uv▌"，否则泄漏了上一条消息的进度
  it('resets reveal progress when a new agent message replaces the previous one', () => {
    jest.useFakeTimers();
    const oldMsg = makeAgentMsg('abcdef');
    const newMsg = { ...makeAgentMsg('uvwxyz'), seq: 11 };
    const { rerender, getByText, queryByText } = render(<MessageBubble msg={oldMsg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(36);
    });

    act(() => {
      rerender(<MessageBubble msg={newMsg} typewriter />);
    });

    assertFalse(
      !!queryByText('uv▌'),
      'new message must not inherit the previous message reveal count before its first tick',
    );

    act(() => {
      jest.advanceTimersByTime(18);
    });

    assertTrue(!!getByText('u▌'), 'new message should start revealing from its first grapheme');
    jest.useRealTimers();
  });
});
