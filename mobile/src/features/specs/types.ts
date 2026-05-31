import { type Agent } from '@/types';

export type SpecStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'dispatching'
  | 'dispatched'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed';

export interface SpecQuestion {
  id: string;
  text: string;
  options: Array<{ id: string; label: string }>;
  multiSelect?: boolean;
  allowsOther?: boolean;
}

export interface SpecQuestionRound {
  id: string;
  questions: SpecQuestion[];
  createdAt: number;
}

export interface SpecAnswer {
  questionId: string;
  value: string | string[];
  answeredAt: number;
}

export interface SpecDraft {
  id: string;
  title: string;
  slug: string;
  status: SpecStatus;
  targetAgentId: string;
  targetEndpointId: string;
  targetRepoPath: string;
  targetAgentName: string;
  targetRuntime: Agent['runtime'];
  questions: SpecQuestionRound[];
  answers: SpecAnswer[];
  markdownPreview?: string;
  repoSpecPath?: string;
  linkedConversationId?: string;
  linkedActivityItemId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSpecInput {
  title: string;
  targetAgent: Agent;
}

export interface DispatchSpecResult {
  conversation_id: string;
  repo_spec_path: string;
}
