import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type Workflow } from '../types';
import { WorkflowListScreen } from './WorkflowListScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions?.()}
      </View>
    ),
  };
});

const baseWorkflow: Workflow = {
  id: 'wf-1',
  name: 'Morning Report',
  agent_id: 'agent-1',
  prompt: 'Summarize repo state',
  enabled: true,
  schedule_kind: 'daily',
  time_of_day: '09:15',
  day_of_week: null,
  next_run_at: 1_780_000_000_000,
  last_run_at: null,
  created_at: 1_779_000_000_000,
  updated_at: 1_779_000_000_000,
  endpoint_id: 'ep-1',
  endpoint_label: 'Office Mac',
};

/// 场景：没有 workflow 时展示空状态。
///
/// 数据构造：
///   workflows = []，hasEndpoints = true。
///
/// 执行过程：
///   1. 渲染 WorkflowListScreen。
///   2. 查找空状态文案。
///
/// 预期结果：
///   - 正断言：显示 No workflows yet。
///   - 负断言：不显示任何 workflow 名称。
test('renders empty state when no workflows', () => {
  const { getByText, queryByText } = render(
    <WorkflowListScreen
      workflows={[]}
      hasEndpoints
      onCreateWorkflow={() => {}}
      onToggleEnabled={() => {}}
      onOpenWorkflow={() => {}}
    />,
  );

  expect(getByText('No workflows yet')).toBeTruthy();
  expect(queryByText('Morning Report')).toBeNull();
});

/// 场景：workflow 行显示名称、agent endpoint、next run 和 ON/OFF 开关。
///
/// 数据构造：
///   workflow = wf-1 enabled daily 09:15 from Office Mac。
///
/// 执行过程：
///   1. 渲染 WorkflowListScreen 含一个 workflow。
///   2. 查找行内容。
///
/// 预期结果：
///   - 正断言：显示 Morning Report。
///   - 正断言：显示 Office Mac。
///   - 负断言：不显示 running/completed 等运行状态标签（workflow 只显示 ON/OFF）。
test('renders workflow row with name, endpoint, and no runtime status', () => {
  const { getByText, queryByText } = render(
    <WorkflowListScreen
      workflows={[baseWorkflow]}
      hasEndpoints
      onCreateWorkflow={() => {}}
      onToggleEnabled={() => {}}
      onOpenWorkflow={() => {}}
    />,
  );

  expect(getByText('Morning Report')).toBeTruthy();
  expect(getByText(/Office Mac/)).toBeTruthy();
  expect(queryByText('running')).toBeNull();
  expect(queryByText('completed')).toBeNull();
});

/// 场景：点击开关调用 onToggleEnabled 回调。
///
/// 数据构造：
///   workflow = wf-1 enabled。
///
/// 执行过程：
///   1. 渲染 WorkflowListScreen。
///   2. 点击 ON/OFF 开关。
///
/// 预期结果：
///   - 正断言：onToggleEnabled 被调用，参数为 wf-1 和 false（关闭）。
test('tapping switch calls onToggleEnabled with workflow id and new state', () => {
  const onToggle = jest.fn();
  const { getByTestId } = render(
    <WorkflowListScreen
      workflows={[baseWorkflow]}
      hasEndpoints
      onCreateWorkflow={() => {}}
      onToggleEnabled={onToggle}
      onOpenWorkflow={() => {}}
    />,
  );

  fireEvent(getByTestId('workflow-toggle-wf-1'), 'valueChange', false);

  expect(onToggle).toHaveBeenCalledWith('wf-1', false, 'ep-1');
});

/// 场景：左滑露出的删除按钮调用 onDeleteWorkflow 回调。
///
/// 数据构造：
///   workflow = wf-1 enabled daily 09:15 from Office Mac。
///   mocked Swipeable = 直接渲染 renderRightActions()，等价于用户左滑后露出删除按钮。
///
/// 执行过程：
///   1. 渲染 WorkflowListScreen 含一个 workflow。
///   2. 点击 mocked Swipeable 渲染出的删除按钮。
///   3. 检查 onDeleteWorkflow 收到的 workflow。
///
/// 预期结果：
///   - 正断言：onDeleteWorkflow 被调用一次且参数为 wf-1。
///   - 负断言：onToggleEnabled 不应被调用，删除动作不能误触 ON/OFF。
test('pressing delete action calls onDeleteWorkflow without toggling', () => {
  const onDelete = jest.fn();
  const onToggle = jest.fn();
  const { getByText } = render(
    <WorkflowListScreen
      workflows={[baseWorkflow]}
      hasEndpoints
      onCreateWorkflow={() => {}}
      onToggleEnabled={onToggle}
      onOpenWorkflow={() => {}}
      onDeleteWorkflow={onDelete}
    />,
  );

  fireEvent.press(getByText('DELETE'));

  expect({
    actual: onDelete.mock.calls.length,
    reason: 'delete action should invoke onDeleteWorkflow exactly once',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: onDelete.mock.calls[0][0].id,
    reason: 'delete action should pass the workflow row being swiped',
  }).toEqual({ actual: 'wf-1', reason: expect.any(String) });
  expect({
    actual: onToggle.mock.calls.length,
    reason: 'delete action should not toggle workflow enabled state',
  }).toEqual({ actual: 0, reason: expect.any(String) });
});

/// 场景：左滑露出的编辑按钮调用 onEditWorkflow 回调。
///
/// 数据构造：
///   workflow = wf-1 enabled daily 09:15 from Office Mac。
///   mocked Swipeable = 直接渲染 renderRightActions()，等价于用户左滑后露出编辑按钮。
///
/// 执行过程：
///   1. 渲染 WorkflowListScreen 含一个 workflow。
///   2. 点击 mocked Swipeable 渲染出的编辑按钮。
///   3. 检查 onEditWorkflow 收到的 workflow。
///
/// 预期结果：
///   - 正断言：onEditWorkflow 被调用一次且参数为 wf-1。
///   - 负断言：onDeleteWorkflow 不应被调用，编辑动作不能误删 workflow。
test('pressing edit action calls onEditWorkflow without deleting', () => {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const { getByText } = render(
    <WorkflowListScreen
      workflows={[baseWorkflow]}
      hasEndpoints
      onCreateWorkflow={() => {}}
      onToggleEnabled={() => {}}
      onOpenWorkflow={() => {}}
      onEditWorkflow={onEdit}
      onDeleteWorkflow={onDelete}
    />,
  );

  fireEvent.press(getByText('EDIT'));

  expect({
    actual: onEdit.mock.calls.length,
    reason: 'edit action should invoke onEditWorkflow exactly once',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: onEdit.mock.calls[0][0].id,
    reason: 'edit action should pass the workflow row being swiped',
  }).toEqual({ actual: 'wf-1', reason: expect.any(String) });
  expect({
    actual: onDelete.mock.calls.length,
    reason: 'edit action should not delete workflow data',
  }).toEqual({ actual: 0, reason: expect.any(String) });
});
