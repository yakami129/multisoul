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

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { View } from 'react-native';
import {
  MarkdownMessage,
  CopyButton,
  mdRules,
  makeImageRule,
  setMermaidFenceModuleLoaderForTest,
} from './MarkdownMessage';

jest.mock('./MarkdownImage', () => ({
  MarkdownImage: ({ src: _src, alt }: { src: string; alt: string }) => {
    const { View } = require('react-native');
    return <View testID="markdown-image-thumb-press" accessibilityLabel={alt} />;
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
        type: 'text',
        sourceType: 'text',
        key: 'markdown-text-node',
        content,
        markup: '',
        tokenIndex: 0,
        index: 0,
        attributes: {},
        children: [],
      };
      const renderedText = rules?.text?.(node, [], [], { text: {} }) ?? <Text>{content}</Text>;

      return <View testID="markdown-root">{renderedText}</View>;
    },
  };
});

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

  /// Markdown AI 回复：普通文本节点应支持系统长按选择/复制
  ///
  /// 数据构造：
  ///   content = "copyable AI reply"
  ///   Markdown mock 会调用 rules.text 渲染普通 text AST 节点
  ///
  /// 执行过程：
  ///   1. render MarkdownMessage → rules.text 生成 Text
  ///   2. 找到内容 Text 节点
  ///   3. 读取 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：Markdown 普通文本 Text selectable=true，历史 AI 回复可复制
  ///   - 负断言：普通 Markdown 文本不应出现 code copy-btn，只保留原生文本复制
  it('makes markdown text selectable for native copy', () => {
    const { getByText, queryByTestId } = render(<MarkdownMessage content="copyable AI reply" />);

    expect(getByText('copyable AI reply').props.selectable).toBe(
      true,
      'markdown text should set selectable=true so historical AI replies can be copied',
    );
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'plain markdown text should not render the code-block copy button',
    );
  });

  /// Markdown 段落容器：父级 paragraph 也必须 selectable，避免只给叶子 text 设置后长按无选择菜单。
  ///
  /// 数据构造：
  ///   paragraph node.key = 'paragraph-1'
  ///   children = ['copy selected paragraph']
  ///   styles.paragraph = {}
  ///
  /// 执行过程：
  ///   1. 直接调用 mdRules.paragraph，模拟 Markdown 渲染普通段落容器
  ///   2. render 返回的 paragraph Text
  ///   3. 读取该 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：段落 Text selectable=true，历史 AI 回复的普通段落可长按选取
  ///   - 负断言：普通段落不渲染 copy-btn，避免退化成只能整块复制代码按钮
  it('makes markdown paragraph containers selectable for native text selection', () => {
    const node = { key: 'paragraph-1', attributes: {} };
    const element = mdRules.paragraph?.(node as any, ['copy selected paragraph'], [], {
      paragraph: {},
    });

    const { getByText, queryByTestId } = render(element as React.ReactElement);

    expect(getByText('copy selected paragraph').props.selectable).toBe(
      true,
      'markdown paragraph container should be selectable so native selection can start on completed AI replies',
    );
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'markdown paragraph text should not use the code-block copy button',
    );
  });

  /// Markdown 图片段落：含非 Text 子节点时 paragraph 必须回退 View，避免 Text 内嵌图片 View。
  ///
  /// 数据构造：
  ///   paragraph node.key = 'paragraph-with-image'
  ///   children = [<View testID="inline-image-node" />]（模拟 MarkdownImage 渲染结果）
  ///   styles._VIEW_SAFE_paragraph = {}
  ///
  /// 执行过程：
  ///   1. 直接调用 mdRules.paragraph，传入非文本子节点
  ///   2. render 返回节点
  ///   3. 查找 inline-image-node
  ///
  /// 预期结果：
  ///   - 正断言：inline-image-node 存在，说明图片段落仍可渲染
  ///   - 负断言：图片段落不渲染 copy-btn，避免图片路径被误当代码块复制
  it('keeps markdown image paragraphs renderable by falling back to View', () => {
    const node = { key: 'paragraph-with-image', attributes: {} };
    const element = mdRules.paragraph?.(
      node as any,
      [<View key="inline-image-node" testID="inline-image-node" />],
      [],
      { _VIEW_SAFE_paragraph: {} },
    );

    const { getByTestId, queryByTestId } = render(element as React.ReactElement);

    expect(getByTestId('inline-image-node')).toBeTruthy();
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'markdown image paragraph should not render the code-block copy button',
    );
  });

  /// Markdown 标题容器：标题文本也必须 selectable，避免 AI 回复中的标题无法单独复制。
  ///
  /// 数据构造：
  ///   heading1 node.key = 'heading-1'
  ///   children = ['Copyable Heading']
  ///   styles.heading1 = {}
  ///
  /// 执行过程：
  ///   1. 直接调用 mdRules.heading1，模拟 "# Copyable Heading"
  ///   2. render 返回的 heading Text
  ///   3. 读取该 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：标题 Text selectable=true，标题可被用户单独选择复制
  ///   - 负断言：标题不渲染 code copy-btn，避免把标题误当代码块处理
  it('makes markdown heading containers selectable for native text selection', () => {
    const node = { key: 'heading-1', attributes: {} };
    const element = mdRules.heading1?.(node as any, ['Copyable Heading'], [], { heading1: {} });

    const { getByText, queryByTestId } = render(element as React.ReactElement);

    expect(getByText('Copyable Heading').props.selectable).toBe(
      true,
      'markdown heading container should be selectable so AI reply headings can be copied',
    );
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'markdown heading text should not render the code-block copy button',
    );
  });

  /// Markdown 链接：链接文字既保留点击打开，也必须 selectable，避免 URL/锚文本无法选择复制。
  ///
  /// 数据构造：
  ///   link node.key = 'link-1'
  ///   node.attributes.href = 'https://example.com'
  ///   children = ['Example Link']
  ///
  /// 执行过程：
  ///   1. 直接调用 mdRules.link，模拟 Markdown 链接节点
  ///   2. render 返回的 link Text
  ///   3. 读取该 Text.props.selectable
  ///
  /// 预期结果：
  ///   - 正断言：链接 Text selectable=true，用户可选择复制链接文字
  ///   - 负断言：链接不渲染 copy-btn，避免普通链接被当作代码块复制
  it('makes markdown links selectable while keeping them as text nodes', () => {
    const node = { key: 'link-1', attributes: { href: 'https://example.com' } };
    const element = mdRules.link?.(node as any, ['Example Link'], [], { link: {} });

    const { getByText, queryByTestId } = render(element as React.ReactElement);

    expect(getByText('Example Link').props.selectable).toBe(
      true,
      'markdown link text should be selectable so users can copy link labels from AI replies',
    );
    expect(queryByTestId('copy-btn') === null).toBe(
      true,
      'markdown link text should not render the code-block copy button',
    );
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

describe('makeImageRule', () => {
  /// image rule 直接调用：给定 src 和 alt，渲染出 MarkdownImage
  ///
  /// 数据构造：
  ///   node = { key: 'img-1', attributes: { src: 'https://example.com/img.png', alt: 'test' } }
  ///   serverUrl = 'http://localhost:8765', token = 'tok'
  ///
  /// 执行过程：
  ///   1. makeImageRule('http://localhost:8765', 'tok') → renderImage 函数
  ///   2. 调用 renderImage(node, [], [], {}) → 返回 React element
  ///   3. render 该 element
  ///
  /// 预期结果：
  ///   - testID="markdown-image-thumb-press" 存在（MarkdownImage 被渲染）
  ///   - accessibilityLabel="test"（alt 正确传入）
  it('renders MarkdownImage with correct src and alt', () => {
    const node = { key: 'img-1', attributes: { src: 'https://example.com/img.png', alt: 'test' } };
    const renderImage = makeImageRule('http://localhost:8765', 'tok');
    const element = renderImage(node as any, [], [], {} as any);
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
    const renderImage = makeImageRule('http://localhost:8765', 'tok');
    const element = renderImage(node as any, [], [], {} as any);
    const { getByTestId } = render(element as React.ReactElement);

    // 断言失败 = 缺少 alt 时 image rule 崩溃或未渲染 MarkdownImage
    expect(getByTestId('markdown-image-thumb-press')).toBeTruthy();
    // 断言失败 = alt 缺省值应为空字符串
    expect(getByTestId('markdown-image-thumb-press').props.accessibilityLabel).toBe('');
  });
});

describe('MarkdownMessage mermaid fence', () => {
  beforeEach(() => {
    setMermaidFenceModuleLoaderForTest(async () => ({
      MermaidFence: ({ code }: { code: string }) => {
        const { Pressable, Text, View } = require('react-native');
        const [visible, setVisible] = React.useState(false);
        return (
          <>
            <Pressable testID="mermaid-block-mock" onPress={() => setVisible(true)}>
              <Text>{code}</Text>
            </Pressable>
            {visible ? <View testID="mermaid-fullscreen-mock" /> : null}
          </>
        );
      },
    }));
  });

  afterEach(() => {
    setMermaidFenceModuleLoaderForTest(null);
  });

  /// mermaid fence rule：```mermaid 代码块渲染为 MermaidBlock，Mermaid 源码由静态资产 loader 提供
  ///
  /// 数据构造：
  ///   通过 makeMermaidFenceRule 导出的函数直接调用
  ///   node.sourceInfo='mermaid', node.content='flowchart TD\n  A --> B'
  ///
  /// 执行过程：
  ///   1. 调用 makeMermaidFenceRule() 获取 fence render 函数
  ///   2. 传入 mermaid node
  ///   3. render 返回的 element，等待 Mermaid 组件懒加载完成
  ///
  /// 预期结果：
  ///   - 正断言：testID="mermaid-block-mock" 存在（MermaidBlock 被渲染）
  ///   - 负断言：testID="mermaid-error" 不存在（未回退到错误状态）
  it('renders MermaidBlock for mermaid fence node', async () => {
    const { makeMermaidFenceRule } = require('./MarkdownMessage');
    const renderFence = makeMermaidFenceRule();
    const node = {
      key: 'fence-1',
      content: 'flowchart TD\n  A --> B',
      sourceInfo: 'mermaid',
    };
    const element = renderFence(node);
    const { getByTestId, queryByTestId } = render(element as React.ReactElement);

    await waitFor(() => {
      // 断言失败 = mermaid fence 未渲染 MermaidBlock
      expect(getByTestId('mermaid-block-mock')).toBeTruthy();
    });
    // 断言失败 = mermaid fence 不应显示错误状态
    expect(queryByTestId('mermaid-error')).toBeNull();
  });

  /// 非 mermaid fence：sourceInfo 不是 'mermaid' 时，渲染原有代码块
  ///
  /// 数据构造：
  ///   node.sourceInfo = 'js', node.content = 'console.log(1)'
  ///
  /// 预期结果：
  ///   - testID="mermaid-block-mock" 不存在
  ///   - 原始代码内容 'console.log(1)' 存在于渲染树中
  it('renders normal code block for non-mermaid fence', () => {
    const { makeMermaidFenceRule } = require('./MarkdownMessage');
    const renderFence = makeMermaidFenceRule();
    const node = {
      key: 'fence-2',
      content: 'console.log(1)',
      sourceInfo: 'js',
    };
    const element = renderFence(node);
    const { queryByTestId, getByText } = render(element as React.ReactElement);

    // 断言失败 = 非 mermaid fence 不应渲染 MermaidBlock
    expect(queryByTestId('mermaid-block-mock')).toBeNull();
    // 断言失败 = 非 mermaid fence 应显示原始代码内容
    expect(getByText('console.log(1)')).toBeTruthy();
  });

  /// 点击 MermaidBlock 触发全屏 Modal 显示
  ///
  /// 执行过程：
  ///   1. render mermaid fence element
  ///   2. press testID="mermaid-block-mock"
  ///   3. 等待 MermaidBlock 懒加载完成后 press testID="mermaid-block-mock"
  ///   4. 检查 testID="mermaid-fullscreen-mock" 出现
  ///
  /// 预期结果：
  ///   - press 前：testID="mermaid-fullscreen-mock" 不存在
  ///   - press 后：testID="mermaid-fullscreen-mock" 存在
  it('shows MermaidFullscreen when MermaidBlock is pressed', async () => {
    const { makeMermaidFenceRule } = require('./MarkdownMessage');
    const renderFence = makeMermaidFenceRule();
    const node = {
      key: 'fence-3',
      content: 'flowchart TD\n  A --> B',
      sourceInfo: 'mermaid',
    };
    const element = renderFence(node);
    const { getByTestId, queryByTestId } = render(element as React.ReactElement);

    // 断言失败 = 初始状态不应显示全屏 Modal
    expect(queryByTestId('mermaid-fullscreen-mock')).toBeNull();

    await waitFor(() => expect(getByTestId('mermaid-block-mock')).toBeTruthy());
    fireEvent.press(getByTestId('mermaid-block-mock'));

    // 断言失败 = 点击 MermaidBlock 后应显示全屏 Modal
    expect(getByTestId('mermaid-fullscreen-mock')).toBeTruthy();
  });
});
