import React from 'react';
import { Text, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { MermaidBlock } from './MermaidBlock';
import { MermaidFullscreen } from './MermaidFullscreen';

export function MermaidFence({ code }: { code: string }) {
  const [fullscreenCode, setFullscreenCode] = React.useState<string | null>(null);
  return (
    <>
      <MermaidBlock code={code} onFullscreen={() => setFullscreenCode(code)} />
      <MermaidFullscreen
        visible={fullscreenCode !== null}
        code={fullscreenCode ?? code}
        onClose={() => setFullscreenCode(null)}
      />
    </>
  );
}

export function MermaidFenceLoading() {
  return (
    <View testID="mermaid-loading" style={{ marginVertical: 6 }}>
      <Text style={{ fontFamily: 'Inter', fontSize: 12, color: brandColors.textMuted }}>
        Rendering diagram...
      </Text>
    </View>
  );
}
