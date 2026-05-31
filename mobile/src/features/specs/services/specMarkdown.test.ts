import { buildSpecMarkdown, buildSpecSlug } from './specMarkdown';
import { type SpecDraft } from '../types';

const baseSpec: SpecDraft = {
  id: 'spec-1',
  title: 'Offline First Spec Manager',
  slug: 'offline-first-spec-manager',
  status: 'draft',
  targetAgentId: 'agent-1',
  targetEndpointId: 'endpoint-1',
  targetRepoPath: '/repo/multisoul',
  targetAgentName: 'MultiSoul iOS',
  targetRuntime: 'codex',
  questions: [],
  answers: [
    { questionId: 'goal', value: 'Build a spec workflow', answeredAt: 1 },
    { questionId: 'scope', value: 'MVP flow only', answeredAt: 2 },
    { questionId: 'acceptance', value: 'Can dispatch one spec', answeredAt: 3 },
    { questionId: 'non_goals', value: ['No multi-agent dispatch', 'No auto PR'], answeredAt: 4 },
    { questionId: 'dispatch', value: 'One selected agent', answeredAt: 5 },
  ],
  createdAt: 10,
  updatedAt: 20,
};

/**
 * 场景：结构化回答能生成包含核心章节的 SPEC.md 预览。
 *
 * 数据构造：
 *   baseSpec.title = Offline First Spec Manager。
 *   answers 覆盖 goal/scope/acceptance/non_goals/dispatch。
 *
 * 执行过程：
 *   1. 调用 buildSpecMarkdown(baseSpec)。
 *   2. 检查 markdown 中的标题、范围、非目标和派发约束。
 *
 * 预期结果：
 *   - markdown 包含 H1 标题，方便写入 repo 后直接阅读。
 *   - markdown 包含目标、范围、验收标准、非目标，满足 MVP 生成物要求。
 *   - markdown 不包含空的 undefined/null 文本。
 */
test('buildSpecMarkdown renders required sections from structured answers', () => {
  const markdown = buildSpecMarkdown(baseSpec);

  expect(markdown).toContain('# Offline First Spec Manager SPEC');
  expect(markdown).toContain('## 1. 背景与目标');
  expect(markdown).toContain('Build a spec workflow');
  expect(markdown).toContain('## 2. 范围');
  expect(markdown).toContain('MVP flow only');
  expect(markdown).toContain('No multi-agent dispatch');
  expect(markdown).toContain('One selected agent');
  expect(markdown).not.toContain('undefined');
  expect(markdown).not.toContain('null');
});

/**
 * 场景：标题被转换成稳定 slug，用于 repo 文件名。
 *
 * 数据构造：
 *   输入标题含大小写、空格和标点。
 *
 * 执行过程：
 *   1. 调用 buildSpecSlug。
 *
 * 预期结果：
 *   - 输出只保留小写字母、数字和单横线。
 *   - 不出现连续横线，避免生成难读文件名。
 */
test('buildSpecSlug normalizes title into repo safe kebab case', () => {
  expect(buildSpecSlug('Offline First Spec Manager!!')).toBe('offline-first-spec-manager');
});
