import { type SpecAnswer, type SpecQuestion } from '../types';

export const SPEC_INTERVIEW_QUESTIONS: SpecQuestion[] = [
  {
    id: 'goal',
    text: '这次需求最直接要达成什么结果？',
    options: [
      { id: 'mvp', label: '打通可用 MVP' },
      { id: 'quality', label: '提升现有体验质量' },
      { id: 'automation', label: '减少重复人工操作' },
    ],
    allowsOther: true,
  },
  {
    id: 'scope',
    text: '第一版范围应该如何控制？',
    options: [
      { id: 'smallest_loop', label: '只做最小闭环' },
      { id: 'management', label: '先做好管理入口' },
      { id: 'execution', label: '优先保证可执行' },
    ],
    allowsOther: true,
  },
  {
    id: 'acceptance',
    text: '什么结果代表可以验收？',
    options: [
      { id: 'e2e', label: '端到端流程可跑通' },
      { id: 'tests', label: '关键路径有自动测试' },
      { id: 'manual', label: '手动验证通过即可' },
    ],
    allowsOther: true,
  },
  {
    id: 'non_goals',
    text: '第一版明确不做什么？',
    options: [
      { id: 'no_parallel_agents', label: '不做多 agent 并行' },
      { id: 'no_long_editing', label: '不做手机端长文编辑' },
      { id: 'no_auto_pr', label: '不做自动 PR' },
    ],
    multiSelect: true,
    allowsOther: true,
  },
  {
    id: 'dispatch',
    text: '派发给 agent 时应该怎么执行？',
    options: [
      { id: 'one_agent', label: '单 spec 派发给单 agent' },
      { id: 'plan_only', label: '只生成派发计划' },
      { id: 'ask_if_blocked', label: '执行遇阻时回问用户' },
    ],
    allowsOther: true,
  },
];

const REQUIRED_IDS = SPEC_INTERVIEW_QUESTIONS.map((question) => question.id);

function answerHasValue(answer: SpecAnswer | undefined): boolean {
  if (!answer) return false;
  if (Array.isArray(answer.value)) {
    return answer.value.some((value) => value.trim().length > 0);
  }
  return answer.value.trim().length > 0;
}

export function getFirstOpenQuestionId(answers: SpecAnswer[]): string | null {
  return (
    REQUIRED_IDS.find((id) => {
      const answer = answers.find((item) => item.questionId === id);
      return !answerHasValue(answer);
    }) ?? null
  );
}

export function isSpecInterviewReady(answers: SpecAnswer[]): boolean {
  return getFirstOpenQuestionId(answers) == null;
}
