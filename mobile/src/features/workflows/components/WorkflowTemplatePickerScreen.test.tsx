import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { WORKFLOW_TEMPLATES } from '../templates';
import { WorkflowTemplatePickerScreen } from './WorkflowTemplatePickerScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/// 场景：picker 顶部展示 Blank Workflow 一等入口。
///
/// 数据构造：
///   WORKFLOW_TEMPLATES = 真实内置模板列表。
///
/// 执行过程：
///   1. 渲染 WorkflowTemplatePickerScreen。
///   2. 查找 Blank Workflow 入口。
///
/// 预期结果：
///   - 正断言：Blank Workflow 可见。
///   - 正断言：默认推荐 schedule 可见。
test('renders Blank Workflow as the first-class entry', () => {
  const { getByText } = render(
    <WorkflowTemplatePickerScreen
      onSelectBlank={() => {}}
      onSelectTemplate={() => {}}
      onCancel={() => {}}
    />,
  );

  expect(getByText('Blank Workflow')).toBeTruthy();
  expect(getByText('Default: Daily 09:00')).toBeTruthy();
});

/// 场景：picker 渲染模板库中的全部模板。
///
/// 数据构造：
///   WORKFLOW_TEMPLATES = 10 个真实内置模板。
///
/// 执行过程：
///   1. 渲染 WorkflowTemplatePickerScreen。
///   2. 逐个查找模板标题和描述。
///
/// 预期结果：
///   - 正断言：10 个模板标题全部显示。
///   - 正断言：10 个模板描述全部显示。
test('renders all 10 workflow templates', () => {
  const { getByText } = render(
    <WorkflowTemplatePickerScreen
      onSelectBlank={() => {}}
      onSelectTemplate={() => {}}
      onCancel={() => {}}
    />,
  );

  expect(WORKFLOW_TEMPLATES).toHaveLength(10);

  for (const template of WORKFLOW_TEMPLATES) {
    expect(getByText(template.title)).toBeTruthy();
    expect(getByText(template.description)).toBeTruthy();
  }
});

/// 场景：模板卡片展示行为边界文案和由 initial_values 推导的推荐 schedule。
///
/// 数据构造：
///   项目周报 = weekly, day_of_week 5, time_of_day 17:00。
///
/// 执行过程：
///   1. 渲染 WorkflowTemplatePickerScreen。
///   2. 查找 boundary label、boundary description 和 schedule chip。
///
/// 预期结果：
///   - 正断言：显示 boundary_label。
///   - 正断言：显示 boundary_description。
///   - 正断言：weekly schedule 显示为 Weekly Fri 17:00。
test('renders boundary copy and recommended schedule for templates', () => {
  const { getAllByText, getByText } = render(
    <WorkflowTemplatePickerScreen
      onSelectBlank={() => {}}
      onSelectTemplate={() => {}}
      onCancel={() => {}}
    />,
  );

  expect(getAllByText('只读汇报').length).toBeGreaterThan(0);
  expect(getAllByText('只检查并总结，不修改文件').length).toBeGreaterThan(0);
  expect(getByText('Weekly Fri 17:00')).toBeTruthy();
});

/// 场景：点击 Blank Workflow 进入空白创建流程。
///
/// 数据构造：
///   onSelectBlank = jest.fn()。
///
/// 执行过程：
///   1. 渲染 WorkflowTemplatePickerScreen。
///   2. 点击 Blank Workflow 入口。
///
/// 预期结果：
///   - 正断言：onSelectBlank 被调用一次。
///   - 负断言：onSelectTemplate 不被调用。
test('pressing Blank Workflow calls onSelectBlank', () => {
  const onSelectBlank = jest.fn();
  const onSelectTemplate = jest.fn();
  const { getByTestId } = render(
    <WorkflowTemplatePickerScreen
      onSelectBlank={onSelectBlank}
      onSelectTemplate={onSelectTemplate}
      onCancel={() => {}}
    />,
  );

  fireEvent.press(getByTestId('workflow-template-blank'));

  expect(onSelectBlank).toHaveBeenCalledTimes(1);
  expect(onSelectTemplate).not.toHaveBeenCalled();
});

/// 场景：点击模板卡片进入模板创建流程。
///
/// 数据构造：
///   选择 CI 失败排查。
///
/// 执行过程：
///   1. 渲染 WorkflowTemplatePickerScreen。
///   2. 点击 CI 失败排查卡片。
///
/// 预期结果：
///   - 正断言：onSelectTemplate 收到该模板。
///   - 负断言：onSelectBlank 不被调用。
test('pressing a template calls onSelectTemplate with that template', () => {
  const onSelectBlank = jest.fn();
  const onSelectTemplate = jest.fn();
  const selectedTemplate = WORKFLOW_TEMPLATES[3];

  const { getByTestId } = render(
    <WorkflowTemplatePickerScreen
      onSelectBlank={onSelectBlank}
      onSelectTemplate={onSelectTemplate}
      onCancel={() => {}}
    />,
  );

  fireEvent.press(getByTestId(`workflow-template-${selectedTemplate.id}`));

  expect(onSelectTemplate).toHaveBeenCalledWith(selectedTemplate);
  expect(onSelectBlank).not.toHaveBeenCalled();
});
