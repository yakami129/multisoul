import { type Agent } from '@/types';
import { fetchAgentsFromEndpoint, fetchAgent, invokeAgent } from './agentService';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet, post: mockPost })),
}));

const BASE_URL = 'http://localhost:9000';
const TOKEN = 'test-token';
const ENDPOINT_ID = 'ep-1';
const ENDPOINT_LABEL = 'Local';

const mockAgentRaw = {
  id: 'a1',
  name: 'Test Agent',
  project_path: '/home/user/project',
  runtime: 'claude-code' as const,
  created_at: 0,
};

const mockAgent: Agent = {
  ...mockAgentRaw,
  endpoint_id: ENDPOINT_ID,
  endpoint_label: ENDPOINT_LABEL,
};

describe('agentService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('fetchAgents returns array of agents', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockAgentRaw] });
    const result = await fetchAgentsFromEndpoint(BASE_URL, TOKEN, ENDPOINT_ID, ENDPOINT_LABEL);
    expect(result).toEqual([mockAgent]);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/agents');
  });

  it('fetchAgent returns single agent by id', async () => {
    mockGet.mockResolvedValueOnce({ data: mockAgentRaw });
    const result = await fetchAgent(BASE_URL, TOKEN, 'a1', ENDPOINT_ID, ENDPOINT_LABEL);
    expect(result).toEqual(mockAgent);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/agents/a1');
  });

  it('invokeAgent returns conversation_id', async () => {
    mockPost.mockResolvedValueOnce({ data: { conversation_id: 'conv-123' } });
    const result = await invokeAgent(BASE_URL, TOKEN, 'a1', 'hello');
    expect(result).toBe('conv-123');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agents/a1/invoke', { message: 'hello' });
  });

  it('invokeAgent passes message in request body', async () => {
    mockPost.mockResolvedValueOnce({ data: { conversation_id: 'conv-456' } });
    const result = await invokeAgent(BASE_URL, TOKEN, 'a1', 'scan project');
    expect(result).toBe('conv-456');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agents/a1/invoke', { message: 'scan project' });
  });
});
