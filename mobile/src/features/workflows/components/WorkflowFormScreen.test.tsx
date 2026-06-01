import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type Agent } from '@/types';
import { WorkflowFormScreen } from './WorkflowFormScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
