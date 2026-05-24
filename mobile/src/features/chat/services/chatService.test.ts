import type { WsMessage } from '@/types';
import {
  fetchMessages,
  postMessage,
  abortConversation,
  deleteConversation,
  buildUploadedImageUrl,
  resolveUserMessageImageUri,
} from './chatService';

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(),
}));

describe('chatService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchMessages', () => {
    /// Message pagination: limit-only fetch requests a bounded newest page.
    ///
    /// Data construction:
    ///   base_url = http://localhost:8080
    ///   token    = tok
    ///   conv_id  = conv-1
    ///   options  = { limit: 15 }
    ///
    /// Execution process:
    ///   1. Mock endpoint client with a get spy returning an empty message list.
    ///   2. Call fetchMessages(base_url, token, conv_id, options).
    ///   3. Inspect the GET path and params passed to endpointClient.
    ///
    /// Expected result:
    ///   - Positive: params includes limit=15 so the server returns a bounded page.
    ///   - Negative: params does not include since_seq because this is not an incremental sync.
    it('sends limit without since_seq when fetch options request a bounded page', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ get: mockGet });

      await fetchMessages('http://localhost:8080', 'tok', 'conv-1', { limit: 15 });

      expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
        params: { limit: 15 },
      });
      expect(mockGet.mock.calls[0][1].params).not.toHaveProperty('since_seq');
    });

    /// Older history pagination: before_seq and limit request messages before a known sequence.
    ///
    /// Data construction:
    ///   base_url   = http://localhost:8080
    ///   token      = tok
    ///   conv_id    = conv-1
    ///   before_seq = 101 (first visible message seq; page should load earlier rows)
    ///   limit      = 50  (bounded page size)
    ///
    /// Execution process:
    ///   1. Mock endpoint client with a get spy returning an empty message list.
    ///   2. Call fetchMessages(base_url, token, conv_id, { before_seq: 101, limit: 50 }).
    ///   3. Inspect params passed to endpointClient.
    ///
    /// Expected result:
    ///   - Positive: params includes before_seq=101 and limit=50 for older-history paging.
    ///   - Negative: params does not include around_ask_id because no focus anchor is requested.
    it('sends before_seq and limit without around_ask_id for older-history pages', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ get: mockGet });

      await fetchMessages('http://localhost:8080', 'tok', 'conv-1', { before_seq: 101, limit: 50 });

      expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
        params: { before_seq: 101, limit: 50 },
      });
      expect(mockGet.mock.calls[0][1].params).not.toHaveProperty('around_ask_id');
    });

    /// Ask-focus pagination: around_ask_id and limit request a window around one decision.
    ///
    /// Data construction:
    ///   base_url      = http://localhost:8080
    ///   token         = tok
    ///   conv_id       = conv-1
    ///   around_ask_id = ask-focus (decision anchor to center)
    ///   limit         = 100       (window size requested by the focused view)
    ///
    /// Execution process:
    ///   1. Mock endpoint client with a get spy returning an empty message list.
    ///   2. Call fetchMessages(base_url, token, conv_id, { around_ask_id: 'ask-focus', limit: 100 }).
    ///   3. Inspect params passed to endpointClient.
    ///
    /// Expected result:
    ///   - Positive: params includes around_ask_id='ask-focus' and limit=100.
    ///   - Negative: params does not include before_seq because this is not older-history paging.
    it('sends around_ask_id and limit without before_seq for ask-focused pages', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ get: mockGet });

      await fetchMessages('http://localhost:8080', 'tok', 'conv-1', {
        around_ask_id: 'ask-focus',
        limit: 100,
      });

      expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
        params: { around_ask_id: 'ask-focus', limit: 100 },
      });
      expect(mockGet.mock.calls[0][1].params).not.toHaveProperty('before_seq');
    });

    /// Legacy incremental sync: numeric fourth argument remains since_seq.
    ///
    /// Data construction:
    ///   base_url = http://localhost:8080
    ///   token    = tok
    ///   conv_id  = conv-1
    ///   options  = 42 (legacy since_seq value used by useWebSocket)
    ///
    /// Execution process:
    ///   1. Mock endpoint client with a get spy returning an empty message list.
    ///   2. Call fetchMessages(base_url, token, conv_id, 42).
    ///   3. Inspect params passed to endpointClient.
    ///
    /// Expected result:
    ///   - Positive: params includes since_seq=42, preserving the old mobile WebSocket caller.
    ///   - Negative: params does not include limit because the numeric form is not pagination options.
    it('preserves numeric since_seq as the fourth argument for legacy callers', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ get: mockGet });

      await fetchMessages('http://localhost:8080', 'tok', 'conv-1', 42);

      expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
        params: { since_seq: 42 },
      });
      expect(mockGet.mock.calls[0][1].params).not.toHaveProperty('limit');
    });
  });

  describe('postMessage', () => {
    it('sends text-only payload when no file_id provided', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ post: mockPost });

      await postMessage('http://localhost', 'tok', 'conv1', 'hello');

      expect(mockPost).toHaveBeenCalledWith('/api/v1/conversations/conv1/messages', {
        text: 'hello',
      });
    });

    it('includes file_id when provided', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ post: mockPost });

      await postMessage('http://localhost', 'tok', 'conv1', 'check this', 'abc.jpg');

      expect(mockPost).toHaveBeenCalledWith('/api/v1/conversations/conv1/messages', {
        text: 'check this',
        file_id: 'abc.jpg',
      });
    });
  });

  describe('abortConversation', () => {
    it('calls POST /api/v1/conversations/:id/abort with token', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: { ok: true } });
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ post: mockPost });

      await abortConversation('http://localhost:8080', 'tok', 'conv-1');

      expect(mockPost).toHaveBeenCalledWith('/api/v1/conversations/conv-1/abort', {});
    });
  });

  describe('deleteConversation', () => {
    /// Conversation deletion: mobile client calls the canonical DELETE endpoint.
    ///
    /// Data construction:
    ///   base_url = http://localhost:8080
    ///   token    = tok
    ///   conv_id  = conv-1
    ///
    /// Execution process:
    ///   1. Mock endpoint client with a delete spy.
    ///   2. Call deleteConversation(base_url, token, conv_id).
    ///   3. Inspect the HTTP method and path.
    ///
    /// Expected result:
    ///   - Positive: DELETE /api/v1/conversations/conv-1 is called.
    ///   - Negative: no POST fallback is used for deletion.
    it('calls DELETE /api/v1/conversations/:id with token', async () => {
      const mockDelete = jest.fn().mockResolvedValue({ data: undefined });
      const mockPost = jest.fn();
      const { getEndpointClient } = require('@/api/endpointClient');
      getEndpointClient.mockReturnValue({ delete: mockDelete, post: mockPost });

      await deleteConversation('http://localhost:8080', 'tok', 'conv-1');

      expect(mockDelete).toHaveBeenCalledWith('/api/v1/conversations/conv-1');
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('buildUploadedImageUrl', () => {
    /// 历史图片消息：只有 file_id 时构造服务端图片 URL
    ///
    /// 数据构造：
    ///   base_url = 'http://localhost:8080/'（包含尾随 slash）
    ///   token    = 'tok with space'（需要 query encode）
    ///   file_id  = 'abc 1.jpg'（需要 path segment encode）
    ///
    /// 执行过程：
    ///   1. 调用 buildUploadedImageUrl(base_url, token, file_id)
    ///   2. 去掉 base_url 尾随 slash
    ///   3. 将 file_id 放入 /api/v1/uploads/:file_id
    ///   4. 将 token 放入 query，供 React Native Image 无 header 场景鉴权
    ///
    /// 预期结果：
    ///   - 正断言：URL 指向 /api/v1/uploads/abc%201.jpg 并带 token=tok%20with%20space
    ///   - 负断言：URL 不包含双斜杠路径，避免 http://host//api 失效
    it('builds an authenticated URL for a persisted upload file_id', () => {
      const url = buildUploadedImageUrl('http://localhost:8080/', 'tok with space', 'abc 1.jpg');

      expect(url).toBe('http://localhost:8080/api/v1/uploads/abc%201.jpg?token=tok%20with%20space');
      expect(url.includes('8080//api')).toBe(
        false,
        'uploaded image URL should trim a trailing base_url slash',
      );
    });
  });

  describe('resolveUserMessageImageUri', () => {
    /// 已发送图片消息：内存中仍有本地 URI 时优先使用本地文件。
    ///
    /// 数据构造：
    ///   WsMessage role='user_text'
    ///   payload.file_id = 'abc.jpg'
    ///   localImageUris['abc.jpg'] = 'file:///compressed.jpg'
    ///
    /// 执行过程：
    ///   1. 调用 resolveUserMessageImageUri
    ///   2. 读取 payload.file_id
    ///   3. localImageUris 命中 abc.jpg，直接返回本地 URI
    ///
    /// 预期结果：
    ///   - 正断言：返回 file:///compressed.jpg，发送后立即渲染仍走本地缓存
    ///   - 负断言：不返回 /api/v1/uploads URL，避免刚发送时多一次网络读取
    it('prefers the local URI when the just-sent image is still cached', () => {
      const msg: WsMessage = {
        type: 'message',
        seq: 1,
        role: 'user_text',
        payload: { text: '', file_id: 'abc.jpg' },
        created_at: 1,
      };
      const uri = resolveUserMessageImageUri(
        msg,
        'http://localhost:8080',
        'tok',
        new Map([['abc.jpg', 'file:///compressed.jpg']]),
      );

      expect(uri).toBe('file:///compressed.jpg');
      expect(uri?.includes('/api/v1/uploads')).toBe(
        false,
        'local cached image should not be replaced by a remote upload URL',
      );
    });

    /// 历史图片消息：退出重进后内存 Map 为空，必须用 file_id 构造服务端 URL。
    ///
    /// 数据构造：
    ///   WsMessage role='user_text'
    ///   payload.file_id = 'abc.jpg'
    ///   localImageUris = empty Map（模拟退出对话再进入）
    ///   base_url = 'http://localhost:8080'
    ///   token = 'tok'
    ///
    /// 执行过程：
    ///   1. 调用 resolveUserMessageImageUri
    ///   2. localImageUris 未命中 abc.jpg
    ///   3. fallback 到 buildUploadedImageUrl(base_url, token, file_id)
    ///
    /// 预期结果：
    ///   - 正断言：返回 /api/v1/uploads/abc.jpg?token=tok，历史图片可重新加载
    ///   - 负断言：不返回 undefined，避免 MessageBubble 降级成附件占位符
    it('falls back to the uploaded image URL when history only has file_id', () => {
      const msg: WsMessage = {
        type: 'message',
        seq: 1,
        role: 'user_text',
        payload: { text: '', file_id: 'abc.jpg' },
        created_at: 1,
      };
      const uri = resolveUserMessageImageUri(msg, 'http://localhost:8080', 'tok', new Map());

      expect(uri).toBe('http://localhost:8080/api/v1/uploads/abc.jpg?token=tok');
      expect(uri).not.toBeUndefined();
    });
  });
});
