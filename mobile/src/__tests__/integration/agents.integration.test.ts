/**
 * Integration tests for the agents feature API service layer.
 * Tests the actual service functions with mocked HTTP responses.
 */
import {
  fetchAgentsFromEndpoint,
  fetchAgent,
  fetchAllAgents,
} from '@/features/agents/services/agentService';
import { mockAgent, MOCK_AGENT_ID } from './msw/handlers';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet, post: mockPost })),
  clearEndpointClients: jest.fn(),
}));

const BASE_URL = 'http://localhost:9001';
const TOKEN = 'ms_v2_testtoken0000000000000000000000';
const ENDPOINT_ID = 'ep-1';
const ENDPOINT_LABEL = 'Local';

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('agents integration', () => {
  it('fetchAgentsFromEndpoint returns agents with endpoint metadata injected', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockAgent] });
    const agents = await fetchAgentsFromEndpoint(BASE_URL, TOKEN, ENDPOINT_ID, ENDPOINT_LABEL);
    expect(agents.length).toBe(1);
    expect(agents[0].id).toBe(MOCK_AGENT_ID);
    expect(agents[0].name).toBe('test-agent');
    expect(agents[0].runtime).toBe('claude-code');
    // Injected fields must be present
    expect(agents[0].endpoint_id).toBe(ENDPOINT_ID);
    expect(agents[0].endpoint_label).toBe(ENDPOINT_LABEL);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/agents');
  });

  it('fetchAgentsFromEndpoint returns empty array when API returns empty list', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const agents = await fetchAgentsFromEndpoint(BASE_URL, TOKEN, ENDPOINT_ID, ENDPOINT_LABEL);
    expect(agents).toEqual([]);
  });

  it('fetchAgent returns single agent with endpoint metadata', async () => {
    mockGet.mockResolvedValueOnce({ data: mockAgent });
    const agent = await fetchAgent(BASE_URL, TOKEN, MOCK_AGENT_ID, ENDPOINT_ID, ENDPOINT_LABEL);
    expect(agent.id).toBe(MOCK_AGENT_ID);
    expect(agent.name).toBe('test-agent');
    expect(agent.project_path).toBe('/tmp/test-project');
    expect(agent.endpoint_id).toBe(ENDPOINT_ID);
    expect(mockGet).toHaveBeenCalledWith(`/api/v1/agents/${MOCK_AGENT_ID}`);
  });

  it('fetchAgent propagates error when request fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Request failed with status code 401'));
    await expect(
      fetchAgent(BASE_URL, 'bad-token', MOCK_AGENT_ID, ENDPOINT_ID, ENDPOINT_LABEL),
    ).rejects.toThrow();
  });

  it('fetchAllAgents aggregates results from multiple endpoints', async () => {
    const endpoints = [
      { id: 'ep-1', label: 'Local', base_url: BASE_URL, token: TOKEN },
      { id: 'ep-2', label: 'Remote', base_url: 'http://remote:8765', token: TOKEN },
    ];
    mockGet.mockResolvedValueOnce({ data: [mockAgent] }).mockResolvedValueOnce({ data: [] });
    const agents = await fetchAllAgents(endpoints);
    expect(agents.length).toBe(1);
    expect(agents[0].endpoint_id).toBe('ep-1');
  });

  it('fetchAllAgents returns partial results when one endpoint fails', async () => {
    const endpoints = [
      { id: 'ep-1', label: 'Local', base_url: BASE_URL, token: TOKEN },
      { id: 'ep-2', label: 'Failing', base_url: 'http://failing:8765', token: 'bad' },
    ];
    mockGet
      .mockResolvedValueOnce({ data: [mockAgent] })
      .mockRejectedValueOnce(new Error('Network error'));
    const agents = await fetchAllAgents(endpoints);
    // Should return agents from ep-1 even though ep-2 failed
    expect(agents.length).toBe(1);
    expect(agents[0].endpoint_id).toBe('ep-1');
  });
});
