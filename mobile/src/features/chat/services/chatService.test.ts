import type { WsMessage } from '@/types';
import {
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
