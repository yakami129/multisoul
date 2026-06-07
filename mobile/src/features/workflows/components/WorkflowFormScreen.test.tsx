import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { type Agent } from '@/types';
import { WorkflowFormScreen } from './WorkflowFormScreen';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

const agents: Agent[] = [
  {
    id: 'agent-1',
    name: 'MultiSoul iOS',
    project_path: '/repo/multisoul',
    runtime: 'claude-code',
    created_at: 1_779_000_000_000,
    endpoint_id: 'ep-1',
    endpoint_label: 'Office Mac',
  },
  {
    id: 'agent-2',
    name: 'Backend Agent',
    project_path: '/repo/backend',
    runtime: 'codex',
    created_at: 1_779_000_000_000,
    endpoint_id: 'ep-1',
    endpoint_label: 'Office Mac',
  },
];

beforeEach(() => {
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
});

/// 场景：agent 选择器显示所有已注册 agent。
///
/// 数据构造：
///   agents = [MultiSoul iOS, Backend Agent]。
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen。
///   2. 查找 agent 名称。
///
/// 预期结果：
///   - 正断言：显示 MultiSoul iOS。
///   - 正断言：显示 Backend Agent。
test('agent selector shows all registered agents', () => {
  const { getByText } = render(
    <WorkflowFormScreen agents={agents} onSave={() => {}} onCancel={() => {}} />,
  );

  expect(getByText('MultiSoul iOS')).toBeTruthy();
  expect(getByText('Backend Agent')).toBeTruthy();
});

/// 场景：切换到 weekly 时显示 weekday 选择器，切换回 daily 时隐藏。
///
/// 数据构造：
///   初始 schedule_kind = daily。
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen。
///   2. 点击 Weekly 分段。
///   3. 验证 weekday 选择器出现。
///   4. 点击 Daily 分段。
///   5. 验证 weekday 选择器消失。
///
/// 预期结果：
///   - 正断言：Weekly 选中后显示 Weekday 字段。
///   - 负断言：Daily 选中后不显示 Weekday 字段。
test('weekly segment shows weekday selector, daily hides it', () => {
  const { getByText, queryByText } = render(
    <WorkflowFormScreen agents={agents} onSave={() => {}} onCancel={() => {}} />,
  );

  expect(queryByText('Weekday')).toBeNull();

  fireEvent.press(getByText('Weekly'));
  expect(getByText('Weekday')).toBeTruthy();

  fireEvent.press(getByText('Daily'));
  expect(queryByText('Weekday')).toBeNull();
});

/// 场景：空 prompt 时 Save 按钮禁用。
///
/// 数据构造：
///   prompt = ''（默认空）。
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen。
///   2. 查找 Save 按钮。
///
/// 预期结果：
///   - 正断言：Save 按钮存在。
///   - 正断言：onSave 不被调用（按钮禁用）。
test('empty prompt disables save', () => {
  const onSave = jest.fn();
  const { getByText } = render(
    <WorkflowFormScreen agents={agents} onSave={onSave} onCancel={() => {}} />,
  );

  fireEvent.press(getByText('Save'));
  expect(onSave).not.toHaveBeenCalled();
});

/// 场景：用户输入未补零的时间时，保存前规范化为 CLI 接受的 HH:mm。
///
/// 数据构造：
///   name       = "Morning report"
///   prompt     = "Summarize repository"
///   input time = "9:5"
///   normalized = "09:05"（hour 9 补零到 09，minute 5 补零到 05）
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen。
///   2. 填写 name、time、prompt。
///   3. 点击 Save。
///   4. 检查 onSave 收到的 payload。
///
/// 预期结果：
///   - 正断言：onSave 被调用一次。
///   - 正断言：time_of_day 为规范化后的 09:05。
///   - 负断言：time_of_day 不是原始的 9:5，避免后端 HH:mm 校验失败。
test('save normalizes time before submitting workflow input', () => {
  const onSave = jest.fn();
  const { getByPlaceholderText, getByText } = render(
    <WorkflowFormScreen agents={agents} onSave={onSave} onCancel={() => {}} />,
  );

  fireEvent.changeText(getByPlaceholderText('e.g. CI Watch'), 'Morning report');
  fireEvent.changeText(getByPlaceholderText('HH:MM'), '9:5');
  fireEvent.changeText(getByPlaceholderText('What should the agent do?'), 'Summarize repository');
  fireEvent.press(getByText('Save'));

  expect({
    actual: onSave.mock.calls.length,
    reason: 'valid workflow form should call onSave once when Save is pressed',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: onSave.mock.calls[0][0].time_of_day,
    reason: 'single-digit hour and minute should be padded before calling the API',
  }).toEqual({ actual: '09:05', reason: expect.any(String) });
  expect({
    actual: onSave.mock.calls[0][0].time_of_day,
    reason: 'raw 9:5 would be rejected by the CLI HH:mm validator and appear not to save',
  }).not.toEqual({ actual: '9:5', reason: expect.any(String) });
});

/// 场景：编辑 workflow 时，表单应带入现有配置，保存后走同一份 normalized payload。
///
/// 数据构造：
///   initialValues = weekly workflow，agent-2，time = 17:30，weekday = Friday。
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen，传入 initialValues 和 title。
///   2. 检查标题、名称、prompt、时间和 weekly 字段已显示。
///   3. 点击 Save。
///
/// 预期结果：
///   - 正断言：表单显示 Edit Workflow。
///   - 正断言：保存 payload 保留 workflow 的 agent、schedule 和 prompt。
///   - 负断言：编辑不会退回默认 daily 09:00。
test('edit mode pre-fills workflow values before saving', () => {
  const onSave = jest.fn();
  const { getByDisplayValue, getByText } = render(
    <WorkflowFormScreen
      agents={agents}
      title="Edit Workflow"
      initialValues={{
        name: 'Friday Review',
        agent_id: 'agent-2',
        prompt: 'Review release risk',
        schedule_kind: 'weekly',
        time_of_day: '17:30',
        day_of_week: 5,
      }}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );

  expect(getByText('Edit Workflow')).toBeTruthy();
  expect(getByDisplayValue('Friday Review')).toBeTruthy();
  expect(getByDisplayValue('Review release risk')).toBeTruthy();
  expect(getByDisplayValue('17:30')).toBeTruthy();
  expect(getByText('Weekday')).toBeTruthy();

  fireEvent.press(getByText('Save'));

  expect({
    actual: onSave.mock.calls[0][0],
    reason: 'editing should submit the existing workflow fields unless the user changes them',
  }).toEqual({
    actual: {
      name: 'Friday Review',
      agent_id: 'agent-2',
      prompt: 'Review release risk',
      mode: 'recurring',
      schedule_kind: 'weekly',
      time_of_day: '17:30',
      day_of_week: 5,
    },
    reason: expect.any(String),
  });
  expect({
    actual: onSave.mock.calls[0][0].schedule_kind,
    reason: 'edit mode must not reset an existing weekly workflow to the default daily schedule',
  }).not.toEqual({ actual: 'daily', reason: expect.any(String) });
});

/// 场景：创建 workflow 时，键盘弹出后表单仍可把 Time 输入区滚到可见区域。
///
/// 数据构造：
///   bottom inset = 20pt（模拟带 Home Indicator 的 iPhone）。
///   form base bottom padding = 120pt（保存按钮/键盘上方留白）。
///   expected bottom padding = bottom inset(20) + base padding(120) = 140pt。
///
/// 执行过程：
///   1. 渲染 WorkflowFormScreen。
///   2. 读取最外层 KeyboardAvoidingView。
///   3. 读取内部 ScrollView 的键盘相关属性和底部 padding。
///
/// 预期结果：
///   - 正断言：iOS 使用 padding 行为抬起表单内容。
///   - 正断言：ScrollView 自动响应键盘 inset。
///   - 正断言：点击 Time 输入框时不会因为键盘点击处理丢失焦点。
///   - 负断言：底部 padding 不应只保留旧的 120pt，必须包含安全区。
test('form keeps time input reachable when the keyboard is open', () => {
  mockInsets = { top: 0, bottom: 20, left: 0, right: 0 };

  const { UNSAFE_getByType } = render(
    <WorkflowFormScreen agents={agents} onSave={() => {}} onCancel={() => {}} />,
  );

  const keyboardAvoider = UNSAFE_getByType(KeyboardAvoidingView);
  const scrollView = UNSAFE_getByType(ScrollView);
  const contentContainerStyle = scrollView.props.contentContainerStyle as Array<{
    paddingBottom?: number;
  }>;
  const bottomInsetStyle = contentContainerStyle[1];

  expect({
    actual: keyboardAvoider.props.behavior,
    reason: 'workflow form in an iOS pageSheet must move content above the keyboard',
  }).toEqual({ actual: 'padding', reason: expect.any(String) });
  expect({
    actual: scrollView.props.automaticallyAdjustKeyboardInsets,
    reason: 'ScrollView should resize its scrollable area when the keyboard appears',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: scrollView.props.keyboardShouldPersistTaps,
    reason: 'tapping the Time input while the keyboard is open should keep the tap handled',
  }).toEqual({ actual: 'handled', reason: expect.any(String) });
  expect({
    actual: bottomInsetStyle.paddingBottom,
    reason:
      'bottom padding should include safe area so the old 120pt spacer is not the only clearance',
  }).toEqual({ actual: 140, reason: expect.any(String) });
  expect({
    actual: bottomInsetStyle.paddingBottom,
    reason: 'the old fixed 120pt bottom padding would still let the keyboard cover lower fields',
  }).not.toEqual({ actual: 120, reason: expect.any(String) });
});
