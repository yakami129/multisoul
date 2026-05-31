import { dispatchSpecToAgent } from '@/features/specs/services/specDispatchService';
import { type Agent } from '@/types';
import { useSpecStore } from './specStore';

jest.mock('@/features/specs/services/specDispatchService', () => ({
  dispatchSpecToAgent: jest.fn(),
}));

const mockDispatchSpecToAgent = dispatchSpecToAgent as jest.MockedFunction<
  typeof dispatchSpecToAgent
>;

type SpecRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  target_agent_id: string;
  target_endpoint_id: string;
  target_repo_path: string;
  target_agent_name: string;
  target_runtime: string;
  questions_json: string;
  answers_json: string;
  markdown_preview: string | null;
  repo_spec_path: string | null;
  linked_conversation_id: string | null;
  linked_activity_item_id: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

let specRows: SpecRow[] = [];

const mockRunAsync = jest.fn(async (sql: string, params: unknown[]) => {
  if (sql.includes('INSERT OR REPLACE INTO specs')) {
    const row: SpecRow = {
      id: params[0] as string,
      title: params[1] as string,
      slug: params[2] as string,
      status: params[3] as string,
      target_agent_id: params[4] as string,
      target_endpoint_id: params[5] as string,
      target_repo_path: params[6] as string,
      target_agent_name: params[7] as string,
      target_runtime: params[8] as string,
      questions_json: params[9] as string,
      answers_json: params[10] as string,
      markdown_preview: (params[11] as string | null) ?? null,
      repo_spec_path: (params[12] as string | null) ?? null,
      linked_conversation_id: (params[13] as string | null) ?? null,
      linked_activity_item_id: (params[14] as string | null) ?? null,
      error_message: (params[15] as string | null) ?? null,
      created_at: params[16] as number,
      updated_at: params[17] as number,
    };
    specRows = [row, ...specRows.filter((existing) => existing.id !== row.id)];
  }
  if (sql.includes('DELETE FROM specs')) {
    specRows = specRows.filter((row) => row.id !== params[0]);
  }
});

const mockGetAllAsync = jest.fn(async () =>
  [...specRows].sort((a, b) => b.updated_at - a.updated_at),
);

jest.mock('@/db', () => ({
  getDb: () => ({
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  }),
}));

const agent: Agent = {
  id: 'agent-1',
  name: 'MultiSoul iOS',
  project_path: '/repo/multisoul',
  runtime: 'codex',
  created_at: 1,
  endpoint_id: 'endpoint-1',
  endpoint_label: 'MacBook',
};

const endpoint = {
  id: 'endpoint-1',
  label: 'MacBook',
  base_url: 'http://localhost:8765',
  token: 'token-1',
  last_seen_at: null,
};

/**
 * 场景：从 Agent 新建 spec 时，本地草稿应包含派发所需的 agent/repo 元数据。
 *
 * 数据构造：
 *   agent.id            = agent-1
 *   agent.endpoint_id   = endpoint-1
 *   agent.project_path  = /repo/multisoul
 *   title               = Offline First Spec Manager
 *
 * 执行过程：
 *   1. 清空 store 和 mock SQLite rows。
 *   2. 调用 createSpec({ title, targetAgent })。
 *   3. 读取 store 中的 specs[0]。
 *
 * 预期结果：
 *   - 正断言：status 为 draft，说明新 spec 从采访状态开始。
 *   - 正断言：targetAgentId/targetEndpointId/targetRepoPath 被写入，说明后续 dispatch 有足够上下文。
 *   - 负断言：markdownPreview 为空，说明新草稿不会误认为已经生成。
 */
test('createSpec stores draft with target agent metadata', async () => {
  specRows = [];
  useSpecStore.setState({ specs: [] });

  const spec = await useSpecStore.getState().createSpec({
    title: 'Offline First Spec Manager',
    targetAgent: agent,
  });

  expect(spec.status).toBe('draft');
  expect(spec.targetAgentId).toBe('agent-1');
  expect(spec.targetEndpointId).toBe('endpoint-1');
  expect(spec.targetRepoPath).toBe('/repo/multisoul');
  expect(spec.markdownPreview).toBeUndefined();
  expect(useSpecStore.getState().specs[0]?.id).toBe(spec.id);
});

/**
 * 场景：完成必填问答后生成预览，草稿应进入 Review 并能从本地 DB 重新加载。
 *
 * 数据构造：
 *   answers 覆盖 goal/scope/acceptance/non_goals/dispatch 五个必填问题。
 *   每个回答都包含非空 value，因此满足生成条件。
 *
 * 执行过程：
 *   1. createSpec 创建 draft。
 *   2. answerQuestion 写入五个回答。
 *   3. generatePreview 生成 markdown。
 *   4. approveSpec 标记 approved。
 *   5. 清空内存 store 后 load，从 mock SQLite rows 重新加载。
 *
 * 预期结果：
 *   - 正断言：preview 包含 SPEC 标题，说明 markdown 已生成。
 *   - 正断言：approve 后 status 为 approved。
 *   - 正断言：reload 后仍保留 answers 和 markdownPreview。
 *   - 负断言：reload 后 errorMessage 不存在，说明正常流程不会留下错误状态。
 */
test('completed draft generates preview, approves, and reloads from storage', async () => {
  specRows = [];
  useSpecStore.setState({ specs: [] });
  const spec = await useSpecStore.getState().createSpec({
    title: 'Offline First Spec Manager',
    targetAgent: agent,
  });

  for (const [index, questionId] of [
    'goal',
    'scope',
    'acceptance',
    'non_goals',
    'dispatch',
  ].entries()) {
    await useSpecStore.getState().answerQuestion(spec.id, {
      questionId,
      value: `${questionId} answer`,
      answeredAt: index + 1,
    });
  }

  await useSpecStore.getState().generatePreview(spec.id);
  const reviewSpec = useSpecStore.getState().specs[0];
  expect(reviewSpec?.status).toBe('review');
  expect(reviewSpec?.markdownPreview).toContain('# Offline First Spec Manager SPEC');

  await useSpecStore.getState().approveSpec(spec.id);
  expect(useSpecStore.getState().specs[0]?.status).toBe('approved');

  useSpecStore.setState({ specs: [] });
  await useSpecStore.getState().load();
  const reloaded = useSpecStore.getState().specs[0];
  expect(reloaded?.answers).toHaveLength(5);
  expect(reloaded?.markdownPreview).toContain('goal answer');
  expect(reloaded?.errorMessage).toBeUndefined();
});

/**
 * 场景：Approved spec 派发成功后，store 应调用 CLI dispatch endpoint 并持久化 conversation 关联。
 *
 * 数据构造：
 *   spec.status       = approved
 *   markdownPreview   = "# Offline First SPEC"
 *   endpoint.base_url = http://localhost:8765
 *   endpoint.token    = token-1
 *   agent.id          = agent-1
 *   response          = conversation_id=conv-spec-1, repo_spec_path=docs/product-specs/2026-05-31-SPEC-offline-first-spec-manager.md
 *
 * 执行过程：
 *   1. 创建 spec，补齐必填问答，generatePreview，approveSpec。
 *   2. mock dispatchSpecToAgent 返回 CLI 派发结果。
 *   3. 调用 useSpecStore.dispatchSpec(spec.id, endpoint)。
 *   4. 读取 store 中的 spec 状态。
 *
 * 预期结果：
 *   - 正断言：dispatchSpecToAgent 收到 endpoint 凭据、agent id、title/slug/markdown。
 *   - 正断言：status 变为 dispatched，repoSpecPath 和 linkedConversationId 被写入。
 *   - 负断言：errorMessage 为空，说明成功派发不会留下失败状态。
 */
test('dispatchSpec sends approved markdown to endpoint and persists dispatch result', async () => {
  specRows = [];
  mockDispatchSpecToAgent.mockResolvedValue({
    conversation_id: 'conv-spec-1',
    repo_spec_path: 'docs/product-specs/2026-05-31-SPEC-offline-first-spec-manager.md',
  });
  useSpecStore.setState({ specs: [] });
  const spec = await useSpecStore.getState().createSpec({
    title: 'Offline First Spec Manager',
    targetAgent: agent,
  });
  for (const [index, questionId] of [
    'goal',
    'scope',
    'acceptance',
    'non_goals',
    'dispatch',
  ].entries()) {
    await useSpecStore.getState().answerQuestion(spec.id, {
      questionId,
      value: `${questionId} answer`,
      answeredAt: index + 1,
    });
  }
  await useSpecStore.getState().generatePreview(spec.id);
  await useSpecStore.getState().approveSpec(spec.id);

  const result = await useSpecStore.getState().dispatchSpec(spec.id, endpoint);

  expect(mockDispatchSpecToAgent).toHaveBeenCalledWith(
    'http://localhost:8765',
    'token-1',
    'agent-1',
    expect.objectContaining({
      title: 'Offline First Spec Manager',
      slug: 'offline-first-spec-manager',
      markdown: expect.stringContaining('# Offline First Spec Manager SPEC'),
    }),
  );
  expect(result.conversation_id).toBe('conv-spec-1');
  const dispatched = useSpecStore.getState().specs[0];
  expect(dispatched?.status).toBe('dispatched');
  expect(dispatched?.repoSpecPath).toBe(
    'docs/product-specs/2026-05-31-SPEC-offline-first-spec-manager.md',
  );
  expect(dispatched?.linkedConversationId).toBe('conv-spec-1');
  expect(dispatched?.errorMessage).toBeUndefined();
});

/**
 * 场景：CLI dispatch endpoint 失败时，store 应回写 failed 状态并保留错误信息。
 *
 * 数据构造：
 *   spec.status     = approved
 *   service error   = Error("409 conflict")
 *   previous linked = undefined
 *
 * 执行过程：
 *   1. 创建并 approve 一个 spec。
 *   2. mock dispatchSpecToAgent reject。
 *   3. 调用 dispatchSpec 并捕获错误。
 *   4. 检查本地 spec 状态。
 *
 * 预期结果：
 *   - 正断言：调用抛出 409 conflict，方便 route 停止跳转。
 *   - 正断言：status 变为 failed，errorMessage 包含 409 conflict。
 *   - 负断言：linkedConversationId 仍为空，说明失败不会生成虚假的 chat 链接。
 */
test('dispatchSpec marks failed when endpoint dispatch rejects', async () => {
  specRows = [];
  mockDispatchSpecToAgent.mockRejectedValue(new Error('409 conflict'));
  useSpecStore.setState({ specs: [] });
  const spec = await useSpecStore.getState().createSpec({
    title: 'Offline First Spec Manager',
    targetAgent: agent,
  });
  for (const [index, questionId] of [
    'goal',
    'scope',
    'acceptance',
    'non_goals',
    'dispatch',
  ].entries()) {
    await useSpecStore.getState().answerQuestion(spec.id, {
      questionId,
      value: `${questionId} answer`,
      answeredAt: index + 1,
    });
  }
  await useSpecStore.getState().generatePreview(spec.id);
  await useSpecStore.getState().approveSpec(spec.id);

  await expect(useSpecStore.getState().dispatchSpec(spec.id, endpoint)).rejects.toThrow(
    '409 conflict',
  );

  const failed = useSpecStore.getState().specs[0];
  expect(failed?.status).toBe('failed');
  expect(failed?.errorMessage).toContain('409 conflict');
  expect(failed?.linkedConversationId).toBeUndefined();
});
