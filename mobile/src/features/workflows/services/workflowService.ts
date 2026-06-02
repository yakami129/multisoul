import { getEndpointClient } from '@/api/endpointClient';
import {
  type Workflow,
  type WorkflowEndpoint,
  type WorkflowInput,
  type WorkflowRun,
} from '../types';

type WorkflowApiRow = Omit<Workflow, 'endpoint_id' | 'endpoint_label'>;
type WorkflowRunApiRow = Omit<WorkflowRun, 'endpoint_id' | 'endpoint_label'>;

function withWorkflowEndpoint(row: WorkflowApiRow, endpoint: WorkflowEndpoint): Workflow {
  return {
    ...row,
    endpoint_id: endpoint.id,
    endpoint_label: endpoint.label,
  };
}

function withWorkflowRunEndpoint(row: WorkflowRunApiRow, endpoint: WorkflowEndpoint): WorkflowRun {
  return {
    ...row,
    endpoint_id: endpoint.id,
    endpoint_label: endpoint.label,
  };
}

export async function fetchWorkflows(endpoint: WorkflowEndpoint): Promise<Workflow[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get<WorkflowApiRow[]>('/api/v1/workflows');
  return res.data.map((row) => withWorkflowEndpoint(row, endpoint));
}

export async function createWorkflow(
  endpoint: WorkflowEndpoint,
  input: WorkflowInput,
): Promise<Workflow> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post<WorkflowApiRow>('/api/v1/workflows', input);
  return withWorkflowEndpoint(res.data, endpoint);
}

export async function updateWorkflow(
  endpoint: WorkflowEndpoint,
  workflowId: string,
  input: WorkflowInput,
): Promise<Workflow> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.patch<WorkflowApiRow>(`/api/v1/workflows/${workflowId}`, input);
  return withWorkflowEndpoint(res.data, endpoint);
}

export async function disableWorkflow(
  endpoint: WorkflowEndpoint,
  workflowId: string,
): Promise<Workflow> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post<WorkflowApiRow>(`/api/v1/workflows/${workflowId}/disable`, {});
  return withWorkflowEndpoint(res.data, endpoint);
}

export async function enableWorkflow(
  endpoint: WorkflowEndpoint,
  workflowId: string,
): Promise<Workflow> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post<WorkflowApiRow>(`/api/v1/workflows/${workflowId}/enable`, {});
  return withWorkflowEndpoint(res.data, endpoint);
}

export async function fetchWorkflowRuns(
  endpoint: WorkflowEndpoint,
  workflowId: string,
): Promise<WorkflowRun[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get<WorkflowRunApiRow[]>(`/api/v1/workflows/${workflowId}/runs`);
  return res.data.map((row) => withWorkflowRunEndpoint(row, endpoint));
}

export async function deleteWorkflow(
  endpoint: WorkflowEndpoint,
  workflowId: string,
): Promise<void> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  await client.delete(`/api/v1/workflows/${workflowId}`);
}
