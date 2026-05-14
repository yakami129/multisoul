import { Maximize2 } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type WebViewType from 'react-native-webview';
import { loadMermaidSource } from './mermaidAsset';

interface Props {
  code: string;
  onFullscreen: () => void;
}

// buildHtml — generates the HTML string loaded by WebView.
// mermaid.js is inlined from the local bundle so it works offline.
// On render success, postMessage({ type: 'height', value: <px> }).
// On render error, postMessage({ type: 'error', message: <string> }).
function buildHtml(code: string, mermaidSrc: string): string {
  const escaped = code.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 8px; background: #1A1A1A; }
  .mermaid svg { max-width: 100%; height: auto; }
</style>
<script>${mermaidSrc}</script>
</head>
<body>
<div class="mermaid" id="graph"></div>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  mermaid.render('mermaid-svg', \`${escaped}\`)
    .then(function(result) {
      document.getElementById('graph').innerHTML = result.svg;
      var h = document.body.scrollHeight;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
    })
    .catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: String(err) }));
    });
</script>
</body>
</html>`;
}

type HeightMessage = { type: 'height'; value: number };
type ErrorMessage = { type: 'error'; message: string };
type WebViewMessage = HeightMessage | ErrorMessage;

export function MermaidBlock({ code, onFullscreen }: Props) {
  const [height, setHeight] = useState(80);
  const [hasError, setHasError] = useState(false);
  const [mermaidSrc, setMermaidSrc] = useState<string | null>(null);
  const webviewRef = useRef<InstanceType<typeof WebViewType> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadMermaidSource()
      .then((src) => {
        if (!cancelled) setMermaidSrc(src);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as WebViewMessage;
      if (msg.type === 'height' && typeof msg.value === 'number') {
        setHeight(msg.value);
      } else if (msg.type === 'error') {
        setHasError(true);
      }
    } catch {
      setHasError(true);
    }
  }

  if (hasError) {
    return (
      <View
        testID="mermaid-error"
        style={{
          backgroundColor: '#1A1A1A',
          borderWidth: 1,
          borderColor: '#1E1E1E',
          borderRadius: 8,
          padding: 12,
          marginVertical: 6,
        }}
      >
        <Text selectable style={{ fontFamily: 'Inter', fontSize: 12, color: '#DDDDDD' }}>
          {code}
        </Text>
      </View>
    );
  }

  if (!mermaidSrc) {
    return (
      <View testID="mermaid-loading" style={{ marginVertical: 6 }}>
        <Text style={{ fontFamily: 'Inter', fontSize: 12, color: '#888888' }}>
          Rendering diagram...
        </Text>
      </View>
    );
  }

  return (
    <Pressable testID="mermaid-thumb-press" onPress={onFullscreen}>
      <View
        testID="mermaid-webview-container"
        style={{
          height,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#1A1A1A',
          marginVertical: 6,
        }}
      >
        <WebView
          ref={webviewRef}
          testID="mermaid-webview"
          source={{ html: buildHtml(code, mermaidSrc) }}
          scrollEnabled={false}
          onMessage={handleMessage}
          onError={() => setHasError(true)}
          style={{ flex: 1, backgroundColor: 'transparent' }}
        />
        <View style={{ position: 'absolute', bottom: 8, right: 8 }} pointerEvents="none">
          <Maximize2 size={16} color="#FF6B35" />
        </View>
      </View>
    </Pressable>
  );
}
