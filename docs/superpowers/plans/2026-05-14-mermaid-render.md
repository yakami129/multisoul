# Mermaid 流程图渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chat 消息气泡中渲染 Mermaid 代码块为可交互图形，支持全屏缩放/平移/重置，语法错误时回退显示原始代码。

**Architecture:** 在 `MarkdownMessage` 的 `fence` render rule 中拦截 language=`mermaid` 的代码块，替换为 `MermaidBlock` 组件。`MermaidBlock` 内联显示缩略图（WebView + mermaid.js 本地 bundle），点击后弹出 `MermaidFullscreen` Modal，Modal 内支持 react-native-gesture-handler 双指缩放和平移，以及重置按钮。

**Tech Stack:** react-native-webview（新增依赖）、react-native-gesture-handler（已有）、react-native-reanimated（已有）、mermaid.js（本地 bundle 写入 assets）

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `mobile/src/features/chat/components/MermaidBlock.tsx` | 新建 | 内联缩略图 + 点击触发全屏 |
| `mobile/src/features/chat/components/MermaidFullscreen.tsx` | 新建 | 全屏 Modal，手势缩放/平移/重置 |
| `mobile/src/features/chat/components/MermaidBlock.test.tsx` | 新建 | MermaidBlock 单元测试 |
| `mobile/src/features/chat/components/MermaidFullscreen.test.tsx` | 新建 | MermaidFullscreen 单元测试 |
| `mobile/src/features/chat/components/MarkdownMessage.tsx` | 修改 | fence rule 拦截 mermaid 语言标识 |
| `mobile/src/features/chat/components/MarkdownMessage.test.tsx` | 修改 | 补充 mermaid fence 渲染测试 |
| `mobile/assets/mermaid.min.js` | 新建 | mermaid.js 本地 bundle（离线可用） |
| `mobile/__mocks__/react-native-webview.js` | 新建 | Jest mock，避免 native 模块报错 |

---
## Task 1: 安装 react-native-webview 并创建 Jest mock

**Files:**
- Modify: `mobile/package.json`（通过 pnpm 安装）
- Create: `mobile/__mocks__/react-native-webview.js`

- [ ] **Step 1: 安装依赖**

```bash
cd mobile && pnpm add react-native-webview
```

Expected: `package.json` 中出现 `"react-native-webview": "^13.x.x"`

- [ ] **Step 2: 创建 Jest mock**

创建 `mobile/__mocks__/react-native-webview.js`：

```js
// Minimal mock for react-native-webview in Jest environment.
// WebView renders nothing; onMessage/onLoad callbacks can be triggered via ref.
const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef(function WebView(
  { testID, onMessage, onLoadEnd, onError },
  ref,
) {
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
  }));

  // Expose callbacks on the View so tests can trigger them via fireEvent
  return (
    <View
      testID={testID ?? 'webview'}
      onMessage={onMessage}
      onLoadEnd={onLoadEnd}
      onError={onError}
    />
  );
});

module.exports = { WebView, default: WebView };
```

- [ ] **Step 3: 验证 mock 被 Jest 识别**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MarkdownMessage" 2>&1 | tail -5
```

Expected: 测试通过，无 `Cannot find module 'react-native-webview'` 错误

- [ ] **Step 4: Commit**

```bash
cd mobile && git add package.json pnpm-lock.yaml __mocks__/react-native-webview.js
git commit -m "chore(mobile): add react-native-webview dep and jest mock"
```

---
## Task 2: 下载 mermaid.js 本地 bundle

**Files:**
- Create: `mobile/assets/mermaid.min.js`

> 目的：离线可用，不依赖 CDN。mermaid.js 压缩后约 2-3 MB。

- [ ] **Step 1: 下载 mermaid.min.js**

```bash
cd mobile
curl -L "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" -o assets/mermaid.min.js
```

Expected: `assets/mermaid.min.js` 存在，大小 > 1MB

- [ ] **Step 2: 验证文件有效**

```bash
head -c 200 mobile/assets/mermaid.min.js
```

Expected: 输出以 `!function(` 或 `(function(` 开头的 JS 内容，不是 HTML 错误页

- [ ] **Step 3: Commit**

```bash
git add mobile/assets/mermaid.min.js
git commit -m "chore(mobile): add mermaid.js local bundle for offline rendering"
```

---
## Task 3: 实现 MermaidBlock 组件（TDD）

**Files:**
- Create: `mobile/src/features/chat/components/MermaidBlock.test.tsx`
- Create: `mobile/src/features/chat/components/MermaidBlock.tsx`

### 组件职责

`MermaidBlock` 接收 Mermaid 代码字符串，用 WebView 渲染缩略图。WebView 加载本地 HTML（内嵌 mermaid.js bundle），渲染完成后通过 `postMessage` 回传 SVG 高度，组件据此自适应高度。渲染失败时显示原始代码块。点击图形区域触发 `onFullscreen` 回调。

- [ ] **Step 1: 写失败测试**

创建 `mobile/src/features/chat/components/MermaidBlock.test.tsx`：

```tsx
/// MermaidBlock 组件：渲染 Mermaid 代码为 WebView 缩略图
///
/// 测试1：正常渲染 — 显示 WebView，不显示错误状态
///   输入：code = "flowchart TD\n  A --> B"
///   预期：testID="mermaid-webview" 存在，testID="mermaid-error" 不存在
///
/// 测试2：错误状态 — WebView onError 触发后显示原始代码
///   输入：code = "invalid mermaid @@@@"
///   执行：fireEvent(webview, 'onError', { nativeEvent: {} })
///   预期：testID="mermaid-error" 存在，testID="mermaid-webview" 不存在
///
/// 测试3：点击触发 onFullscreen 回调
///   输入：code = "flowchart TD\n  A --> B", onFullscreen = jest.fn()
///   执行：fireEvent.press(testID="mermaid-thumb-press")
///   预期：onFullscreen 被调用一次
///
/// 测试4：WebView postMessage 高度回传 — 组件接收高度后更新 WebView 容器高度
///   输入：code = "flowchart TD\n  A --> B"
///   执行：fireEvent(webview, 'onMessage', { nativeEvent: { data: '{"type":"height","value":180}' } })
///   预期：testID="mermaid-webview-container" 的 style.height === 180

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { MermaidBlock } from './MermaidBlock';

describe('MermaidBlock', () => {
  it('renders WebView for valid mermaid code', () => {
    const { getByTestId, queryByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={jest.fn()} />,
    );
    // 断言失败 = MermaidBlock 未渲染 WebView，mermaid 代码无法展示
    expect(getByTestId('mermaid-webview')).toBeTruthy();
    // 断言失败 = 正常代码不应显示错误状态
    expect(queryByTestId('mermaid-error')).toBeNull();
  });

  it('shows error fallback when WebView fires onError', () => {
    const { getByTestId, queryByTestId } = render(
      <MermaidBlock code="invalid @@@@" onFullscreen={jest.fn()} />,
    );
    const webview = getByTestId('mermaid-webview');
    fireEvent(webview, 'onError', { nativeEvent: {} });

    // 断言失败 = onError 后应显示错误回退，但 mermaid-error 不存在
    expect(getByTestId('mermaid-error')).toBeTruthy();
    // 断言失败 = 错误状态下 WebView 应被隐藏
    expect(queryByTestId('mermaid-webview')).toBeNull();
  });

  it('calls onFullscreen when thumbnail is pressed', () => {
    const onFullscreen = jest.fn();
    const { getByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={onFullscreen} />,
    );
    fireEvent.press(getByTestId('mermaid-thumb-press'));
    // 断言失败 = 点击缩略图未触发 onFullscreen 回调
    expect(onFullscreen).toHaveBeenCalledTimes(1);
  });

  it('updates container height from postMessage', () => {
    const { getByTestId } = render(
      <MermaidBlock code="flowchart TD\n  A --> B" onFullscreen={jest.fn()} />,
    );
    const webview = getByTestId('mermaid-webview');
    fireEvent(webview, 'onMessage', {
      nativeEvent: { data: JSON.stringify({ type: 'height', value: 180 }) },
    });
    const container = getByTestId('mermaid-webview-container');
    // 断言失败 = postMessage 高度回传后容器高度未更新为 180
    expect(container.props.style.height).toBe(180);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MermaidBlock" 2>&1 | tail -10
```

Expected: FAIL，`Cannot find module './MermaidBlock'`

- [ ] **Step 3: 实现 MermaidBlock**

创建 `mobile/src/features/chat/components/MermaidBlock.tsx`：

```tsx
import { Maximize2 } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  code: string;
  onFullscreen: () => void;
}

// buildHtml — generates the HTML string loaded by WebView.
// mermaid.js is inlined via require() so it works offline.
// On render success, postMessage({ type: 'height', value: <px> }).
// On render error, postMessage({ type: 'error', message: <string> }).
function buildHtml(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mermaidSrc = require('../../../assets/mermaid.min.js');
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
<div class="mermaid" id="graph">\${escaped}</div>
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

export function MermaidBlock({ code, onFullscreen }: Props) {
  const [height, setHeight] = useState(80);
  const [hasError, setHasError] = useState(false);
  const webviewRef = useRef(null);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; value?: number };
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
        <Text
          selectable
          style={{ fontFamily: 'Inter', fontSize: 12, color: '#DDDDDD' }}
        >
          {code}
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
          source={{ html: buildHtml(code) }}
          scrollEnabled={false}
          onMessage={handleMessage}
          onError={() => setHasError(true)}
          style={{ flex: 1, backgroundColor: 'transparent' }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
          }}
          pointerEvents="none"
        >
          <Maximize2 size={16} color="#FF6B35" />
        </View>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MermaidBlock" 2>&1 | tail -10
```

Expected: PASS，4 tests passed

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/components/MermaidBlock.tsx \
        mobile/src/features/chat/components/MermaidBlock.test.tsx
git commit -m "feat(mobile): add MermaidBlock component with WebView rendering"
```

---
## Task 4: 实现 MermaidFullscreen 组件（TDD）

**Files:**
- Create: `mobile/src/features/chat/components/MermaidFullscreen.test.tsx`
- Create: `mobile/src/features/chat/components/MermaidFullscreen.tsx`

### 组件职责

全屏 Modal，内含 WebView 渲染同一 Mermaid 代码。手势层使用 `react-native-gesture-handler` 的 `PinchGestureHandler` + `PanGestureHandler` 实现双指缩放和平移，`react-native-reanimated` 驱动动画。重置按钮将 scale/translate 归零。关闭按钮或 Android 返回键退出 Modal。

- [ ] **Step 1: 写失败测试**

创建 `mobile/src/features/chat/components/MermaidFullscreen.test.tsx`：

```tsx
/// MermaidFullscreen 组件：全屏 Modal 查看 Mermaid 图形
///
/// 测试1：visible=true 时渲染 Modal 和 WebView
///   输入：visible=true, code="flowchart TD\n  A --> B", onClose=jest.fn()
///   预期：testID="mermaid-fullscreen-modal" 存在，testID="mermaid-fullscreen-webview" 存在
///
/// 测试2：visible=false 时不渲染内容
///   输入：visible=false
///   预期：testID="mermaid-fullscreen-webview" 不存在
///
/// 测试3：点击关闭按钮触发 onClose
///   输入：visible=true, onClose=jest.fn()
///   执行：fireEvent.press(testID="mermaid-fullscreen-close")
///   预期：onClose 被调用一次
///
/// 测试4：点击重置按钮存在（不验证动画值，动画由 reanimated mock 处理）
///   输入：visible=true
///   预期：testID="mermaid-fullscreen-reset" 存在

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { MermaidFullscreen } from './MermaidFullscreen';

describe('MermaidFullscreen', () => {
  it('renders modal and webview when visible', () => {
    const { getByTestId } = render(
      <MermaidFullscreen
        visible={true}
        code="flowchart TD\n  A --> B"
        onClose={jest.fn()}
      />,
    );
    // 断言失败 = visible=true 时 Modal 未渲染
    expect(getByTestId('mermaid-fullscreen-modal')).toBeTruthy();
    // 断言失败 = visible=true 时 WebView 未渲染
    expect(getByTestId('mermaid-fullscreen-webview')).toBeTruthy();
  });

  it('does not render webview when not visible', () => {
    const { queryByTestId } = render(
      <MermaidFullscreen visible={false} code="flowchart TD\n  A --> B" onClose={jest.fn()} />,
    );
    // 断言失败 = visible=false 时 WebView 仍被渲染（性能浪费）
    expect(queryByTestId('mermaid-fullscreen-webview')).toBeNull();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <MermaidFullscreen visible={true} code="flowchart TD\n  A --> B" onClose={onClose} />,
    );
    fireEvent.press(getByTestId('mermaid-fullscreen-close'));
    // 断言失败 = 点击关闭按钮未触发 onClose
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders reset button', () => {
    const { getByTestId } = render(
      <MermaidFullscreen visible={true} code="flowchart TD\n  A --> B" onClose={jest.fn()} />,
    );
    // 断言失败 = 全屏模式缺少重置按钮
    expect(getByTestId('mermaid-fullscreen-reset')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MermaidFullscreen" 2>&1 | tail -10
```

Expected: FAIL，`Cannot find module './MermaidFullscreen'`

- [ ] **Step 3: 实现 MermaidFullscreen**

创建 `mobile/src/features/chat/components/MermaidFullscreen.tsx`：

```tsx
import { RotateCcw, X } from 'lucide-react-native';
import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { WebView } from 'react-native-webview';

interface Props {
  visible: boolean;
  code: string;
  onClose: () => void;
}

// buildFullscreenHtml — same as MermaidBlock but full-size, no height postMessage needed.
function buildFullscreenHtml(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mermaidSrc = require('../../../assets/mermaid.min.js');
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
<div class="mermaid" id="graph">\${escaped}</div>
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
        {/* Close button */}
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

        {/* Reset button */}
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

        {/* Gesture + WebView */}
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
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MermaidFullscreen" 2>&1 | tail -10
```

Expected: PASS，4 tests passed

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/components/MermaidFullscreen.tsx \
        mobile/src/features/chat/components/MermaidFullscreen.test.tsx
git commit -m "feat(mobile): add MermaidFullscreen modal with pinch/pan gestures"
```

---
## Task 5: 接入 MarkdownMessage — fence rule 拦截 mermaid 代码块（TDD）

**Files:**
- Modify: `mobile/src/features/chat/components/MarkdownMessage.tsx`
- Modify: `mobile/src/features/chat/components/MarkdownMessage.test.tsx`

### 修改说明

`react-native-markdown-display` 的 `fence` rule 接收 `node.content`（代码内容）和 `node.sourceInfo`（语言标识，如 `"mermaid"`）。当 `sourceInfo === 'mermaid'` 时，渲染 `MermaidBlock` + `MermaidFullscreen` 组合；否则保持原有 `renderFence` 逻辑。

- [ ] **Step 1: 写失败测试**

在 `mobile/src/features/chat/components/MarkdownMessage.test.tsx` 末尾追加新的 describe 块：

```tsx
// 在文件顶部 import 区域追加：
// import { MermaidBlock } from './MermaidBlock';

// 在文件末尾追加：
jest.mock('./MermaidBlock', () => ({
  MermaidBlock: ({ code, onFullscreen }: { code: string; onFullscreen: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="mermaid-block-mock" onPress={onFullscreen}>
        <Text>{code}</Text>
      </Pressable>
    );
  },
}));

jest.mock('./MermaidFullscreen', () => ({
  MermaidFullscreen: ({ visible }: { visible: boolean }) => {
    const { View } = require('react-native');
    return visible ? <View testID="mermaid-fullscreen-mock" /> : null;
  },
}));

describe('MarkdownMessage mermaid fence', () => {
  /// mermaid fence rule：```mermaid 代码块渲染为 MermaidBlock，不显示原始代码
  ///
  /// 数据构造：
  ///   content = "```mermaid\nflowchart TD\n  A --> B\n```"
  ///   Markdown mock 不调用 fence rule；需要直接测试 renderFence 函数
  ///   通过 makeMermaidFenceRule 导出的函数直接调用
  ///
  /// 执行过程：
  ///   1. 调用 makeMermaidFenceRule() 获取 fence render 函数
  ///   2. 传入 node.sourceInfo='mermaid', node.content='flowchart TD\n  A --> B'
  ///   3. render 返回的 element
  ///
  /// 预期结果：
  ///   - testID="mermaid-block-mock" 存在（MermaidBlock 被渲染）
  ///   - testID="mermaid-error" 不存在（未回退到错误状态）
  it('renders MermaidBlock for mermaid fence node', () => {
    const { makeMermaidFenceRule } = require('./MarkdownMessage');
    const renderFence = makeMermaidFenceRule();
    const node = {
      key: 'fence-1',
      content: 'flowchart TD\n  A --> B',
      sourceInfo: 'mermaid',
    };
    const element = renderFence(node);
    const { getByTestId, queryByTestId } = render(element as React.ReactElement);

    // 断言失败 = mermaid fence 未渲染 MermaidBlock
    expect(getByTestId('mermaid-block-mock')).toBeTruthy();
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
  ///   3. 检查 testID="mermaid-fullscreen-mock" 出现
  ///
  /// 预期结果：
  ///   - press 前：testID="mermaid-fullscreen-mock" 不存在
  ///   - press 后：testID="mermaid-fullscreen-mock" 存在
  it('shows MermaidFullscreen when MermaidBlock is pressed', () => {
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

    fireEvent.press(getByTestId('mermaid-block-mock'));

    // 断言失败 = 点击 MermaidBlock 后应显示全屏 Modal
    expect(getByTestId('mermaid-fullscreen-mock')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MarkdownMessage" 2>&1 | tail -10
```

Expected: FAIL，`makeMermaidFenceRule is not a function` 或类似错误

- [ ] **Step 3: 修改 MarkdownMessage.tsx**

在 `MarkdownMessage.tsx` 中：

1. 在文件顶部追加 import：

```tsx
import { MermaidBlock } from './MermaidBlock';
import { MermaidFullscreen } from './MermaidFullscreen';
```

2. 将现有的 `renderFence` 函数替换为 `makeMermaidFenceRule`，并导出：

```tsx
// 替换原有的 renderFence 函数：
// function renderFence(node: { key: string; content: string }) { ... }
// 改为：

export function makeMermaidFenceRule() {
  // fullscreenCode 和 setFullscreenCode 通过闭包持有状态。
  // 每次调用 makeMermaidFenceRule() 返回一个独立的 renderFence 实例，
  // 供 MarkdownMessage 在组件内部使用（通过 useMemo 保持稳定引用）。
  let setFullscreen: ((code: string | null) => void) | null = null;

  function FenceWithFullscreen({ code }: { code: string }) {
    const [fullscreenCode, setFullscreenCode] = React.useState<string | null>(null);
    // 将 setter 暴露给外层 renderFence 闭包
    setFullscreen = setFullscreenCode;
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

  return function renderFence(node: { key: string; content: string; sourceInfo?: string }) {
    if (node.sourceInfo === 'mermaid') {
      return <FenceWithFullscreen key={node.key} code={node.content} />;
    }
    // 非 mermaid：原有代码块渲染
    return (
      <View key={node.key} style={mdStyles.fence}>
        <Text selectable style={mdStyles.code_block}>
          {node.content}
        </Text>
        <CopyButton code={node.content} />
      </View>
    );
  };
}
```

3. 修改 `MarkdownMessage` 组件，使用 `makeMermaidFenceRule`：

```tsx
// 将原有的：
// const rules: RenderRules = { ...mdRules, image: makeImageRule(serverUrl, token) };
// 改为：

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  serverUrl = '',
  token = '',
}: Props) {
  const mermaidFenceRule = React.useMemo(() => makeMermaidFenceRule(), []);
  const rules: RenderRules = {
    ...mdRules,
    fence: mermaidFenceRule,
    image: makeImageRule(serverUrl, token),
  };
  return (
    <Markdown style={mdStyles} rules={rules}>
      {content}
    </Markdown>
  );
});
```

4. 同时从 `mdRules` 中移除 `fence: renderFence`（因为 `renderFence` 已被 `makeMermaidFenceRule` 替代）：

```tsx
// 将 mdRules 中的 fence: renderFence 这行删除
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
  // fence 已移至 MarkdownMessage 组件内通过 makeMermaidFenceRule() 动态生成
  table: renderTable,
};
```

- [ ] **Step 4: 运行全部 MarkdownMessage 测试**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MarkdownMessage" 2>&1 | tail -15
```

Expected: PASS，所有测试通过（含原有测试 + 新增 3 个 mermaid 测试）

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/components/MarkdownMessage.tsx \
        mobile/src/features/chat/components/MarkdownMessage.test.tsx
git commit -m "feat(mobile): wire MermaidBlock into MarkdownMessage fence rule"
```

---
## Task 6: 全量验证 + typecheck

**Files:** 无新文件

- [ ] **Step 1: 运行全部 mobile 测试**

```bash
cd mobile && pnpm test -- --watchAll=false 2>&1 | tail -20
```

Expected: 所有测试通过，无 FAIL

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -20
```

Expected: 无类型错误

- [ ] **Step 3: 如有错误，修复后重跑**

常见问题及修复方向：
- `require('../../../assets/mermaid.min.js')` 类型报错 → 在 `mobile/src/types.d.ts` 或新建 `mobile/assets/mermaid.d.ts` 添加 `declare module '*/mermaid.min.js'`
- `node.sourceInfo` 类型不存在 → 用 `(node as any).sourceInfo` 或扩展 ASTNode 类型
- `GestureDetector` / `Gesture` 类型报错 → 确认 `react-native-gesture-handler` 版本 ≥ 2.x

- [ ] **Step 4: 最终 commit**

```bash
git add -A
git commit -m "feat(mobile): mermaid diagram rendering in chat messages

- MermaidBlock: inline thumbnail via WebView + mermaid.js local bundle
- MermaidFullscreen: pinch/pan/reset gesture modal
- MarkdownMessage: fence rule intercepts mermaid code blocks
- Offline capable: mermaid.js bundled in assets/"
```

---

## Self-Review

### Spec Coverage

| SPEC 要求 | 对应 Task |
|-----------|-----------|
| 识别 \`\`\`mermaid 代码块并渲染为图形 | Task 5（fence rule 拦截） |
| 支持所有常见 Mermaid 图表类型 | Task 2（完整 mermaid.js bundle） |
| 消息气泡内显示缩略图（内容自适应高度） | Task 3（postMessage 高度回传） |
| 点击缩略图进入全屏模式 | Task 3（onFullscreen 回调）+ Task 5（状态管理） |
| 全屏支持双指缩放、平移、重置按钮 | Task 4（PinchGestureHandler + PanGestureHandler） |
| 全屏可关闭退出 | Task 4（关闭按钮 + onRequestClose） |
| 语法错误时回退显示原始代码块 | Task 3（onError → hasError state） |
| mermaid.js 本地 bundle，离线可用 | Task 2 |
| 不依赖外部 CDN | Task 2（本地 require） |

### 无遗漏项

所有 SPEC 要求均有对应 Task 覆盖。

### 类型一致性

- `MermaidBlock` props: `{ code: string; onFullscreen: () => void }` — Task 3 定义，Task 5 调用一致
- `MermaidFullscreen` props: `{ visible: boolean; code: string; onClose: () => void }` — Task 4 定义，Task 5 调用一致
- `makeMermaidFenceRule` 返回 `(node: { key: string; content: string; sourceInfo?: string }) => JSX.Element` — Task 5 定义，测试调用一致
