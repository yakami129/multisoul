import { type Agent } from '@/types';

export type IdeaStatus = 'open' | 'interviewing' | 'converted' | 'archived' | 'failed';

export type SpecAssetStatus =
  | 'draft'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'blocked'
  | 'done'
  | 'failed';

export type LegacySpecStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'dispatching'
  | 'dispatched'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed';

export type SpecStatus = SpecAssetStatus | LegacySpecStatus;

export type SpecIdeaAttachmentKind = 'link' | 'log' | 'image';

export type SpecIdeaPendingMutation = 'create' | 'update' | 'archive';

export interface SpecIdeaNote {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpecIdeaAttachment {
  id: string;
  kind: SpecIdeaAttachmentKind;
  title?: string;
  uri?: string;
  text?: string;
  fileId?: string;
  createdAt: number;
}

export interface SpecIdea {
  id: string;
  title: string;
  status: IdeaStatus;
  targetAgentId: string;
  targetEndpointId: string;
  targetRepoPath: string;
  targetAgentName: string;
  body: string;
  notes: SpecIdeaNote[];
  attachments: SpecIdeaAttachment[];
  interviewConversationId?: string;
  convertedSpecId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  pendingMutation?: SpecIdeaPendingMutation;
  lastSyncError?: string;
}

export interface SpecArtifact {
  id: string;
  title: string;
  slug: string;
  status: SpecAssetStatus;
  targetAgentId: string;
  targetEndpointId: string;
  targetRepoPath: string;
  repoSpecPath: string;
  latestVersionId: string;
  latestVersion?: SpecArtifactVersion;
  sourceIdeaId?: string;
  interviewConversationId: string;
  latestImplementationConversationId?: string;
  linkedActivityItemId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpecArtifactVersion {
  id: string;
  specId: string;
  revision: number;
  repoSpecPath: string;
  markdown: string;
  markdownSha256: string;
  sourceConversationId: string;
  createdAt: number;
}

export interface SpecArtifactDetail {
  spec: SpecArtifact;
  latestVersion?: SpecArtifactVersion;
  versions: SpecArtifactVersion[];
}

export interface SpecIdeaTargetInput {
  targetAgentId?: string;
  targetEndpointId?: string;
  targetRepoPath?: string;
  targetAgentName?: string;
}

export interface CreateSpecIdeaInput extends SpecIdeaTargetInput {
  title?: string;
  body: string;
  notes?: SpecIdeaNote[];
  attachments?: SpecIdeaAttachment[];
  targetAgent?: Agent;
}

export interface UpdateSpecIdeaInput extends SpecIdeaTargetInput {
  title?: string;
  body?: string;
  status?: IdeaStatus;
  notes?: SpecIdeaNote[];
  attachments?: SpecIdeaAttachment[];
  interviewConversationId?: string;
  convertedSpecId?: string;
  errorMessage?: string;
  archivedAt?: number | null;
  targetAgent?: Agent;
}

export interface StartSpecIdeaInterviewResult {
  idea?: SpecIdea;
  conversationId: string;
}

export interface StartSpecImplementationResult {
  spec?: SpecArtifact;
  conversationId: string;
}

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
  status: LegacySpecStatus;
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
