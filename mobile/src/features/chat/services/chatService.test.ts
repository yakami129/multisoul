import { postMessage, abortConversation } from './chatService';

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
});

describe('abortConversation', () => {
  it('calls POST /api/v1/conversations/:id/abort with token', async () => {
    const mockPost = jest.fn().mockResolvedValue({ data: { ok: true } });
    jest
      .spyOn(require('@/api/endpointClient'), 'getEndpointClient')
      .mockReturnValue({ post: mockPost } as any);

    await abortConversation('http://localhost:8080', 'tok', 'conv-1');

    expect(mockPost).toHaveBeenCalledWith('/api/v1/conversations/conv-1/abort', {});
  });
});
