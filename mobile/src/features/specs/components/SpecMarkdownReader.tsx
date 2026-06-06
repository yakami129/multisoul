import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MarkdownMessage } from '@/features/chat';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';

interface Props {
  markdown?: string;
  collapsed?: boolean;
}

const COLLAPSED_CHAR_LIMIT = 600;

function truncateMarkdown(md: string, limit: number): string {
  if (md.length <= limit) return md;
  const newlinePos = md.lastIndexOf('\n', limit);
  const cutAt = newlinePos > 0 ? newlinePos : limit;
  return md.slice(0, cutAt) + '\n\n*…full snapshot continues below.*';
}

export function SpecMarkdownReader({ markdown, collapsed = false }: Props) {
  const md = markdown ?? '';
  if (md.trim().length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>No markdown snapshot is cached yet.</Text>
      </View>
    );
  }
  const content = collapsed ? truncateMarkdown(md, COLLAPSED_CHAR_LIMIT) : md;
  return <MarkdownMessage content={content} />;
}

const s = StyleSheet.create({
  empty: {
    minHeight: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  emptyText: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 18,
    color: brandColors.textSoft,
    textAlign: 'center',
  },
});
