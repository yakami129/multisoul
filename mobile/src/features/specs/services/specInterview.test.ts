import {
  getFirstOpenQuestionId,
  isSpecInterviewReady,
  SPEC_INTERVIEW_QUESTIONS,
} from './specInterview';
import { type SpecAnswer } from '../types';

/**
 * 场景：未回答任何问题时，采访不能生成 SPEC，且第一个开放问题必须是目标问题。
 *
 * 数据构造：
 *   answers = []，表示新建草稿刚进入采访阶段。
 *   SPEC_INTERVIEW_QUESTIONS 至少包含 goal/scope/acceptance/non_goals/dispatch 五类必填问题。
 *
 * 执行过程：
 *   1. 调用 getFirstOpenQuestionId([]) 查找第一个未回答问题。
 *   2. 调用 isSpecInterviewReady([]) 判断是否可生成 SPEC。
 *
 * 预期结果：
 *   - 第一个开放问题是 goal，说明采访从目标开始。
 *   - ready 为 false，说明空草稿不能生成 SPEC。
 */
test('new draft starts at goal question and is not ready to generate', () => {
  expect(SPEC_INTERVIEW_QUESTIONS.length).toBeGreaterThanOrEqual(5);
  expect(getFirstOpenQuestionId([])).toBe('goal');
  expect(isSpecInterviewReady([])).toBe(false);
});

/**
 * 场景：所有必填问题都有明确回答后，采访可以生成 SPEC。
 *
 * 数据构造：
 *   answers 覆盖 goal/scope/acceptance/non_goals/dispatch。
 *   每条 answer.value 都是非空字符串，模拟用户完成结构化点选或 Other 输入。
 *
 * 执行过程：
 *   1. 调用 isSpecInterviewReady(answers)。
 *   2. 调用 getFirstOpenQuestionId(answers)。
 *
 * 预期结果：
 *   - ready 为 true，说明生成入口可以启用。
 *   - firstOpen 为 null，说明没有必填缺口。
 */
test('completed required answers make interview ready to generate', () => {
  const answers: SpecAnswer[] = [
    { questionId: 'goal', value: 'Build a spec workflow', answeredAt: 1 },
    { questionId: 'scope', value: 'MVP flow only', answeredAt: 2 },
    { questionId: 'acceptance', value: 'Can dispatch one spec', answeredAt: 3 },
    { questionId: 'non_goals', value: 'No multi-agent dispatch', answeredAt: 4 },
    { questionId: 'dispatch', value: 'One selected agent', answeredAt: 5 },
  ];

  expect(isSpecInterviewReady(answers)).toBe(true);
  expect(getFirstOpenQuestionId(answers)).toBeNull();
});
