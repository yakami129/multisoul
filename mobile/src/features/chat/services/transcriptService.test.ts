import { fetchTranscriptTurns, fetchTurnHiddenMessages } from './transcriptService';

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(),
}));

describe('transcriptService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetchTranscriptTurns calls transcript-turns with a limit', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      data: {
        conversation_id: 'conv-1',
        status: 'completed',
        items: [],
        page_info: { oldest_turn_id: null, has_older: false },
      },
    });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchTranscriptTurns('http://localhost:8080', 'tok', 'conv-1', { limit: 20 });

    expect(getEndpointClient).toHaveBeenCalledWith('http://localhost:8080', 'tok');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/transcript-turns', {
      params: { limit: 20 },
    });
    expect(mockGet.mock.calls[0][0]).not.toContain('/messages');
  });

  it('fetchTranscriptTurns sends before_turn for older turn pages', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      data: {
        conversation_id: 'conv-1',
        status: 'completed',
        items: [],
        page_info: { oldest_turn_id: null, has_older: false },
      },
    });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchTranscriptTurns('http://localhost:8080', 'tok', 'conv-1', {
      limit: 10,
      beforeTurn: 'turn-20',
    });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/transcript-turns', {
      params: { limit: 10, before_turn: 'turn-20' },
    });
    expect(mockGet.mock.calls[0][0]).not.toContain('/messages');
  });

  it('fetchTranscriptTurns sends around_ask_id for focused ask pages', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      data: {
        conversation_id: 'conv-1',
        status: 'completed',
        items: [],
        page_info: { oldest_turn_id: null, has_older: false },
      },
    });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchTranscriptTurns('http://localhost:8080', 'tok', 'conv-1', {
      limit: 30,
      aroundAskId: 'ask-focus',
    });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/transcript-turns', {
      params: { limit: 30, around_ask_id: 'ask-focus' },
    });
    expect(mockGet.mock.calls[0][0]).not.toContain('/messages');
  });

  it('fetchTurnHiddenMessages calls the turn hidden-message endpoint', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      data: { conversation_id: 'conv-1', turn_id: 'turn-20', messages: [] },
    });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchTurnHiddenMessages('http://localhost:8080', 'tok', 'conv-1', 'turn-20');

    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/conversations/conv-1/turns/turn-20/hidden-messages',
    );
    expect(mockGet.mock.calls[0][0]).not.toContain('/messages');
  });
});
