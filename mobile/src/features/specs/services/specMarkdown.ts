import { type SpecAnswer, type SpecDraft } from '../types';

function answerText(answers: SpecAnswer[], questionId: string, fallback: string): string {
  const answer = answers.find((item) => item.questionId === questionId);
  if (!answer) return fallback;
  if (Array.isArray(answer.value)) {
    const joined = answer.value.filter((value) => value.trim().length > 0).join(', ');
    return joined || fallback;
  }
  return answer.value.trim() || fallback;
}

export function buildSpecSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled-spec';
}

export function buildSpecMarkdown(spec: SpecDraft): string {
  const goal = answerText(spec.answers, 'goal', '目标待补充。');
  const scope = answerText(spec.answers, 'scope', '范围待补充。');
  const acceptance = answerText(spec.answers, 'acceptance', '验收标准待补充。');
  const nonGoals = answerText(spec.answers, 'non_goals', '非目标待补充。');
  const dispatch = answerText(spec.answers, 'dispatch', '派发方式待补充。');

  return [
    `# ${spec.title} SPEC`,
    '',
    '## 1. 背景与目标',
    '',
    goal,
    '',
    '## 2. 范围',
    '',
    '### 2.1 In Scope',
    '',
    scope,
    '',
    '### 2.2 Out of Scope',
    '',
    nonGoals,
    '',
    '## 3. 用户与使用场景',
    '',
    `目标项目：${spec.targetRepoPath}`,
    `目标 Agent：${spec.targetAgentName}`,
    '',
    '## 4. 业务流程与信息架构',
    '',
    dispatch,
    '',
    '## 5. UI/UX 需求',
    '',
    '遵循现有 MultiSoul iOS 深色优先设计系统。',
    '',
    '## 6. 状态、错误与边界情况',
    '',
    '执行遇阻时，agent 必须通过 AskUserQuestion 回问用户。',
    '',
    '## 7. 验收标准',
    '',
    acceptance,
    '',
    '## 8. 未决问题',
    '',
    '- 无。',
    '',
  ].join('\n');
}
