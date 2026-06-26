import { type Endpoint } from '@/types';

export type WorkflowScheduleKind = 'daily' | 'weekly';
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'skipped_overlap';
export type WorkflowMode = 'recurring' | 'watch';
export type WatchStatus = 'active' | 'completed' | 'stopped' | 'expired' | 'failed';

export interface Workflow {
  id: string;
  name: string;
  agent_id: string;
  project_id?: string | null;
  project_name?: string | null;
  project_path?: string | null;
  resource_id: string;
  resource_name: string;
  prompt: string;
  enabled: boolean;
  mode: WorkflowMode;
  // recurring fields
  schedule_kind: WorkflowScheduleKind | null;
  time_of_day: string | null;
  day_of_week?: number | null;
  // watch fields
  interval_minutes: number | null;
  max_runs: number | null;
  expires_at: number | null;
  stop_condition: string | null;
  watch_status: WatchStatus | null;
  run_count: number;
  // common
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
  project_id?: string | null;
  resource_id?: string | null;
  prompt: string;
  mode: WorkflowMode;
  // recurring fields
  schedule_kind?: WorkflowScheduleKind;
  time_of_day?: string;
  day_of_week?: number | null;
  // watch fields
  interval_minutes?: number;
  max_runs?: number | null;
  expires_at?: number | null;
  stop_condition?: string;
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
  run_number: number | null;
  stop_condition_satisfied: boolean | null;
  stop_condition_reason: string | null;
  endpoint_id: string;
  endpoint_label: string;
}

export type WorkflowEndpoint = Pick<Endpoint, 'id' | 'label' | 'base_url' | 'token'>;
