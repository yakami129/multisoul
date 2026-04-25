import { fetchAgents, fetchAgent, invokeAgent } from './agentService';
import { Agent } from '@/types';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('axios', () => ({
  create: jest.fn(),
  get: (...args: any[]) => mockGet(...args),
  post: (...args: any[]) => mockPost(...args),
}));

const mockClient = { get: mockGet, post: mockPost } as any;

const mockAgent: Agent = {
  id: 'a1',
  name: 'Test Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'desc',
};

describe('agentService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('fetchAgents returns array of agents', async () => {
    mockGet.mockResolvedValueOnce({ data: [mockAgent] });
    const result = await fetchAgents(mockClient);
    expect(result).toEqual([mockAgent]);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/agents');
  });

  it('fetchAgent returns single agent by id', async () => {
    mockGet.mockResolvedValueOnce({ data: mockAgent });
    const result = await fetchAgent(mockClient, 'a1');
    expect(result).toEqual(mockAgent);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/agents/a1');
  });

  it('invokeAgent returns string result for single-key response', async () => {
    mockPost.mockResolvedValueOnce({ data: { result: 'ok' } });
    const result = await invokeAgent(mockClient, 'a1');
    expect(result).toBe('ok');
  });

  it('invokeAgent returns JSON string for multi-key response', async () => {
    mockPost.mockResolvedValueOnce({ data: { a: '1', b: '2' } });
    const result = await invokeAgent(mockClient, 'a1');
    expect(result).toBe(JSON.stringify({ a: '1', b: '2' }, null, 2));
  });
});
