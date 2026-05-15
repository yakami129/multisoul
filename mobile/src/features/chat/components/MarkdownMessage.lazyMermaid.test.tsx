/// 普通 Markdown 渲染：不应在进入 chat 页面时加载 Mermaid/WebView 原生模块
///
/// 数据构造：
///   content = "plain chat text"
///   react-native-webview mock 被设置为一旦加载就 throw
///   react-native-markdown-display mock 只调用 text rule 渲染普通文本
///
/// 执行过程：
///   1. isolateModules 重新 import MarkdownMessage
///   2. render <MarkdownMessage content="plain chat text" />
///   3. Markdown mock 只走普通 text rule，不触发 mermaid fence
///
/// 预期结果：
///   - 正断言：普通文本渲染成功
///   - 负断言：react-native-webview 不应被加载，否则说明普通 chat 仍会触发 Mermaid/WebView 原生模块

import { render } from '@testing-library/react-native';
import React from 'react';
import { MarkdownMessage } from './MarkdownMessage';

jest.mock('react-native-webview', () => {
  throw new Error('react-native-webview should not load for plain markdown');
});

jest.mock('./MarkdownImage', () => ({
  MarkdownImage: () => {
    const { View } = require('react-native');
    return <View testID="markdown-image-thumb-press" />;
  },
}));

jest.mock('react-native-markdown-display', () => {
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      rules,
    }: {
      children: string;
      rules?: { text?: (...args: unknown[]) => unknown };
    }) => {
      const content = String(children);
      const node = {
        key: 'plain-text-node',
        content,
        attributes: {},
        children: [],
      };
      const renderedText = rules?.text?.(node, [], [], { text: {} }) ?? <Text>{content}</Text>;
      return <View testID="markdown-root">{renderedText}</View>;
    },
  };
});

describe('MarkdownMessage lazy Mermaid loading', () => {
  it('does not load react-native-webview for non-mermaid markdown content', () => {
    const { getByText } = render(<MarkdownMessage content="plain chat text" />);

    // 断言失败 = 普通聊天文本没有正常渲染
    expect(getByText('plain chat text')).toBeTruthy();
  });
});
