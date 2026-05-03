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
