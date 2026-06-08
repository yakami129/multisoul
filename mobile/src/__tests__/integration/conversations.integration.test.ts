/**
 * Integration tests for the conversations/chat feature API service layer.
 * Tests the actual service functions with mocked HTTP responses.
 */
import {
  fetchConversations,
  createConversation,
  fetchMessages,
  postMessage,
  deleteConversation,
} from '@/features/chat/services/chatService';
import { mockConversation, mockMessage, MOCK_AGENT_ID, MOCK_CONV_ID } from './msw/handlers';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
    patch: mockPatch,
  })),
  clearEndpointClients: jest.fn(),
}));

const BASE_URL = 'http://localhost:9002';
const TOKEN = 'ms_v2_testtoken0000000000000000000000';

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  mockPatch.mockReset();
});

describe('conversations integration', () => {
  it('fetchConversations returns list with endpoint metadata injected', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockConversation] });
    const convs = await fetchConversations(BASE_URL, TOKEN, MOCK_AGENT_ID, 'ep-1', 'test-agent');
    expect(convs.length).toBe(1);
    expect(convs[0].id).toBe(MOCK_CONV_ID);
    expect(convs[0].agent_id).toBe(MOCK_AGENT_ID);
    expect(convs[0].endpoint_id).toBe('ep-1');
    expect(convs[0].agent_name).toBe('test-agent');
    expect(mockGet).toHaveBeenCalledWith(`/api/v1/agents/${MOCK_AGENT_ID}/conversations`);
  });

  it('fetchConversations returns empty array when no conversations exist', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const convs = await fetchConversations(BASE_URL, TOKEN, MOCK_AGENT_ID, 'ep-1', 'test-agent');
    expect(convs).toEqual([]);
  });

  it('createConversation returns the new conversation and sends correct request', async () => {
    mockPost.mockResolvedValueOnce({ data: mockConversation });
    const conv = await createConversation(BASE_URL, TOKEN, MOCK_AGENT_ID, 'New Conversation');
    expect(conv.id).toBe(MOCK_CONV_ID);
    expect(conv.agent_id).toBe(MOCK_AGENT_ID);
    expect(conv.status).toBe('idle');
    expect(mockPost).toHaveBeenCalledWith(`/api/v1/agents/${MOCK_AGENT_ID}/conversations`, {
      title: 'New Conversation',
    });
  });

  it('createConversation propagates error on failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Request failed with status code 422'));
    await expect(
      createConversation(BASE_URL, TOKEN, 'nonexistent-agent', 'fail'),
    ).rejects.toThrow();
  });

  it('fetchMessages returns message list for a conversation', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockMessage] });
    const msgs = await fetchMessages(BASE_URL, TOKEN, MOCK_CONV_ID);
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('user_text');
    expect(msgs[0].seq).toBe(1);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/v1/conversations/${MOCK_CONV_ID}/messages`,
      expect.anything(),
    );
  });

  it('fetchMessages accepts since_seq option and passes it as query param', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockMessage] });
    await fetchMessages(BASE_URL, TOKEN, MOCK_CONV_ID, { since_seq: 5 });
    expect(mockGet).toHaveBeenCalledWith(
      `/api/v1/conversations/${MOCK_CONV_ID}/messages`,
      expect.objectContaining({ params: expect.objectContaining({ since_seq: 5 }) }),
    );
  });

  it('postMessage sends text and does not return a value', async () => {
    mockPost.mockResolvedValueOnce({ data: mockMessage });
    await expect(
      postMessage(BASE_URL, TOKEN, MOCK_CONV_ID, 'hello integration'),
    ).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith(`/api/v1/conversations/${MOCK_CONV_ID}/messages`, {
      text: 'hello integration',
    });
  });

  it('postMessage propagates error on 401', async () => {
    mockPost.mockRejectedValueOnce(new Error('Request failed with status code 401'));
    await expect(postMessage(BASE_URL, 'bad-token', MOCK_CONV_ID, 'hello')).rejects.toThrow();
  });

  it('deleteConversation calls the correct endpoint', async () => {
    mockDelete.mockResolvedValueOnce({ data: {} });
    await deleteConversation(BASE_URL, TOKEN, MOCK_CONV_ID);
    expect(mockDelete).toHaveBeenCalledWith(`/api/v1/conversations/${MOCK_CONV_ID}`);
  });
});
