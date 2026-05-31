import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type SpecDraft } from '../types';
import { SpecDetailScreen } from './SpecDetailScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const draftSpec: SpecDraft = {
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
  answers: [],
  createdAt: 1,
  updatedAt: 2,
};

/**
 * 场景：Draft 状态显示第一个开放问题，未完成必填回答前不能生成 SPEC。
 *
 * 数据构造：
 *   spec.status = draft。
 *   answers = []，表示未回答任何必填问题。
 *
 * 执行过程：
 *   1. 渲染 SpecDetailScreen。
 *   2. 查找 goal 问题文案。
 *   3. 检查 Generate Spec 按钮 disabled。
 *
 * 预期结果：
 *   - 正断言：显示“这次需求最直接要达成什么结果？”。
 *   - 正断言：Generate Spec disabled，说明未完成采访不能生成。
 */
test('draft shows first question and disables generate until ready', () => {
  const { getByLabelText, getByText } = render(
    <SpecDetailScreen
      spec={draftSpec}
      onBack={() => {}}
      onAnswer={() => {}}
      onGenerate={() => {}}
      onApprove={() => {}}
      onAskMore={() => {}}
      onDispatch={() => {}}
    />,
  );

  expect(getByText('这次需求最直接要达成什么结果？')).toBeTruthy();
  expect(getByLabelText('Generate Spec').props.accessibilityState.disabled).toBe(true);
});

/**
 * 场景：点击结构化选项后，详情页把回答交给上层 store。
 *
 * 数据构造：
 *   spec.status = draft。
 *   第一个问题 goal 的第一个选项是“打通可用 MVP”。
 *
 * 执行过程：
 *   1. 渲染 SpecDetailScreen。
 *   2. 点击“打通可用 MVP”。
 *
 * 预期结果：
 *   - 正断言：onAnswer 被调用一次。
 *   - 正断言：answer.questionId = goal。
 *   - 正断言：answer.value = 打通可用 MVP。
 */
test('selecting an option emits a structured answer', () => {
  const onAnswer = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      spec={draftSpec}
      onBack={() => {}}
      onAnswer={onAnswer}
      onGenerate={() => {}}
      onApprove={() => {}}
      onAskMore={() => {}}
      onDispatch={() => {}}
    />,
  );

  fireEvent.press(getByText('打通可用 MVP'));

  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onAnswer.mock.calls[0][0]).toEqual(
    expect.objectContaining({ questionId: 'goal', value: '打通可用 MVP' }),
  );
});

/**
 * 场景：multiSelect 问题点击选项时，应向 store 输出数组值而不是覆盖成单个字符串。
 *
 * 数据构造：
 *   answers 已完成 goal/scope/acceptance，因此第一个开放问题是 non_goals。
 *   non_goals.multiSelect = true。
 *   点击选项 = “不做多 agent 并行”。
 *
 * 执行过程：
 *   1. 渲染 activeQuestion=non_goals 的 SpecDetailScreen。
 *   2. 点击“不做多 agent 并行”。
 *
 * 预期结果：
 *   - 正断言：onAnswer.value 是包含该选项的数组。
 *   - 负断言：onAnswer.value 不是字符串，避免多选被单选逻辑吞掉。
 */
test('multi-select question emits an array answer', () => {
  const onAnswer = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      spec={{
        ...draftSpec,
        answers: [
          { questionId: 'goal', value: 'goal answer', answeredAt: 1 },
          { questionId: 'scope', value: 'scope answer', answeredAt: 2 },
          { questionId: 'acceptance', value: 'acceptance answer', answeredAt: 3 },
        ],
      }}
      onBack={() => {}}
      onAnswer={onAnswer}
      onGenerate={() => {}}
      onApprove={() => {}}
      onAskMore={() => {}}
      onDispatch={() => {}}
    />,
  );

  fireEvent.press(getByText('不做多 agent 并行'));

  const answer = onAnswer.mock.calls[0][0];
  expect(answer.value).toEqual(['不做多 agent 并行']);
  expect(typeof answer.value).not.toBe('string');
});

/**
 * 场景：允许 Other 的问题应支持用户输入自定义答案。
 *
 * 数据构造：
 *   activeQuestion = goal，allowsOther = true。
 *   other text = "先验证写入 repo 的闭环"。
 *
 * 执行过程：
 *   1. 渲染 Draft 详情页。
 *   2. 在 Other 输入框输入文本。
 *   3. 点击 Add Other Answer。
 *
 * 预期结果：
 *   - 正断言：onAnswer.questionId = goal。
 *   - 正断言：onAnswer.value 等于自定义文本。
 *   - 负断言：value 不等于预设选项，说明确实走了 Other 输入。
 */
test('allows other answer input for freeform detail', () => {
  const onAnswer = jest.fn();
  const { getByLabelText } = render(
    <SpecDetailScreen
      spec={draftSpec}
      onBack={() => {}}
      onAnswer={onAnswer}
      onGenerate={() => {}}
      onApprove={() => {}}
      onAskMore={() => {}}
      onDispatch={() => {}}
    />,
  );

  fireEvent.changeText(getByLabelText('Other answer'), '先验证写入 repo 的闭环');
  fireEvent.press(getByLabelText('Add Other Answer'));

  expect(onAnswer).toHaveBeenCalledWith(
    expect.objectContaining({
      questionId: 'goal',
      value: '先验证写入 repo 的闭环',
    }),
  );
  expect(onAnswer.mock.calls[0][0].value).not.toBe('打通可用 MVP');
});

/**
 * 场景：Review 状态显示 markdown preview，并提供 Ask More / Approve。
 *
 * 数据构造：
 *   spec.status = review。
 *   markdownPreview 包含 SPEC 标题。
 *
 * 执行过程：
 *   1. 渲染 Review 状态。
 *   2. 点击 Approve。
 *   3. 点击 Ask More。
 *
 * 预期结果：
 *   - 正断言：显示 markdown preview。
 *   - 正断言：Approve 回调被调用。
 *   - 正断言：Ask More 回调被调用。
 */
test('review shows markdown preview with approve and ask more actions', () => {
  const onApprove = jest.fn();
  const onAskMore = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      spec={{ ...draftSpec, status: 'review', markdownPreview: '# Offline First SPEC' }}
      onBack={() => {}}
      onAnswer={() => {}}
      onGenerate={() => {}}
      onApprove={onApprove}
      onAskMore={onAskMore}
      onDispatch={() => {}}
    />,
  );

  expect(getByText('# Offline First SPEC')).toBeTruthy();
  fireEvent.press(getByText('Approve'));
  fireEvent.press(getByText('Ask More'));

  expect(onApprove).toHaveBeenCalledTimes(1);
  expect(onAskMore).toHaveBeenCalledTimes(1);
});

/**
 * 场景：Approved 状态展示 Dispatch 动作，允许用户派发给单个 agent。
 *
 * 数据构造：
 *   spec.status = approved。
 *
 * 执行过程：
 *   1. 渲染 Approved 状态。
 *   2. 点击 Dispatch。
 *
 * 预期结果：
 *   - 正断言：显示 Dispatch。
 *   - 正断言：onDispatch 被调用一次。
 */
test('approved spec exposes dispatch action', () => {
  const onDispatch = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      spec={{ ...draftSpec, status: 'approved', markdownPreview: '# Offline First SPEC' }}
      onBack={() => {}}
      onAnswer={() => {}}
      onGenerate={() => {}}
      onApprove={() => {}}
      onAskMore={() => {}}
      onDispatch={onDispatch}
    />,
  );

  fireEvent.press(getByText('Dispatch'));

  expect(onDispatch).toHaveBeenCalledTimes(1);
});
