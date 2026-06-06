import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';

interface Props {
  markdown?: string;
  collapsed?: boolean;
}

function lineKind(line: string): 'h1' | 'h2' | 'bullet' | 'code' | 'body' {
  if (line.startsWith('# ')) return 'h1';
  if (line.startsWith('## ')) return 'h2';
  if (/^[-*]\s+/.test(line)) return 'bullet';
  if (line.startsWith('```') || line.startsWith('    ')) return 'code';
  return 'body';
}

function cleanLine(line: string): string {
  return line.replace(/^#{1,2}\s+/, '').replace(/^[-*]\s+/, '• ');
}

export function SpecMarkdownReader({ markdown, collapsed = false }: Props) {
  const lines = (markdown ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const visibleLines = collapsed ? lines.slice(0, 18) : lines;

  if (visibleLines.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>No markdown snapshot is cached yet.</Text>
      </View>
    );
  }

  return (
    <View style={s.reader}>
      {visibleLines.map((line, index) => {
        const kind = lineKind(line.trim());
        return (
          <Text key={`${index}-${line}`} style={[s.line, s[kind]]}>
            {cleanLine(line.trim())}
          </Text>
        );
      })}
      {collapsed && lines.length > visibleLines.length ? (
        <Text style={s.more}>Full snapshot continues below.</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  reader: { gap: 8 },
  line: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 19,
    color: brandColors.ink,
  },
  h1: {
    fontFamily: brandTypography.display,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
  },
  h2: {
    marginTop: 6,
    fontFamily: brandTypography.body,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  bullet: { paddingLeft: 4 },
  code: {
    fontFamily: brandTypography.mono,
    fontSize: 12,
    lineHeight: 17,
    color: brandColors.white,
    backgroundColor: brandColors.darkPanel,
    padding: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  body: {},
  more: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.textSoft,
  },
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
