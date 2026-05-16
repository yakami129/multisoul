/// MermaidFullscreen 组件：全屏 Modal 查看 Mermaid 图形
///
/// 测试1：visible=true 时渲染 Modal 和 WebView
///   输入：visible=true, code="flowchart TD\n  A --> B", onClose=jest.fn()
///   预期：testID="mermaid-fullscreen-modal" 存在，testID="mermaid-fullscreen-webview" 存在
///
/// 测试2：visible=false 时不渲染内容
///   输入：visible=false
///   预期：testID="mermaid-fullscreen-webview" 不存在
///
/// 测试3：点击关闭按钮触发 onClose
///   输入：visible=true, onClose=jest.fn()
///   执行：fireEvent.press(testID="mermaid-fullscreen-close")
///   预期：onClose 被调用一次
///
/// 测试4：点击重置按钮存在（不验证动画值，动画由 reanimated mock 处理）
///   输入：visible=true
///   预期：testID="mermaid-fullscreen-reset" 存在

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { MermaidFullscreen } from './MermaidFullscreen';

jest.mock('./mermaidAsset', () => ({
  loadMermaidSource: jest.fn().mockResolvedValue('window.mermaid = { render: function(){} };'),
}));

describe('MermaidFullscreen', () => {
  it('renders modal and webview when visible', async () => {
    const { getByTestId } = render(
      <MermaidFullscreen visible={true} code="flowchart TD\n  A --> B" onClose={jest.fn()} />,
    );
    // 断言失败 = visible=true 时 Modal 未渲染
    expect(getByTestId('mermaid-fullscreen-modal')).toBeTruthy();
    await waitFor(() => expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy());
    // 断言失败 = visible=true 时 WebView 未渲染
    expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy();
  });

  it('does not render webview when not visible', () => {
    const { queryByTestId } = render(
      <MermaidFullscreen visible={false} code="flowchart TD\n  A --> B" onClose={jest.fn()} />,
    );
    // 断言失败 = visible=false 时 WebView 仍被渲染（性能浪费）
    expect(queryByTestId('mermaid-fullscreen-webview')).toBeNull();
  });

  it('calls onClose when close button is pressed', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <MermaidFullscreen visible={true} code="flowchart TD\n  A --> B" onClose={onClose} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy());
    fireEvent.press(getByTestId('mermaid-fullscreen-close'));
    // 断言失败 = 点击关闭按钮未触发 onClose
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders reset button', async () => {
    const { getByTestId } = render(
      <MermaidFullscreen visible={true} code="flowchart TD\n  A --> B" onClose={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy());
    // 断言失败 = 全屏模式缺少重置按钮
    expect(getByTestId('mermaid-fullscreen-reset')).toBeTruthy();
  });

  /// MermaidFullscreen 渲染失败降级：WebView 内部 Mermaid parse/render 错误必须显示源码
  ///
  /// 数据构造：
  ///   visible=true
  ///   code="invalid @@@@"
  ///   WebView postMessage: {"type":"error","message":"parse failed"}
  ///
  /// 执行过程：
  ///   1. render 全屏 Mermaid
  ///   2. 等待 WebView 出现
  ///   3. 模拟 WebView onMessage 发送 error
  ///
  /// 预期结果：
  ///   - 正断言：testID="mermaid-fullscreen-error" 出现并显示原始源码
  ///   - 负断言：testID="mermaid-fullscreen-webview" 消失，避免继续展示空白 WebView
  it('shows code fallback when fullscreen WebView reports a mermaid render error', async () => {
    const { getByTestId, queryByTestId } = render(
      <MermaidFullscreen visible={true} code="invalid @@@@" onClose={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy());

    fireEvent(getByTestId('mermaid-fullscreen-webview'), 'onMessage', {
      nativeEvent: { data: JSON.stringify({ type: 'error', message: 'parse failed' }) },
    });

    // 断言失败 = 全屏 Mermaid 渲染失败后没有展示源码降级
    expect(getByTestId('mermaid-fullscreen-error')).toBeTruthy();
    // 断言失败 = 源码降级内容缺失，用户无法查看原始 mermaid
    expect(getByTestId('mermaid-fullscreen-error-code').props.children).toBe('invalid @@@@');
    // 断言失败 = 出错后仍保留 WebView，可能继续显示空白或反复报错
    expect(queryByTestId('mermaid-fullscreen-webview')).toBeNull();
  });
});
