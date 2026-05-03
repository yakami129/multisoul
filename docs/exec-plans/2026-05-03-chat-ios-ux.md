# Chat iOS UX 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设计稿中的 5 项 Chat UI 改造落地到代码：Header 状态 Badge、AI 等待动画气泡、多图上传预览行、图片气泡+全屏预览、发送/停止一体按钮；并新增 CLI abort 接口。

**Architecture:** 前端改造集中在 `app/chat/[id].tsx`（状态管理+布局）和 `features/chat/components/MessageBubble.tsx`（气泡渲染）；CLI 新增 `POST /api/v1/conversations/:id/abort` 路由，通过 `sessions` map 向运行中的 agent worker 发送中断信号。多图状态用本地 `PendingImage[]` 数组管理，每张图片选后立即上传。

**Tech Stack:** React Native, expo-image-picker, expo-image-manipulator, Lucide icons, axum 0.7 (Rust), tokio

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|---|---|---|
| `mobile/app/chat/[id].tsx` | 修改 | 多图状态、Header Badge、abort 调用、pickImage 扩展 |
| `mobile/src/features/chat/components/MessageBubble.tsx` | 修改 | 三点等待气泡替换、图片气泡 tap 全屏预览 |
| `mobile/src/features/chat/services/chatService.ts` | 修改 | 新增 `abortConversation` |
| `mobile/src/__tests__/chatDetailRoute.test.tsx` | 修改 | 新增多图、abort、Badge 相关回归测试 |
| `cli/src/serve/routes/conversations.rs` | 修改 | 新增 `abort_conversation` handler |
| `cli/src/serve/mod.rs` | 修改 | 注册 abort 路由 |

---

## Task 1: 新增 `abortConversation` 前端服务函数

**Files:**
- Modify: `mobile/src/features/chat/services/chatService.ts`
- Modify: `mobile/src/features/chat/services/chatService.test.ts`

- [ ] **Step 1.1: 写失败测试**

在 `chatService.test.ts` 中添加：

```typescript
describe('abortConversation', () => {
  it('calls POST /api/v1/conversations/:id/abort with token', async () => {
    const mockPost = jest.fn().mockResolvedValue({ data: { ok: true } });
    jest.spyOn(require('@/api/endpointClient'), 'getEndpointClient')
      .mockReturnValue({ post: mockPost } as any);

    await abortConversation('http://localhost:8080', 'tok', 'conv-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/conversations/conv-1/abort',
      {}
    );
  });
});
```

- [ ] **Step 1.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatService
```

预期：FAIL — `abortConversation is not a function`

- [ ] **Step 1.3: 实现函数**

在 `chatService.ts` 末尾添加：

```typescript
export async function abortConversation(
  base_url: string,
  token: string,
  conv_id: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.post(`/api/v1/conversations/${conv_id}/abort`, {});
}
```

- [ ] **Step 1.4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatService
```

预期：PASS

- [ ] **Step 1.5: Commit**

```bash
cd mobile && git add src/features/chat/services/chatService.ts src/features/chat/services/chatService.test.ts
git commit -m "feat(chat): add abortConversation service function"
```

---

## Task 2: CLI — 新增 abort_conversation 路由

**Files:**
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 2.1: 在 conversations.rs 末尾添加 handler**

在 `#[cfg(test)]` 之前插入：

```rust
/// POST /api/v1/conversations/:id/abort
/// 向正在运行的 session worker 发送中断信号（通过关闭 sessions channel）。
/// 若无对应 session，返回 200（已经停止，幂等）。
pub async fn abort_conversation(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // 检查 conversation 是否存在
    let exists = {
        let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1",
            [&conv_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }

    // 从 sessions map 中移除，使 worker 的 Sender 端失去接收者，导致 worker 检测到断开
    let mut sessions = state.sessions.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sessions.remove(&conv_id);

    // 同时将 conversation status 更新为 idle
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute(
        "UPDATE conversations SET status = 'idle' WHERE id = ?1",
        [&conv_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Step 2.2: 在 `mod.rs` 注册路由**

在 `build_router` 函数中，`delete_conversation` 路由后插入：

```rust
.route(
    "/api/v1/conversations/:id/abort",
    axum::routing::post(conversations::abort_conversation),
)
```

- [ ] **Step 2.3: 在 conversations.rs 中添加测试**

在 `#[cfg(test)]` 模块中添加：

```rust
async fn make_abort_app(token: &str) -> (axum::Router, String, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code", "full-auto").unwrap();
    let state = AppState::new(conn, token.to_string(), std::path::PathBuf::from("/tmp/uploads"));
    let app = axum::Router::new()
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(list_conversations).post(create_conversation),
        )
        .route(
            "/api/v1/conversations/:id/abort",
            axum::routing::post(abort_conversation),
        )
        .layer(axum::middleware::from_fn_with_state(state.clone(), bearer_auth))
        .with_state(state);
    // 创建一个 conversation 返回其 id
    let body = serde_json::json!({ "title": "abort test" });
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let conv_id = json["id"].as_str().unwrap().to_string();
    (app, agent_id, conv_id)
}

/// POST /api/v1/conversations/:id/abort 返回 200 且 body.ok == true
///
/// 预期：
///   - status == 200
///   - body.ok == true
#[tokio::test]
async fn test_abort_conversation_returns_200() {
    let (app, _agent_id, conv_id) = make_abort_app("tok").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/conversations/{}/abort", conv_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "abort must return 200");
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["ok"], true, "body.ok must be true");
}

/// POST /api/v1/conversations/nonexistent/abort 返回 404
#[tokio::test]
async fn test_abort_nonexistent_conversation_returns_404() {
    let (app, _agent_id, _conv_id) = make_abort_app("tok").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/conversations/no-such-id/abort")
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND, "abort unknown conv must be 404");
}
```

- [ ] **Step 2.4: 运行 CLI 测试**

```bash
cd cli && cargo test abort -- --nocapture
```

预期：两个测试 PASS

- [ ] **Step 2.5: Commit**

```bash
cd cli && git add src/serve/routes/conversations.rs src/serve/mod.rs
git commit -m "feat(cli): add POST /api/v1/conversations/:id/abort endpoint"
```

---

## Task 3: 多图状态管理 + pickImage 扩展（app/chat/[id].tsx）

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 3.1: 写失败测试 — 多图选择后显示预览行**

在 `chatDetailRoute.test.tsx` 中添加（在最后一个 `describe` 之后）：

```typescript
describe('multi-image upload', () => {
  beforeEach(() => {
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (uploadImage as jest.Mock).mockResolvedValue({ file_id: 'file-abc' });
    (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({ uri: 'compressed://img.jpg' });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://img.jpg' }],
    });
  });

  it('shows image preview row after selecting an image', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => expect(queryByTestId('img-preview-row')).toBeNull());

    await act(async () => {
      fireEvent.press(getByTestId('attach-image-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).not.toBeNull();
    });
  });

  it('removes image when × badge tapped', async () => {
    const { getByTestId, queryByTestId } = render(<ChatDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('attach-image-button'));
    });
    await waitFor(() => expect(queryByTestId('img-preview-row')).not.toBeNull());

    await act(async () => {
      fireEvent.press(getByTestId('remove-img-0'));
    });
    await waitFor(() => {
      expect(queryByTestId('img-preview-row')).toBeNull();
    });
  });
});
```

- [ ] **Step 3.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

预期：FAIL — `Unable to find testID: img-preview-row`

- [ ] **Step 3.3: 在 [id].tsx 中替换单图状态为多图状态**

将顶部 imports 中添加 `ActionSheetIOS`（iOS）和 `Alert`：
```typescript
import { ..., ActionSheetIOS, Alert, Platform, ScrollView } from 'react-native';
```

替换状态定义：
```typescript
// 替换原来的
// const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
// const [isUploading, setIsUploading] = useState(false);

interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}
const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
```

- [ ] **Step 3.4: 重写 pickImage 函数（支持相册+拍照+权限请求）**

```typescript
async function pickImage() {
  if (pendingImages.length >= 5) {
    Alert.alert('最多选择 5 张图片');
    return;
  }

  const doLaunch = async (launcher: () => Promise<ImagePicker.ImagePickerResult>) => {
    const result = await launcher();
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const compressed = await ImageManipulator.manipulateAsync(asset.uri, [], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const localUri = compressed.uri;
    const idx = pendingImages.length;
    setPendingImages((prev) => [...prev, { localUri, fileId: null, status: 'uploading' }]);
    if (!endpoint) return;
    try {
      const res = await uploadImage(endpoint.base_url, endpoint.token, localUri);
      imageMapRef.current.set(res.file_id, localUri);
      setPendingImages((prev) =>
        prev.map((img, i) => (i === idx ? { ...img, fileId: res.file_id, status: 'uploaded' } : img))
      );
    } catch {
      setPendingImages((prev) =>
        prev.map((img, i) => (i === idx ? { ...img, status: 'failed' } : img))
      );
    }
  };

  const requestAndLaunch = async (
    permFn: () => Promise<ImagePicker.PermissionResponse>,
    launcher: () => Promise<ImagePicker.ImagePickerResult>
  ) => {
    const { status } = await permFn();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请在设置中开启相册/相机权限', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => { void require('react-native').Linking.openSettings(); } },
      ]);
      return;
    }
    await doLaunch(launcher);
  };

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['取消', '相册', '拍照'], cancelButtonIndex: 0 },
      async (buttonIndex) => {
        if (buttonIndex === 1) {
          await requestAndLaunch(
            ImagePicker.requestMediaLibraryPermissionsAsync,
            () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
          );
        } else if (buttonIndex === 2) {
          await requestAndLaunch(
            ImagePicker.requestCameraPermissionsAsync,
            () => ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
          );
        }
      }
    );
  } else {
    // Android: 直接相册（简化版，后续可加拍照）
    await requestAndLaunch(
      ImagePicker.requestMediaLibraryPermissionsAsync,
      () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    );
  }
}
```

- [ ] **Step 3.5: 重写 handleSend 以支持多图**

```typescript
const handleSend = async () => {
  const text = input.trim();
  const uploadedImages = pendingImages.filter((img) => img.status === 'uploaded' && img.fileId);
  if ((!text && uploadedImages.length === 0) || !endpoint) return;

  lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(messages);
  lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(messages);
  hasLoadedInitialMessagesRef.current = true;
  setInput('');
  setPendingImages([]);
  setIsAwaitingResponse(true);
  setTypewriterSeq(null);

  try {
    // 多图时，每张图片单独发一条消息（与现有 file_id 方案一致）
    // 最后一条消息携带用户文字
    if (uploadedImages.length > 0) {
      for (let i = 0; i < uploadedImages.length; i++) {
        const img = uploadedImages[i];
        const msgText = i === uploadedImages.length - 1 ? text : '';
        await postMessage(endpoint.base_url, endpoint.token, conv_id, msgText, img.fileId!);
      }
    } else {
      await postMessage(endpoint.base_url, endpoint.token, conv_id, text);
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  } catch {
    setIsAwaitingResponse(false);
  }
};
```

- [ ] **Step 3.6: 替换图片预览区 JSX**

删除原来的 `pendingImageUri` 预览区，替换为：

```tsx
{pendingImages.length > 0 && (
  <ScrollView
    testID="img-preview-row"
    horizontal
    showsHorizontalScrollIndicator={false}
    style={s.previewRow}
    contentContainerStyle={s.previewRowContent}
  >
    {pendingImages.map((img, idx) => (
      <View key={idx} style={s.thumbWrapper}>
        <Image source={{ uri: img.localUri }} style={s.thumb} />
        {img.status === 'uploading' && (
          <View style={s.thumbOverlay}>
            <Text style={s.thumbOverlayText}>...</Text>
          </View>
        )}
        {img.status === 'failed' && (
          <View style={[s.thumbOverlay, s.thumbFailed]}>
            <Text style={s.thumbOverlayText}>!</Text>
          </View>
        )}
        <Pressable
          testID={`remove-img-${idx}`}
          style={s.removeBadge}
          onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
        >
          <X size={8} color="#20C20E" />
        </Pressable>
      </View>
    ))}
  </ScrollView>
)}
```

并在 StyleSheet 中添加：

```typescript
previewRow: {
  backgroundColor: '#040D04',
  maxHeight: 68,
},
previewRowContent: {
  paddingHorizontal: 16,
  paddingVertical: 8,
  gap: 8,
  flexDirection: 'row',
  alignItems: 'center',
},
thumbWrapper: {
  width: 52,
  height: 52,
  borderRadius: 8,
  overflow: 'hidden',
  backgroundColor: '#0A3A0A',
},
thumb: {
  width: 52,
  height: 52,
},
thumbOverlay: {
  position: 'absolute',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: '#040D04AA',
  alignItems: 'center',
  justifyContent: 'center',
},
thumbFailed: { backgroundColor: '#1A0000AA' },
thumbOverlayText: { color: '#FF6060', fontFamily: 'Geist Mono', fontSize: 14 },
removeBadge: {
  position: 'absolute',
  top: -2,
  right: -2,
  width: 18,
  height: 18,
  borderRadius: 9,
  backgroundColor: '#0A1A0A',
  borderWidth: 1,
  borderColor: '#2D8B2D',
  alignItems: 'center',
  justifyContent: 'center',
},
```

- [ ] **Step 3.7: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

预期：新增的两个测试 PASS

- [ ] **Step 3.8: Commit**

```bash
cd mobile && git add app/chat/\[id\].tsx src/__tests__/chatDetailRoute.test.tsx
git commit -m "feat(chat): multi-image upload with horizontal preview row"
```

---

## Task 4: Header 状态 Badge（app/chat/[id].tsx）

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 4.1: 写失败测试**

```typescript
describe('Header status badge', () => {
  it('shows RUNNING badge when conversation.status is running', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'conv-1', agent_id: 'agent-1', title: 'T',
        created_at: 1, last_message_at: 1, endpoint_id: 'endpoint-1',
        agent_name: 'Agent', status: 'running',
      }],
      messages: {},
    });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('status-badge-text').props.children).toBe('RUNNING');
    });
  });

  it('shows AWAITING badge when conversation.status is awaiting_question', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'conv-1', agent_id: 'agent-1', title: 'T',
        created_at: 1, last_message_at: 1, endpoint_id: 'endpoint-1',
        agent_name: 'Agent', status: 'awaiting_question',
      }],
      messages: {},
    });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = render(<ChatDetailScreen />);
    await waitFor(() => {
      expect(getByTestId('status-badge-text').props.children).toBe('AWAITING');
    });
  });
});
```

- [ ] **Step 4.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

预期：FAIL — `Unable to find testID: status-badge-text`

- [ ] **Step 4.3: 实现 Header Badge**

在 `[id].tsx` 中，定义 badge 配置：

```typescript
const STATUS_BADGE: Record<string, { label: string; bg: string; dot: string }> = {
  running:           { label: 'RUNNING',   bg: '#0A3A0A', dot: '#33FF33' },
  awaiting_question: { label: 'AWAITING',  bg: '#1A1200', dot: '#FFB000' },
  completed:         { label: 'COMPLETED', bg: '#081808', dot: '#20C20E' },
  failed:            { label: 'FAILED',    bg: '#1A0000', dot: '#FF4040' },
  idle:              { label: 'IDLE',      bg: '#0A1A0A', dot: '#2D8B2D' },
};
```

替换 Header 中的圆点为 Badge：

```tsx
{/* 替换原来的 <View style={[s.dot, { backgroundColor: ... }]} /> */}
{(() => {
  const wsOffline = isOffline;
  const badge = wsOffline
    ? { label: 'OFFLINE', bg: '#1A0A00', dot: '#FFB000' }
    : (STATUS_BADGE[conversation?.status ?? 'idle'] ?? STATUS_BADGE.idle);
  return (
    <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
      <View style={[s.statusDot, { backgroundColor: badge.dot }]} />
      <Text testID="status-badge-text" style={s.statusBadgeText}>{badge.label}</Text>
    </View>
  );
})()}
```

在 StyleSheet 中添加：

```typescript
statusBadge: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 5,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 2,
  borderWidth: 1,
  borderColor: '#20C20E40',
},
statusDot: { width: 6, height: 6, borderRadius: 3 },
statusBadgeText: {
  fontFamily: 'Inter',
  fontSize: 9,
  fontWeight: '700',
  letterSpacing: 1.5,
  color: '#33FF33',
},
```

- [ ] **Step 4.4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

预期：所有测试 PASS

- [ ] **Step 4.5: Commit**

```bash
cd mobile && git add app/chat/\[id\].tsx src/__tests__/chatDetailRoute.test.tsx
git commit -m "feat(chat): header status badge based on conversation.status"
```

---

## Task 5: 发送/停止一体按钮（app/chat/[id].tsx）

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 5.1: 写失败测试**

```typescript
describe('send/stop button', () => {
  it('shows stop button when isAwaitingResponse and calls abort', async () => {
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (require('@/features/chat/services/chatService').abortConversation as jest.Mock)
      = jest.fn().mockResolvedValue(undefined);

    const { getByTestId } = render(<ChatDetailScreen />);

    // 触发 send 进入 awaiting 状态
    (postMessage as jest.Mock).mockImplementation(() => new Promise(() => {})); // never resolves
    await act(async () => {
      fireEvent.changeText(getByTestId('message-input'), 'hello');
      fireEvent.press(getByTestId('send-stop-button'));
    });

    await waitFor(() => {
      expect(getByTestId('stop-icon')).toBeTruthy();
    });

    // 点击停止
    await act(async () => {
      fireEvent.press(getByTestId('send-stop-button'));
    });

    expect(
      require('@/features/chat/services/chatService').abortConversation
    ).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'conv-1');
  });
});
```

- [ ] **Step 5.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

- [ ] **Step 5.3: 替换发送按钮为发送/停止一体按钮**

在 `[id].tsx` 导入 `Square` 图标：
```typescript
import { ChevronLeft, ImageIcon, Send, Square } from 'lucide-react-native';
```

导入 `abortConversation`：
```typescript
import { postMessage, fetchMessages, uploadImage, abortConversation } from '@/features/chat/services/chatService';
```

替换原有 send 按钮：

```tsx
<TouchableOpacity
  accessibilityLabel={isAwaitingResponse ? 'Stop conversation' : 'Send message'}
  accessibilityRole="button"
  testID="send-stop-button"
  onPress={() => {
    if (isAwaitingResponse) {
      if (endpoint) {
        void abortConversation(endpoint.base_url, endpoint.token, conv_id).then(() => {
          setIsAwaitingResponse(false);
        }).catch((e) => {
          console.warn('abort failed', e);
        });
      }
    } else {
      void handleSend();
    }
  }}
  style={[
    s.sendStopBtn,
    isAwaitingResponse ? s.stopBtn : s.sendBtn,
  ]}
>
  {isAwaitingResponse ? (
    <Square testID="stop-icon" size={14} color="#FF6060" />
  ) : (
    <Send size={16} color="#040D04" />
  )}
</TouchableOpacity>
```

在 StyleSheet 中替换：

```typescript
sendStopBtn: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center',
  justifyContent: 'center',
},
sendBtn: { backgroundColor: '#20C20E' },
stopBtn: {
  backgroundColor: '#1A0000',
  borderWidth: 1,
  borderColor: '#C24040',
},
```

- [ ] **Step 5.4: 给 TextInput 添加 testID**

```tsx
<TextInput
  style={s.input}
  testID="message-input"
  ...
/>
```

- [ ] **Step 5.5: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=chatDetailRoute
```

- [ ] **Step 5.6: Commit**

```bash
cd mobile && git add app/chat/\[id\].tsx src/__tests__/chatDetailRoute.test.tsx
git commit -m "feat(chat): unified send/stop button with abort API call"
```

---

## Task 6: AI 等待动画气泡（MessageBubble.tsx）

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`
- Modify: `mobile/src/features/chat/components/MessageBubble.test.tsx`

- [ ] **Step 6.1: 写失败测试**

在 `MessageBubble.test.tsx` 的 `waiting` describe 中更新/添加：

```typescript
it('renders three pulsing dots when waiting=true', () => {
  const msg: WsMessage = {
    type: 'message', seq: -1, role: 'agent_text',
    payload: { text: '' }, created_at: 0,
  };
  const { getByTestId } = render(<MessageBubble msg={msg} waiting />);
  expect(getByTestId('waiting-dot-0')).toBeTruthy();
  expect(getByTestId('waiting-dot-1')).toBeTruthy();
  expect(getByTestId('waiting-dot-2')).toBeTruthy();
  expect(getByTestId('waiting-analyzing-text')).toBeTruthy();
});
```

- [ ] **Step 6.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=MessageBubble
```

- [ ] **Step 6.3: 替换 waiting 渲染块**

在 `MessageBubble.tsx` 中，将 `if (waiting)` 返回的 JSX 替换为：

```tsx
if (waiting) {
  return (
    <View style={s.aiWrap}>
      <View style={[s.aiBubble, s.waitingBubble]}>
        <Animated.View testID="waiting-dot-0" style={[s.dot, { opacity: dot1 }]} />
        <Animated.View testID="waiting-dot-1" style={[s.dot, { opacity: dot2 }]} />
        <Animated.View testID="waiting-dot-2" style={[s.dot, { opacity: dot3 }]} />
      </View>
      <Text testID="waiting-analyzing-text" style={s.analyzingText}>Analyzing…</Text>
    </View>
  );
}
```

在 StyleSheet 中添加：

```typescript
waitingBubble: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 14,
  paddingVertical: 14,
  gap: 6,
  width: 64,
  borderRadius: 16, // [0, 16, 16, 16] 需要用 borderTopLeftRadius 等
  borderTopLeftRadius: 0,
  borderTopRightRadius: 16,
  borderBottomLeftRadius: 16,
  borderBottomRightRadius: 16,
},
analyzingText: {
  fontFamily: 'Inter',
  fontSize: 10,
  color: '#0F6B0F',
  letterSpacing: 0.5,
  marginTop: 4,
},
```

- [ ] **Step 6.4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=MessageBubble
```

- [ ] **Step 6.5: Commit**

```bash
cd mobile && git add src/features/chat/components/MessageBubble.tsx src/features/chat/components/MessageBubble.test.tsx
git commit -m "feat(chat): replace WAIT button with animated three-dot bubble"
```

---

## Task 7: 图片气泡全屏预览（MessageBubble.tsx）

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`
- Modify: `mobile/src/features/chat/components/MessageBubble.test.tsx`

- [ ] **Step 7.1: 写失败测试**

```typescript
it('opens fullscreen preview when image bubble tapped', async () => {
  const msg: WsMessage = {
    type: 'message', seq: 1, role: 'user_text',
    payload: { text: '', file_id: 'abc.jpg' }, created_at: 1,
  };
  const { getByTestId, queryByTestId } = render(
    <MessageBubble msg={msg} imageUri="file://img.jpg" />
  );

  expect(queryByTestId('fullscreen-modal')).toBeNull();

  await act(async () => {
    fireEvent.press(getByTestId('user-image-thumb'));
  });

  expect(getByTestId('fullscreen-modal')).toBeTruthy();

  // 关闭
  await act(async () => {
    fireEvent.press(getByTestId('fullscreen-close-btn'));
  });

  expect(queryByTestId('fullscreen-modal')).toBeNull();
});
```

- [ ] **Step 7.2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=MessageBubble
```

- [ ] **Step 7.3: 更新 user_text 气泡和全屏预览 Modal**

在 `user_text` case 中更新图片气泡：

```tsx
case 'user_text': {
  const payload = msg.payload as UserTextPayload;
  const hasImage = !!payload.file_id;

  return (
    <View style={s.userWrap}>
      {hasImage && imageUri && (
        <Modal
          testID="fullscreen-modal"
          visible={previewVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewVisible(false)}
        >
          <View style={s.modalOverlay}>
            <Pressable
              testID="fullscreen-close-btn"
              style={s.fullscreenClose}
              onPress={() => setPreviewVisible(false)}
            >
              <X size={18} color="#20C20E" />
            </Pressable>
            <Image source={{ uri: imageUri }} style={s.previewImage} resizeMode="contain" />
            <Text style={s.previewFilename}>{payload.file_id}</Text>
          </View>
        </Modal>
      )}
      <Pressable
        testID={hasImage ? 'user-image-thumb' : undefined}
        onPress={hasImage && imageUri ? () => setPreviewVisible(true) : undefined}
        style={s.userBubble}
      >
        {hasImage ? (
          imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={s.thumbImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={s.attachmentPlaceholder}>📎 Image</Text>
          )
        ) : null}
        {payload.text ? (
          <Text style={[s.userText, hasImage ? s.imageCaption : null]}>{payload.text}</Text>
        ) : null}
        {hasImage && imageUri && (
          <Text style={s.enlargeHint}>Tap to enlarge →</Text>
        )}
      </Pressable>
    </View>
  );
}
```

在 StyleSheet 中添加：

```typescript
enlargeHint: {
  fontFamily: 'Inter',
  fontSize: 10,
  color: '#040D04CC',
  marginTop: 4,
},
fullscreenClose: {
  position: 'absolute',
  top: 56,
  right: 20,
  width: 40,
  height: 40,
  borderRadius: 2,
  backgroundColor: '#0A3A0A',
  borderWidth: 1,
  borderColor: '#0F2B0F',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
},
previewFilename: {
  fontFamily: 'Inter',
  fontSize: 11,
  color: '#2D8B2D',
  marginTop: 12,
},
```

- [ ] **Step 7.4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=MessageBubble
```

- [ ] **Step 7.5: 完整测试套件确认无回归**

```bash
cd mobile && pnpm test -- --watchAll=false
```

- [ ] **Step 7.6: TypeScript 检查**

```bash
cd mobile && pnpm typecheck
```

预期：0 错误

- [ ] **Step 7.7: Commit**

```bash
cd mobile && git add src/features/chat/components/MessageBubble.tsx src/features/chat/components/MessageBubble.test.tsx
git commit -m "feat(chat): image bubble with tap-to-fullscreen preview"
```

---

## Task 8: 最终验收

- [ ] **Step 8.1: 运行所有移动端测试**

```bash
cd mobile && pnpm test -- --watchAll=false
```

预期：全部通过，无回归

- [ ] **Step 8.2: TypeScript 检查**

```bash
cd mobile && pnpm typecheck
```

预期：0 TS 错误

- [ ] **Step 8.3: 运行 CLI 测试**

```bash
cd cli && cargo test
```

预期：全部通过

- [ ] **Step 8.4: 对照设计稿验收 checklist**

参考 `docs/product-specs/SPEC-chat-ios-ux.md` 第 7 节，逐条检查：

- [ ] Header Badge 随 `conversation.status` 切换（5 种状态）
- [ ] WebSocket `reconnecting` 时 Banner 显示（如有 reconnecting Banner 实现）
- [ ] 发送后出现三点等待气泡 + "Analyzing…"
- [ ] 点击 📷 弹出选项（相册/拍照）
- [ ] 选图后横向预览行出现，每张有 × 角标
- [ ] 超 5 张提示
- [ ] AI 运行中时按钮变红色 ■
- [ ] 点击 ■ 调用 abort 接口
- [ ] 用户气泡有缩略图 + "Tap to enlarge →"
- [ ] 点击气泡全屏预览，× 可关闭

- [ ] **Step 8.5: 最终 Commit**

```bash
git add -A
git commit -m "feat(chat): complete iOS UX improvements — badge, multi-image, stop button, fullscreen preview"
```
