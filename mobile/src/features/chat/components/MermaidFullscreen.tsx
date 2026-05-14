import { RotateCcw, X } from 'lucide-react-native';
import React from 'react';
import { Modal, Pressable } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';
import mermaidSrc from '../../../assets/mermaid.min.js';

interface Props {
  visible: boolean;
  code: string;
  onClose: () => void;
}

// buildFullscreenHtml — generates the HTML string loaded by the fullscreen WebView.
// mermaid.js is inlined from the local bundle so it works offline.
// Uses dark theme on a #0D0D0D background to match the design system.
function buildFullscreenHtml(code: string): string {
  const escaped = code.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px; background: #0D0D0D; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .mermaid svg { max-width: 100%; height: auto; }
</style>
<script>${mermaidSrc}</script>
</head>
<body>
<div class="mermaid" id="graph"></div>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  mermaid.render('mermaid-svg-full', \`${escaped}\`)
    .then(function(result) {
      document.getElementById('graph').innerHTML = result.svg;
    })
    .catch(function() {});
</script>
</body>
</html>`;
}

export function MermaidFullscreen({ visible, code, onClose }: Props) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(0.5, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  function handleReset() {
    scale.value = withSpring(1);
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  }

  return (
    <Modal
      testID="mermaid-fullscreen-modal"
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0D0D0D' }}>
        <Pressable
          testID="mermaid-fullscreen-close"
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 56,
            right: 20,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#1A1A1A',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <X size={18} color="#888888" />
        </Pressable>

        <Pressable
          testID="mermaid-fullscreen-reset"
          onPress={handleReset}
          style={{
            position: 'absolute',
            top: 56,
            right: 72,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#1A1A1A',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <RotateCcw size={16} color="#888888" />
        </Pressable>

        {visible && (
          <GestureDetector gesture={composed}>
            <Animated.View style={[{ flex: 1 }, animatedStyle]}>
              <WebView
                testID="mermaid-fullscreen-webview"
                source={{ html: buildFullscreenHtml(code) }}
                style={{ flex: 1, backgroundColor: '#0D0D0D' }}
                scrollEnabled={false}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}
