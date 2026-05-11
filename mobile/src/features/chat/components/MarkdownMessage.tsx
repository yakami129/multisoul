import * as Clipboard from 'expo-clipboard';
import React, { memo, useState } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { MarkdownImage } from './MarkdownImage';

interface Props {
  content: string;
}

// CopyButton — standalone component so useState is scoped per code block.
// Exported for direct unit testing.
export function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handlePress = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Pressable
      testID="copy-btn"
      onPress={() => {
        void handlePress();
      }}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter',
          fontSize: 10,
          color: copied ? '#4CAF50' : '#555555',
          letterSpacing: 0.5,
        }}
      >
        {copied ? '✓ COPIED' : 'COPY'}
      </Text>
    </Pressable>
  );
}

// Styles defined outside component — stable reference, no re-creation on render.
const mdStyles = {
  body: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#DDDDDD',
    lineHeight: 20,
    backgroundColor: 'transparent',
  },
  heading1: {
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginTop: 6,
    marginBottom: 4,
  },
  heading3: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600' as const,
    marginTop: 4,
    marginBottom: 2,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { color: '#DDDDDD', fontFamily: 'Inter', fontSize: 14 },
  bullet_list_icon: { color: '#888888' },
  ordered_list_icon: { color: '#888888' },
  code_inline: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#FF6B35',
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#1E1E1E',
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
    position: 'relative' as const,
  },
  code_block: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#DDDDDD',
    backgroundColor: 'transparent',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#FF6B35',
    paddingLeft: 10,
    marginVertical: 4,
  },
  blockquote_text: { color: '#888888' },
  hr: { backgroundColor: '#1E1E1E', height: 1, marginVertical: 8 },
  strong: { color: '#FFFFFF' },
  em: { color: '#DDDDDD' },
  table: { marginVertical: 4 },
  thead: { backgroundColor: '#1A1A1A' },
  th: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    padding: 6,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  td: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#DDDDDD',
    padding: 6,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    backgroundColor: '#1A1A1A',
  },
  tr: {},
};

type MarkdownStyles = Record<string, StyleProp<TextStyle>>;

function selectableTextStyle(
  styles: MarkdownStyles,
  key: string,
  inheritedStyles?: StyleProp<TextStyle>,
) {
  return inheritedStyles ? [inheritedStyles, styles[key]] : styles[key];
}

// Rule renderers defined at module scope — stable references, no unstable-nested-components.
function renderFence(node: { key: string; content: string }) {
  return (
    <View key={node.key} style={mdStyles.fence}>
      <Text selectable style={mdStyles.code_block}>
        {node.content}
      </Text>
      <CopyButton code={node.content} />
    </View>
  );
}

function renderTable(node: { key: string }, children: React.ReactNode) {
  return (
    <ScrollView
      key={node.key}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginVertical: 4 }}
    >
      <View>{children}</View>
    </ScrollView>
  );
}

function renderImage(
  node: ASTNode,
  _children: React.ReactNode[],
  _parent: ASTNode[],
  _styles: MarkdownStyles,
  _allowedImageHandlers?: string[],
  _defaultImageHandler?: string,
) {
  const src = String(node.attributes.src ?? '');
  const alt = String(node.attributes.alt ?? '');
  return <MarkdownImage key={node.key} src={src} alt={alt} />;
}

function renderSelectableText(
  node: ASTNode,
  _children: React.ReactNode[],
  _parent: ASTNode[],
  styles: MarkdownStyles,
  inheritedStyles?: StyleProp<TextStyle>,
) {
  return (
    <Text key={node.key} selectable style={selectableTextStyle(styles, 'text', inheritedStyles)}>
      {node.content}
    </Text>
  );
}

function renderSelectableTextGroup(
  node: ASTNode,
  children: React.ReactNode[],
  _parent: ASTNode[],
  styles: MarkdownStyles,
) {
  return (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  );
}

function renderSelectableStyledChildren(styleKey: string) {
  return (
    node: ASTNode,
    children: React.ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
    inheritedStyles?: StyleProp<TextStyle>,
  ) => (
    <Text key={node.key} selectable style={selectableTextStyle(styles, styleKey, inheritedStyles)}>
      {children}
    </Text>
  );
}

function renderSelectableContent(styleKey: string) {
  return (
    node: ASTNode,
    _children: React.ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
    inheritedStyles?: StyleProp<TextStyle>,
  ) => (
    <Text key={node.key} selectable style={selectableTextStyle(styles, styleKey, inheritedStyles)}>
      {node.content}
    </Text>
  );
}

function renderSelectableBreak(styleKey: 'hardbreak' | 'softbreak') {
  return (
    node: ASTNode,
    _children: React.ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
  ) => (
    <Text key={node.key} selectable style={styles[styleKey]}>
      {'\n'}
    </Text>
  );
}

export const mdRules: RenderRules = {
  text: renderSelectableText,
  textgroup: renderSelectableTextGroup,
  strong: renderSelectableStyledChildren('strong'),
  em: renderSelectableStyledChildren('em'),
  s: renderSelectableStyledChildren('s'),
  inline: renderSelectableStyledChildren('inline'),
  span: renderSelectableStyledChildren('span'),
  code_inline: renderSelectableContent('code_inline'),
  code_block: renderSelectableContent('code_block'),
  hardbreak: renderSelectableBreak('hardbreak'),
  softbreak: renderSelectableBreak('softbreak'),
  fence: renderFence,
  table: renderTable,
  image: renderImage,
};

export const MarkdownMessage = memo(function MarkdownMessage({ content }: Props) {
  return (
    <Markdown style={mdStyles} rules={mdRules}>
      {content}
    </Markdown>
  );
});
