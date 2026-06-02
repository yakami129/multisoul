import { type Endpoint } from '@/types';

export type WorkflowScheduleKind = 'daily' | 'weekly';
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'skipped_overlap';

export interface Workflow {
  id: string;
  name: string;
  agent_id: string;
  prompt: string;
  enabled: boolean;
  schedule_kind: WorkflowScheduleKind;
  time_of_day: string;
  day_of_week?: number | null;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  endpoint_id: string;
  endpoint_label: string;
}

export interface WorkflowInput {
  name: string;
  agent_id: string;
  prompt: string;
  schedule_kind: WorkflowScheduleKind;
  time_of_day: string;
  day_of_week?: number | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  conversation_id: string | null;
  status: WorkflowRunStatus;
  scheduled_for: number;
  started_at: number | null;
  ended_at: number | null;
  summary: string | null;
  error_message: string | null;
  created_at: number;
  endpoint_id: string;
  endpoint_label: string;
}

export type WorkflowEndpoint = Pick<Endpoint, 'id' | 'label' | 'base_url' | 'token'>;
