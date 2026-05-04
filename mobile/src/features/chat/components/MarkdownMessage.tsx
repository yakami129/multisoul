import * as Clipboard from 'expo-clipboard';
import React, { memo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

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
          color: copied ? '#33FF33' : '#0F6B0F',
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
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    lineHeight: 20,
    backgroundColor: 'transparent',
  },
  heading1: {
    fontFamily: 'Anton',
    fontSize: 18,
    color: '#33FF33',
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    fontFamily: 'Anton',
    fontSize: 16,
    color: '#33FF33',
    marginTop: 6,
    marginBottom: 4,
  },
  heading3: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#33FF33',
    fontWeight: '600' as const,
    marginTop: 4,
    marginBottom: 2,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { color: '#20C20E', fontFamily: 'Geist', fontSize: 14 },
  bullet_list_icon: { color: '#2D8B2D' },
  ordered_list_icon: { color: '#2D8B2D' },
  code_inline: {
    fontFamily: 'Geist Mono',
    fontSize: 12,
    color: '#33FF33',
    backgroundColor: '#0A1A0A',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  fence: {
    backgroundColor: '#0A1A0A',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
    padding: 12,
    marginVertical: 6,
    position: 'relative' as const,
  },
  code_block: {
    fontFamily: 'Geist Mono',
    fontSize: 12,
    color: '#20C20E',
    backgroundColor: 'transparent',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#0F2B0F',
    paddingLeft: 10,
    marginVertical: 4,
  },
  blockquote_text: { color: '#2D8B2D' },
  hr: { backgroundColor: '#0F2B0F', height: 1, marginVertical: 8 },
  strong: { color: '#33FF33' },
  em: { color: '#2D8B2D' },
  table: { marginVertical: 4 },
  thead: { backgroundColor: '#0F2B0F' },
  th: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#33FF33',
    padding: 6,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  td: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
    padding: 6,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    backgroundColor: '#061206',
  },
  tr: {},
};

// Rule renderers defined at module scope — stable references, no unstable-nested-components.
function renderFence(node: { key: string; content: string }) {
  return (
    <View key={node.key} style={mdStyles.fence}>
      <Text style={mdStyles.code_block}>{node.content}</Text>
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

const mdRules = { fence: renderFence, table: renderTable };

export const MarkdownMessage = memo(function MarkdownMessage({ content }: Props) {
  return (
    <Markdown style={mdStyles} rules={mdRules}>
      {content}
    </Markdown>
  );
});
