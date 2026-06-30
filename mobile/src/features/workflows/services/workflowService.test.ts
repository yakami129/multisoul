import { getEndpointClient } from '@/api/endpointClient';
import {
  createWorkflow,
  disableWorkflow,
  enableWorkflow,
  fetchWorkflowRuns,
  fetchWorkflows,
  updateWorkflow,
} from './workflowService';
import { type WorkflowEndpoint, type WorkflowInput } from '../types';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet, post: mockPost, patch: mockPatch })),
}));

const endpoint: WorkflowEndpoint = {
  id: 'ep-1',
  label: 'Office Mac',
  base_url: 'http://office.local:8765',
  token: 'tok-office',
};

const workflowRaw = {
  id: 'wf-1',
  name: 'Morning report',
  agent_id: 'agent-1',
  project_id: 'project-1',
  project_name: 'MultiSoul',
  project_path: '/repo/multisoul',
  resource_id: 'agent-1',
  resource_name: 'Codex Runtime',
  prompt: 'Summarize repository state',
  enabled: true,
  schedule_kind: 'daily' as const,
  time_of_day: '09:15',
  day_of_week: null,
  next_run_at: 1_780_000_000_000,
  last_run_at: null,
  created_at: 1_779_000_000_000,
  updated_at: 1_779_000_000_000,
};

const workflowInput: WorkflowInput = {
  name: 'Morning report',
  agent_id: 'agent-1',
  project_id: 'project-1',
  resource_id: 'agent-1',
  prompt: 'Summarize repository state',
  schedule_kind: 'daily',
  time_of_day: '09:15',
  day_of_week: null,
};

describe('workflowService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /// Workflow list fetch: service calls the authenticated endpoint and injects endpoint context.
  ///
  /// Data construction:
  ///   endpoint = ep-1 / Office Mac / http://office.local:8765 / tok-office
  ///   API row  = wf-1 enabled daily workflow
  ///
  /// Execution process:
  ///   1. Mock GET /api/v1/workflows to return wf-1.
  ///   2. Call fetchWorkflows(endpoint).
  ///   3. Inspect client construction, path, and transformed row.
  ///
  /// Expected results:
  ///   - Positive: endpoint client receives the endpoint URL and token.
  ///   - Positive: service calls GET /api/v1/workflows.
  ///   - Positive: returned workflow includes endpoint_id and endpoint_label.
  ///   - Negative: returned workflow does not invent a status field; enabled remains the workflow state.
  it('fetches workflows and injects endpoint context', async () => {
    mockGet.mockResolvedValueOnce({ data: [workflowRaw] });

    const result = await fetchWorkflows(endpoint);

    expect(getEndpointClient).toHaveBeenCalledWith('http://office.local:8765', 'tok-office');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workflows');
    expect(result[0]).toMatchObject({
      id: 'wf-1',
      enabled: true,
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    });
    expect(Object.prototype.hasOwnProperty.call(result[0], 'status')).toBe(
      false,
      'workflow rows should expose enabled, not a running/completed status',
    );
  });

  /// Workflow create/update mutations use the CLI workflow endpoints.
  ///
  /// Data construction:
  ///   input = valid daily workflow payload
  ///   create response = wf-1
  ///   update response = wf-1 with same shape
  ///
  /// Execution process:
  ///   1. Mock POST /api/v1/workflows.
  ///   2. Mock PATCH /api/v1/workflows/wf-1.
  ///   3. Inspect call paths and payloads.
  ///
  /// Expected results:
  ///   - createWorkflow posts the input unchanged.
  ///   - updateWorkflow patches the workflow id path.
  ///   - Both returned rows include endpoint context.
  it('creates and updates workflows through the CLI API', async () => {
    mockPost.mockResolvedValueOnce({ data: workflowRaw });
    mockPatch.mockResolvedValueOnce({ data: workflowRaw });

    const created = await createWorkflow(endpoint, workflowInput);
    const updated = await updateWorkflow(endpoint, 'wf-1', workflowInput);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/workflows', workflowInput);
    expect(mockPatch).toHaveBeenCalledWith('/api/v1/workflows/wf-1', workflowInput);
    expect(created.endpoint_id).toBe('ep-1');
    expect(updated.endpoint_label).toBe('Office Mac');
  });

  /// Workflow enable/disable mutations target explicit ON/OFF endpoints.
  ///
  /// Data construction:
  ///   workflow id = wf-1
  ///   disable response = enabled false
  ///   enable response  = enabled true
  ///
  /// Execution process:
  ///   1. Call disableWorkflow(endpoint, wf-1).
  ///   2. Call enableWorkflow(endpoint, wf-1).
  ///   3. Inspect POST paths and transformed enabled values.
  ///
  /// Expected results:
  ///   - Disable uses /disable and returns enabled=false.
  ///   - Enable uses /enable and returns enabled=true.
  ///   - Mutations do not use PATCH status semantics.
  it('enables and disables workflows through explicit endpoints', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { ...workflowRaw, enabled: false, next_run_at: null } })
      .mockResolvedValueOnce({ data: workflowRaw });

    const disabled = await disableWorkflow(endpoint, 'wf-1');
    const enabled = await enableWorkflow(endpoint, 'wf-1');

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/v1/workflows/wf-1/disable', {});
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/v1/workflows/wf-1/enable', {});
    expect(disabled.enabled).toBe(false);
    expect(enabled.enabled).toBe(true);
  });

  /// Workflow run history fetch uses the workflow-specific run endpoint.
  ///
  /// Data construction:
  ///   workflow id = wf-1
  ///   run row     = completed run linked to conv-1
  ///
  /// Execution process:
  ///   1. Mock GET /api/v1/workflows/wf-1/runs.
  ///   2. Call fetchWorkflowRuns(endpoint, wf-1).
  ///   3. Inspect call path and endpoint metadata.
  ///
  /// Expected results:
  ///   - Positive: service calls the workflow run path.
  ///   - Positive: returned run preserves conversation_id.
  ///   - Positive: returned run includes endpoint context.
  it('fetches workflow run history', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'run-1',
          workflow_id: 'wf-1',
          conversation_id: 'conv-1',
          status: 'completed',
          scheduled_for: 1,
          started_at: 2,
          ended_at: 3,
          summary: 'Done',
          error_message: null,
          created_at: 1,
        },
      ],
    });

    const runs = await fetchWorkflowRuns(endpoint, 'wf-1');

    expect(mockGet).toHaveBeenCalledWith('/api/v1/workflows/wf-1/runs');
    expect(runs[0]).toMatchObject({
      conversation_id: 'conv-1',
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    });
  });
});
