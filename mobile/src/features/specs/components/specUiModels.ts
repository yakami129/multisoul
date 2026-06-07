import { type SpecDraft } from '../types';

export type IdeaStatus = 'open' | 'interviewing' | 'converted' | 'archived' | 'failed';
export type SpecAssetStatus =
  | 'draft'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'blocked'
  | 'done'
  | 'failed';

export interface SpecIdeaNote {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpecIdeaAttachment {
  id: string;
  kind: 'link' | 'log' | 'image';
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
  targetAgentId?: string;
  targetEndpointId?: string;
  targetRepoPath?: string;
  targetAgentName?: string;
  body: string;
  notes: SpecIdeaNote[];
  attachments: SpecIdeaAttachment[];
  interviewConversationId?: string;
  convertedSpecId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
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

export interface SpecArtifact {
  id: string;
  title: string;
  slug: string;
  status: SpecAssetStatus;
  targetAgentId?: string;
  targetEndpointId?: string;
  targetRepoPath: string;
  targetAgentName?: string;
  repoSpecPath: string;
  latestVersionId: string;
  latestVersion?: SpecArtifactVersion;
  sourceIdeaId?: string;
  sourceIdeaTitle?: string;
  interviewConversationId?: string;
  latestImplementationConversationId?: string;
  linkedActivityItemId?: string;
  statusSummary?: string;
  endpointOffline?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SpecTarget {
  endpointId: string;
  endpointLabel: string;
  agentId: string;
  agentName: string;
  repoPath: string;
}

export function relativeAge(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function shortHash(hash?: string): string {
  return hash ? hash.slice(0, 8) : 'pending';
}

export function deriveIdeaTitle(title: string | undefined, body: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit;
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : 'Untitled idea';
}

export function ideaStatusLabel(status: IdeaStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'interviewing':
      return 'Interviewing';
    case 'converted':
      return 'Spec Saved';
    case 'archived':
      return 'Archived';
    case 'failed':
      return 'Failed';
  }
}

export function specStatusLabel(status: SpecAssetStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ready':
      return 'Ready';
    case 'planning':
      return 'Planning';
    case 'implementing':
      return 'Running';
    case 'blocked':
      return 'Needs You';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

export function specActionLabel(status: SpecAssetStatus): string {
  switch (status) {
    case 'blocked':
      return 'Answer Required';
    case 'planning':
    case 'implementing':
      return 'Open Implementation Chat';
    case 'done':
      return 'Open Summary';
    case 'draft':
      return 'Review Spec';
    case 'failed':
      return 'Review Failure';
    case 'ready':
      return 'Start Implementation';
  }
}

export function summarizeMarkdown(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const h1 = lines.find((line) => line.startsWith('# '));
  const bullets = lines.filter((line) => /^[-*]\s+/.test(line)).slice(0, 3);
  const prose = lines.filter((line) => !line.startsWith('#') && !/^[-*]\s+/.test(line)).slice(0, 2);
  return [h1, ...prose, ...bullets].filter(Boolean).join('\n');
}

function legacyStatusToIdea(status: SpecDraft['status']): IdeaStatus {
  if (status === 'failed') return 'failed';
  if (status === 'dispatched' || status === 'running' || status === 'done') return 'converted';
  if (status === 'review' || status === 'approved' || status === 'dispatching')
    return 'interviewing';
  return 'open';
}

function legacyStatusToSpec(status: SpecDraft['status']): SpecAssetStatus {
  switch (status) {
    case 'running':
      return 'implementing';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    case 'dispatching':
      return 'planning';
    case 'dispatched':
      return 'ready';
    case 'approved':
    case 'review':
      return 'ready';
    case 'draft':
      return 'draft';
  }
}

export function specDraftToIdea(spec: SpecDraft): SpecIdea {
  return {
    id: spec.id,
    title: spec.title,
    status: legacyStatusToIdea(spec.status),
    targetAgentId: spec.targetAgentId,
    targetEndpointId: spec.targetEndpointId,
    targetRepoPath: spec.targetRepoPath,
    targetAgentName: spec.targetAgentName,
    body: spec.markdownPreview ?? spec.title,
    notes: [],
    attachments: [],
    interviewConversationId: spec.linkedConversationId,
    convertedSpecId: spec.repoSpecPath ? spec.id : undefined,
    errorMessage: spec.errorMessage,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    archivedAt: legacyStatusToIdea(spec.status) === 'converted' ? spec.updatedAt : undefined,
  };
}

export function specDraftToArtifact(spec: SpecDraft): SpecArtifact {
  const markdown =
    spec.markdownPreview ?? `# ${spec.title}\n\nSpec artifact has not been saved yet.`;
  const repoSpecPath = spec.repoSpecPath ?? `docs/product-specs/${spec.slug}.md`;
  const version: SpecArtifactVersion = {
    id: `${spec.id}-v1`,
    specId: spec.id,
    revision: 1,
    repoSpecPath,
    markdown,
    markdownSha256: spec.repoSpecPath ? 'saved' : '',
    sourceConversationId: spec.linkedConversationId ?? '',
    createdAt: spec.updatedAt,
  };
  return {
    id: spec.id,
    title: spec.title,
    slug: spec.slug,
    status: legacyStatusToSpec(spec.status),
    targetAgentId: spec.targetAgentId,
    targetEndpointId: spec.targetEndpointId,
    targetRepoPath: spec.targetRepoPath,
    targetAgentName: spec.targetAgentName,
    repoSpecPath,
    latestVersionId: version.id,
    latestVersion: version,
    interviewConversationId: spec.linkedConversationId,
    linkedActivityItemId: spec.linkedActivityItemId,
    statusSummary: spec.errorMessage ?? undefined,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
  };
}
