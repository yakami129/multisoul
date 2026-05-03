import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import type { WsMessage } from '@/types';
import { MessageBubble } from './MessageBubble';

afterEach(() => {
  jest.useRealTimers();
});

const agentMessage: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'agent_text',
  payload: { text: 'system online' },
  created_at: 0,
};

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
  expect(StyleSheet.flatten(scanningText.props.style).color).toBe('#20C20E');

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

  it('renders attachment placeholder when file_id present but no imageUri', () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('📎 Image')).toBeTruthy();
  });

  it('renders plain text bubble when no file_id', () => {
    const msg = makeUserMsg({ text: 'hello' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('hello')).toBeTruthy();
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
});
