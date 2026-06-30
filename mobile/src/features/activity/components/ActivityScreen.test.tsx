import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import ActivityScreen, { type ActivityItem } from './ActivityScreen';
import { activityScreenStyles } from './activityScreenStyles';

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

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'done-1',
    section: 'done',
    projectName: 'Deploy Project',
    title: 'Morning Report',
    subtitle: 'Summarize repo state',
    statusLabel: 'Done',
    tone: 'done',
    timestamp: Date.now(),
    endpointId: 'ep-1',
    endpointLabel: 'Office Mac',
    conversationId: 'conv-1',
    agentId: 'agent-1',
    agentName: 'Deploy Project',
    resourceId: 'agent-1',
    resourceName: 'Deploy Project',
    readAt: 1,
    ...overrides,
  };
}

/// 场景：Activity 行含 workflowName 时，subtitle 区域显示 workflow 名称作为上下文元数据。
///
/// 数据构造：
///   item.workflowName = 'Morning Report Workflow'
///   item.subtitle = 'Summarize repo state'
///   item.projectName = 'Deploy Project'
///
/// 执行过程：
///   1. 渲染 ActivityScreen，done 列表含一个 workflow 行。
///   2. 查找 subtitle 文本。
///
/// 预期结果：
///   - 正断言：subtitle 区域包含 workflowName。
///   - 正断言：subtitle 区域包含原始 subtitle 文本。
///   - 负断言：行结构不变（title 仍然存在）。
test('activity row with workflowName shows it in subtitle metadata', () => {
  const workflowItem = item({
    workflowName: 'Morning Report Workflow',
    workflowId: 'wf-1',
    workflowRunId: 'run-1',
  });

  const { getByText } = render(
    <ActivityScreen needsAttention={[]} running={[]} done={[workflowItem]} onOpenItem={() => {}} />,
  );

  expect(getByText('Morning Report')).toBeTruthy();
  expect(getByText(/Morning Report Workflow/)).toBeTruthy();
  expect(getByText(/Summarize repo state/)).toBeTruthy();
});

/// 场景：Activity 行不含 workflowName 时，subtitle 区域不显示 workflow 元数据。
///
/// 数据构造：
///   item.workflowName = undefined
///
/// 执行过程：
///   1. 渲染 ActivityScreen，done 列表含一个普通行。
///   2. 查找 subtitle 文本。
///
/// 预期结果：
///   - 正断言：subtitle 区域包含原始 subtitle 文本。
///   - 负断言：不显示任何 workflow 相关文本。
test('done sub-filter header keeps 12px spacing before the first card', () => {
  const { getByLabelText, getByTestId } = render(
    <ActivityScreen needsAttention={[]} running={[]} done={[item()]} onOpenItem={() => {}} />,
  );

  fireEvent.press(getByLabelText('Show Done activity, 1 item'));

  const headerStyle = StyleSheet.flatten(getByTestId('activity-done-header').props.style);
  expect(headerStyle.marginBottom).toBe(activityScreenStyles.doneHeader.marginBottom);
  expect(headerStyle.marginBottom).toBe(12);
});

test('activity row without workflowName shows normal subtitle', () => {
  const normalItem = item({ workflowName: undefined });

  const { getByText, queryByText } = render(
    <ActivityScreen needsAttention={[]} running={[]} done={[normalItem]} onOpenItem={() => {}} />,
  );

  expect(getByText(/Summarize repo state/)).toBeTruthy();
  expect(queryByText(/Workflow/)).toBeNull();
});
