import { type Agent, type Conversation } from '@/types';

export type ProjectSessionStatus = Conversation['status'];

export interface ProjectSessionCounts {
  idle: number;
  running: number;
  awaiting_question: number;
  completed: number;
  failed: number;
}

export interface Project {
  id: string;
  name: string;
  project_path: string;
  normalized_project_path: string;
  default_resource_id: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  session_counts: ProjectSessionCounts;
  resource_count: number;
  endpoint_id: string;
  endpoint_label: string;
}

export type ProjectSession = Conversation & {
  project_id: string | null;
};

export type ProjectResource = Agent & {
  project_id: string;
  is_default: boolean;
};

export interface EndpointInput {
  id: string;
  label: string;
  base_url: string;
  token: string;
}
