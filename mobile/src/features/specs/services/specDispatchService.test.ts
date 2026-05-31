import { getEndpointClient } from '@/api/endpointClient';
import { dispatchSpecToAgent } from './specDispatchService';

const mockPost = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    post: mockPost,
  })),
}));

/**
 * 场景：dispatchSpecToAgent 应调用 CLI spec dispatch endpoint，并返回 conversation/path 结果。
 *
 * 数据构造：
 *   base_url = http://localhost:8765
 *   token    = token-1
 *   agent_id = agent-1
 *   payload  = title + slug + approved markdown
 *   response = { conversation_id: conv-spec-1, repo_spec_path: docs/product-specs/...md }
 *
 * 执行过程：
 *   1. mock endpointClient.post 返回 CLI response。
 *   2. 调用 dispatchSpecToAgent(base_url, token, agent_id, payload)。
 *   3. 检查 post 路径、body 和返回值。
 *
 * 预期结果：
 *   - 正断言：getEndpointClient 使用 endpoint base_url/token。
 *   - 正断言：POST 到 /api/v1/agents/agent-1/specs/dispatch。
 *   - 正断言：body 包含 title/slug/markdown。
 *   - 负断言：不会调用旧的 /conversations endpoint。
 */
test('dispatchSpecToAgent posts approved spec markdown to agent dispatch endpoint', async () => {
  mockPost.mockResolvedValue({
    data: {
      conversation_id: 'conv-spec-1',
      repo_spec_path: 'docs/product-specs/2026-05-31-SPEC-offline-first-spec-manager.md',
    },
  });

  const result = await dispatchSpecToAgent('http://localhost:8765', 'token-1', 'agent-1', {
    title: 'Offline First Spec Manager',
    slug: 'offline-first-spec-manager',
    markdown: '# Offline First Spec Manager SPEC\n',
  });

  expect(getEndpointClient).toHaveBeenCalledWith('http://localhost:8765', 'token-1');
  expect(mockPost).toHaveBeenCalledWith('/api/v1/agents/agent-1/specs/dispatch', {
    title: 'Offline First Spec Manager',
    slug: 'offline-first-spec-manager',
    markdown: '# Offline First Spec Manager SPEC\n',
  });
  expect(mockPost).not.toHaveBeenCalledWith(
    '/api/v1/agents/agent-1/conversations',
    expect.anything(),
  );
  expect(result.conversation_id).toBe('conv-spec-1');
  expect(result.repo_spec_path).toBe(
    'docs/product-specs/2026-05-31-SPEC-offline-first-spec-manager.md',
  );
});
