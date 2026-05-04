import React from 'react';
import { Text, View } from 'react-native';

// Minimal mock: renders children as plain text wrapped in a View.
// Tests that need to verify Markdown output should test MarkdownMessage.tsx
// (which wraps this library), not the library itself.
const Markdown = ({ children }: { children: string }) => (
  <View testID="markdown-root">
    <Text>{children}</Text>
  </View>
);

export default Markdown;
