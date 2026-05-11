/// MarkdownMessage 组件：渲染 Markdown 内容并提供代码块复制按钮
///
/// 测试1：基础渲染
///   输入：content = "# Hello\n\nsome text"
///   预期：testID="markdown-root" 存在（mock 正常挂载）
///
/// 测试2：代码块内容时 markdown-root 仍正常渲染
///   输入：content = "```js\nconsole.log(1)\n```"
///   注意：mock 把整个 Markdown 组件替换，fence rule 不会被调用；
///         只验证渲染不崩溃，copy-btn 集成覆盖留给 e2e。
///   预期：testID="markdown-root" 存在，不崩溃
///
/// 测试3：空字符串 content 不崩溃
///   输入：content = ""
///   预期：正常渲染，不抛异常
///
/// 测试4：CopyButton 独立测试（直接渲染 CopyButton）
///   数据：code = "const x = 1"
///   执行：press testID="copy-btn"
///   预期：按钮文字变为 "✓ COPIED"；1.5s 后恢复 "COPY"
///
/// 测试5：image rule 直接调用测试
///   数据：node = { key: 'img-1', attributes: { src: 'https://example.com/img.png', alt: 'test' } }
///   执行：直接调用 mdRules.image(node, [], [], {})
///   预期：渲染结果包含 testID="markdown-image-thumb-press"

import { act, fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { MarkdownMessage, CopyButton, mdRules } from './MarkdownMessage';

jest.mock('./MarkdownImage', () => ({
  MarkdownImage: ({ src: _src, alt }: { src: string; alt: string }) => {
    const { View } = require('react-native');
    return <View testID="markdown-image-thumb-press" accessibilityLabel={alt} />;
  },
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: jest.fn((selector: any) =>
    selector({ settings: { serverUrl: 'http://localhost:8765', apiKey: 'test-token' } }),
  ),
}));

describe('MarkdownMessage', () => {
  it('renders markdown root for normal content', () => {
    const { getByTestId } = render(<MarkdownMessage content="# Hello\n\nsome text" />);
    // 断言失败 = markdown-root 不存在 — MarkdownMessage 未正常挂载
    expect(getByTestId('markdown-root')).toBeTruthy();
  });

  it('renders markdown root without crash for code block content', () => {
    const { getByTestId } = render(<MarkdownMessage content={'```js\nconsole.log(1)\n```'} />);
    // 断言失败 = markdown-root 不存在 — 代码块内容导致 MarkdownMessage 崩溃或未挂载
    expect(getByTestId('markdown-root')).toBeTruthy();
  });

  it('renders without crash for empty content', () => {
    // 断言失败 = 空字符串 content 导致 MarkdownMessage 抛出异常
    expect(() => render(<MarkdownMessage content="" />)).not.toThrow();
  });
});

describe('CopyButton', () => {
  /// CopyButton 独立测试：点击复制 → COPIED → 1.5s 后恢复
  ///
  /// 数据构造：
  ///   code = "const x = 1"
  ///
  /// 执行过程：
  ///   1. render CopyButton → 显示 "COPY"
  ///   2. press copy-btn → Clipboard.setStringAsync 被调用
  ///   3. copied=true → 显示 "✓ COPIED"
  ///   4. advanceTimersByTime(1600) → copied=false → 显示 "COPY"
  ///
  /// 预期结果：
  ///   - 初始：getByText('COPY') 存在
  ///   - press 后：queryByText('COPY') 为 null，queryByText('✓ COPIED') 存在
  ///   - 1600ms 后：getByText('COPY') 存在，queryByText('✓ COPIED') 为 null
  it('shows COPIED feedback on press then resets after 1500ms', async () => {
    jest.useFakeTimers();
    const { getByText, queryByText, getByTestId } = render(<CopyButton code="const x = 1" />);

    // 断言失败 = 初始状态应显示 "COPY" 按钮文字
    expect(getByText('COPY')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('copy-btn'));
    });

    // 断言失败 = press 后 "COPY" 应消失，说明状态未切换到 copied=true
    expect(queryByText('COPY')).toBeNull();
    // 断言失败 = press 后应显示 "✓ COPIED" 反馈文字
    expect(queryByText('✓ COPIED')).toBeTruthy();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('const x = 1');

    act(() => {
      jest.advanceTimersByTime(1600);
    });
    // 断言失败 = 1600ms 后应恢复显示 "COPY"，说明 setTimeout 重置未生效
    expect(queryByText('COPY')).toBeTruthy();
    // 断言失败 = 1600ms 后 "✓ COPIED" 应消失，说明 copied 状态未正确重置
    expect(queryByText('✓ COPIED')).toBeNull();

    jest.useRealTimers();
  });
});

describe('mdRules.image', () => {
  /// image rule 直接调用：给定 src 和 alt，渲染出 MarkdownImage
  ///
  /// 数据构造：
  ///   node = { key: 'img-1', attributes: { src: 'https://example.com/img.png', alt: 'test' } }
  ///
  /// 执行过程：
  ///   1. 直接调用 mdRules.image(node, [], [], {}) → 返回 React element
  ///   2. render 该 element
  ///
  /// 预期结果：
  ///   - testID="markdown-image-thumb-press" 存在（MarkdownImage 被渲染）
  ///   - accessibilityLabel="test"（alt 正确传入）
  it('renders MarkdownImage with correct src and alt', () => {
    const node = { key: 'img-1', attributes: { src: 'https://example.com/img.png', alt: 'test' } };
    const element = mdRules.image(node as any, [], [], {} as any);
    const { getByTestId } = render(element as React.ReactElement);

    // 断言失败 = MarkdownImage 未被 image rule 渲染
    expect(getByTestId('markdown-image-thumb-press')).toBeTruthy();
    // 断言失败 = alt 未正确传入 MarkdownImage
    expect(getByTestId('markdown-image-thumb-press').props.accessibilityLabel).toBe('test');
  });

  /// image rule 缺省值：attributes 中无 alt 时，alt 默认为空字符串
  ///
  /// 数据构造：
  ///   node = { key: 'img-2', attributes: { src: 'https://example.com/img.png' } }
  ///
  /// 预期结果：
  ///   - testID="markdown-image-thumb-press" 存在
  ///   - accessibilityLabel="" （alt 缺省为空字符串，不崩溃）
  it('defaults alt to empty string when undefined', () => {
    const node = { key: 'img-2', attributes: { src: 'https://example.com/img.png' } };
    const element = mdRules.image(node as any, [], [], {} as any);
    const { getByTestId } = render(element as React.ReactElement);

    // 断言失败 = 缺少 alt 时 image rule 崩溃或未渲染 MarkdownImage
    expect(getByTestId('markdown-image-thumb-press')).toBeTruthy();
    // 断言失败 = alt 缺省值应为空字符串
    expect(getByTestId('markdown-image-thumb-press').props.accessibilityLabel).toBe('');
  });
});
