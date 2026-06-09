import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import WorkflowsTab from './workflows';
import { WORKFLOW_TEMPLATES } from '../../src/features/workflows/templates';

const mockPush = jest.fn();
const mockFetchAllAgents = jest.fn();
const mockFetchWorkflows = jest.fn();
const mockCreateWorkflow = jest.fn();
const mockDeleteWorkflow = jest.fn();
const mockDisableWorkflow = jest.fn();
const mockEnableWorkflow = jest.fn();
const mockUpdateWorkflow = jest.fn();

const endpoint = {
  id: 'ep-1',
  label: 'Office Mac',
  base_url: 'http://localhost:8765',
  token: 'token-1',
};

const agent = {
  id: 'agent-1',
  name: 'MultiSoul Agent',
  project_path: '/repo/multisoul',
  runtime: 'claude-code',
  created_at: 1_779_000_000_000,
  endpoint_id: endpoint.id,
  endpoint_label: endpoint.label,
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../src/store/endpointStore', () => ({
  useEndpointStore: (selector: any) =>
    selector({
      endpoints: [endpoint],
    }),
}));

jest.mock('../../src/features/agents/services/agentService', () => ({
  fetchAllAgents: (...args: unknown[]) => mockFetchAllAgents(...args),
}));

jest.mock('../../src/features/workflows/services/workflowService', () => ({
  createWorkflow: (...args: unknown[]) => mockCreateWorkflow(...args),
  deleteWorkflow: (...args: unknown[]) => mockDeleteWorkflow(...args),
  disableWorkflow: (...args: unknown[]) => mockDisableWorkflow(...args),
  enableWorkflow: (...args: unknown[]) => mockEnableWorkflow(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  updateWorkflow: (...args: unknown[]) => mockUpdateWorkflow(...args),
  stopWatch: jest.fn().mockResolvedValue({}),
  restartWatch: jest.fn().mockResolvedValue({}),
}));

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

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowsTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockCreateWorkflow.mockClear();
  mockDeleteWorkflow.mockClear();
  mockDisableWorkflow.mockClear();
  mockEnableWorkflow.mockClear();
  mockUpdateWorkflow.mockClear();
  mockFetchAllAgents.mockResolvedValue([agent]);
  mockFetchWorkflows.mockResolvedValue([]);
  mockCreateWorkflow.mockResolvedValue({});
  mockDeleteWorkflow.mockResolvedValue({});
  mockDisableWorkflow.mockResolvedValue({});
  mockEnableWorkflow.mockResolvedValue({});
  mockUpdateWorkflow.mockResolvedValue({});
});

function selectAgent(
  queries: Pick<ReturnType<typeof renderScreen>, 'getByLabelText' | 'getByText'>,
  agentName = 'MultiSoul Agent',
) {
  fireEvent.press(queries.getByLabelText('Agent'));
  fireEvent.press(queries.getByText(agentName));
  fireEvent.press(queries.getByText('Done'));
}

/// 场景：用户不使用模板，从 Blank Workflow 创建。
///
/// 数据构造：
///   endpoint = Office Mac，agents = [MultiSoul Agent]，workflows = []。
///
/// 执行过程：
///   1. 点击 Workflow list 的 +。
///   2. 点击 Blank Workflow。
///   3. 填写 name 和 prompt。
///   4. 保存。
///
/// 预期结果：
///   - 正断言：createWorkflow 收到普通 WorkflowInput。
///   - 负断言：payload 不包含模板来源字段。
test('blank workflow creation goes through the existing create payload', async () => {
  const { getByLabelText, getByPlaceholderText, getByTestId, getByText } = renderScreen();

  fireEvent.press(getByLabelText('New Workflow'));
  fireEvent.press(getByTestId('workflow-template-blank'));

  await waitFor(() => expect(getByPlaceholderText('e.g. CI Watch')).toBeTruthy());
  await waitFor(() => expect(getByLabelText('Agent')).toBeTruthy());

  fireEvent.changeText(getByPlaceholderText('e.g. CI Watch'), 'Custom Morning Run');
  fireEvent.changeText(getByPlaceholderText('What should the agent do?'), 'Summarize repo');
  selectAgent({ getByLabelText, getByText });
  fireEvent.press(getByText('Save'));

  await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));

  const payload = mockCreateWorkflow.mock.calls[0][1];
  expect(payload).toEqual({
    name: 'Custom Morning Run',
    agent_id: 'agent-1',
    prompt: 'Summarize repo',
    mode: 'recurring',
    schedule_kind: 'daily',
    time_of_day: '09:00',
    day_of_week: null,
  });
  expect(payload.template_id).toBeUndefined();
  expect(payload.boundary).toBeUndefined();
  expect(payload.category).toBeUndefined();
});

/// 场景：用户选择内置模板创建 workflow。
///
/// 数据构造：
///   template = CI 失败排查，initial_values 来自内置模板。
///
/// 执行过程：
///   1. 点击 Workflow list 的 +。
///   2. 点击 CI 失败排查模板。
///   3. 保存预填表单。
///
/// 预期结果：
///   - 正断言：表单预填模板名称和 prompt。
///   - 正断言：createWorkflow payload 是模板 initial_values + agent_id。
///   - 负断言：payload 不包含模板元数据。
test('template workflow creation pre-fills form but saves plain workflow input', async () => {
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'ci-failure-triage');
  if (!template) throw new Error('test template must exist');

  const { getByDisplayValue, getByLabelText, getByTestId, getByText } = renderScreen();

  fireEvent.press(getByLabelText('New Workflow'));
  fireEvent.press(getByTestId(`workflow-template-${template.id}`));

  await waitFor(() => expect(getByDisplayValue(template.initial_values.name)).toBeTruthy());
  await waitFor(() => expect(getByLabelText('Agent')).toBeTruthy());
  expect(getByDisplayValue(template.initial_values.prompt)).toBeTruthy();

  selectAgent({ getByLabelText, getByText });
  fireEvent.press(getByText('Save'));

  await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));

  const payload = mockCreateWorkflow.mock.calls[0][1];
  expect(payload).toEqual({
    ...template.initial_values,
    agent_id: 'agent-1',
  });
  expect(payload.template_id).toBeUndefined();
  expect(payload.boundary).toBeUndefined();
  expect(payload.category).toBeUndefined();
});
