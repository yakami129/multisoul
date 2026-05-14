/// MermaidBlock 组件：渲染 Mermaid 代码为 WebView 缩略图
///
/// 测试1：正常渲染 — 显示 WebView，不显示错误状态
///   输入：code = "flowchart TD\n  A --> B"
///   预期：testID="mermaid-webview" 存在，testID="mermaid-error" 不存在
///
/// 测试2：错误状态 — WebView onError 触发后显示原始代码
///   输入：code = "invalid mermaid @@@@"
///   执行：fireEvent(webview, 'onError', { nativeEvent: {} })
///   预期：testID="mermaid-error" 存在，testID="mermaid-webview" 不存在
///
/// 测试3：点击触发 onFullscreen 回调
///   输入：code = "flowchart TD\n  A --> B", onFullscreen = jest.fn()
///   执行：fireEvent.press(testID="mermaid-thumb-press")
///   预期：onFullscreen 被调用一次
///
/// 测试4：WebView postMessage 高度回传 — 组件接收高度后更新 WebView 容器高度
///   输入：code = "flowchart TD\n  A --> B"
///   执行：fireEvent(webview, 'onMessage', { nativeEvent: { data: '{"type":"height","value":180}' } })
///   预期：testID="mermaid-webview-container" 的 style.height === 180

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { MermaidBlock } from './MermaidBlock';

jest.mock('./mermaidAsset', () => ({
  loadMermaidSource: jest.fn().mockResolvedValue('window.mermaid = { render: function(){} };'),
}));

describe('MermaidBlock', () => {
  it('renders WebView for valid mermaid code', async () => {
    const { getByTestId, queryByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-webview')).toBeTruthy());
    // 断言失败 = MermaidBlock 未渲染 WebView，mermaid 代码无法展示
    expect(getByTestId('mermaid-webview')).toBeTruthy();
    // 断言失败 = 正常代码不应显示错误状态
    expect(queryByTestId('mermaid-error')).toBeNull();
  });

  it('shows error fallback when WebView fires onError', async () => {
    const { getByTestId, queryByTestId } = render(
      <MermaidBlock code="invalid @@@@" onFullscreen={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-webview')).toBeTruthy());
    const webview = getByTestId('mermaid-webview');
    fireEvent(webview, 'onError', { nativeEvent: {} });

    // 断言失败 = onError 后应显示错误回退，但 mermaid-error 不存在
    expect(getByTestId('mermaid-error')).toBeTruthy();
    // 断言失败 = 错误状态下 WebView 应被隐藏
    expect(queryByTestId('mermaid-webview')).toBeNull();
  });

  it('calls onFullscreen when thumbnail is pressed', async () => {
    const onFullscreen = jest.fn();
    const { getByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={onFullscreen} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-thumb-press')).toBeTruthy());
    fireEvent.press(getByTestId('mermaid-thumb-press'));
    // 断言失败 = 点击缩略图未触发 onFullscreen 回调
    expect(onFullscreen).toHaveBeenCalledTimes(1);
  });

  it('updates container height from postMessage', async () => {
    const { getByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={jest.fn()} />,
    );
    await waitFor(() => expect(getByTestId('mermaid-webview')).toBeTruthy());
    const webview = getByTestId('mermaid-webview');
    fireEvent(webview, 'onMessage', {
      nativeEvent: { data: JSON.stringify({ type: 'height', value: 180 }) },
    });
    const container = getByTestId('mermaid-webview-container');
    // 断言失败 = postMessage 高度回传后容器高度未更新为 180
    expect(container.props.style.height).toBe(180);
  });
});
