import { getEndpointClient } from '@/api/endpointClient';
import { type Endpoint } from '@/types';
import {
  type IdeaStatus,
  type SpecAssetStatus,
  type SpecArtifact,
  type SpecArtifactDetail,
  type SpecArtifactVersion,
  type SpecIdea,
  type SpecIdeaAttachment,
  type SpecIdeaNote,
  type StartSpecIdeaInterviewResult,
  type StartSpecImplementationResult,
  type UpdateSpecIdeaInput,
} from '../types';

type Raw = Record<string, unknown>;

function rawObject(value: unknown): Raw {
  return value && typeof value === 'object' ? (value as Raw) : {};
}

function field(raw: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  return undefined;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().length > 0 ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray<T>(value: unknown, mapper: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function ideaStatus(value: unknown): IdeaStatus {
  return ['open', 'interviewing', 'converted', 'archived', 'failed'].includes(String(value))
    ? (value as IdeaStatus)
    : 'open';
}

function specStatus(value: unknown): SpecAssetStatus {
  return ['draft', 'ready', 'planning', 'implementing', 'blocked', 'done', 'failed'].includes(
    String(value),
  )
    ? (value as SpecAssetStatus)
    : 'ready';
}

export function normalizeSpecIdeaNote(value: unknown): SpecIdeaNote {
  const raw = rawObject(value);
  return {
    id: asString(field(raw, 'id')),
    body: asString(field(raw, 'body')),
    createdAt: asNumber(field(raw, 'created_at', 'createdAt')),
    updatedAt: asNumber(field(raw, 'updated_at', 'updatedAt')),
  };
}

export function normalizeSpecIdeaAttachment(value: unknown): SpecIdeaAttachment {
  const raw = rawObject(value);
  const kind = asString(field(raw, 'kind'));
  return {
    id: asString(field(raw, 'id')),
    kind: kind === 'link' || kind === 'log' || kind === 'image' ? kind : 'log',
    title: asOptionalString(field(raw, 'title')),
    uri: asOptionalString(field(raw, 'uri')),
    text: asOptionalString(field(raw, 'text')),
    fileId: asOptionalString(field(raw, 'file_id', 'fileId')),
    createdAt: asNumber(field(raw, 'created_at', 'createdAt')),
  };
}

export function normalizeSpecIdea(value: unknown, endpointId = ''): SpecIdea {
  const raw = rawObject(value);
  return {
    id: asString(field(raw, 'id')),
    title: asString(field(raw, 'title')),
    status: ideaStatus(field(raw, 'status')),
    targetAgentId: asString(field(raw, 'target_agent_id', 'targetAgentId')),
    targetEndpointId: asString(field(raw, 'target_endpoint_id', 'targetEndpointId'), endpointId),
    targetRepoPath: asString(field(raw, 'target_repo_path', 'targetRepoPath')),
    targetAgentName: asString(field(raw, 'target_agent_name', 'targetAgentName')),
    body: asString(field(raw, 'body')),
    notes: asArray(field(raw, 'notes'), normalizeSpecIdeaNote),
    attachments: asArray(field(raw, 'attachments'), normalizeSpecIdeaAttachment),
    interviewConversationId: asOptionalString(
      field(raw, 'interview_conversation_id', 'interviewConversationId'),
    ),
    convertedSpecId: asOptionalString(field(raw, 'converted_spec_id', 'convertedSpecId')),
    errorMessage: asOptionalString(field(raw, 'error_message', 'errorMessage')),
    createdAt: asNumber(field(raw, 'created_at', 'createdAt')),
    updatedAt: asNumber(field(raw, 'updated_at', 'updatedAt')),
    archivedAt: asOptionalNumber(field(raw, 'archived_at', 'archivedAt')),
  };
}

export function normalizeSpecArtifact(value: unknown, endpointId = ''): SpecArtifact {
  const raw = rawObject(value);
  const latestVersionValue = field(raw, 'latest_version', 'latestVersion');
  return {
    id: asString(field(raw, 'id')),
    title: asString(field(raw, 'title')),
    slug: asString(field(raw, 'slug')),
    status: specStatus(field(raw, 'status')),
    targetAgentId: asString(field(raw, 'target_agent_id', 'targetAgentId')),
    targetEndpointId: asString(field(raw, 'target_endpoint_id', 'targetEndpointId'), endpointId),
    targetRepoPath: asString(field(raw, 'target_repo_path', 'targetRepoPath')),
    repoSpecPath: asString(field(raw, 'repo_spec_path', 'repoSpecPath')),
    latestVersionId: asString(field(raw, 'latest_version_id', 'latestVersionId')),
    latestVersion: latestVersionValue
      ? normalizeSpecArtifactVersion(latestVersionValue)
      : undefined,
    sourceIdeaId: asOptionalString(field(raw, 'source_idea_id', 'sourceIdeaId')),
    interviewConversationId: asString(
      field(raw, 'interview_conversation_id', 'interviewConversationId'),
    ),
    latestImplementationConversationId: asOptionalString(
      field(raw, 'latest_implementation_conversation_id', 'latestImplementationConversationId'),
    ),
    linkedActivityItemId: asOptionalString(
      field(raw, 'linked_activity_item_id', 'linkedActivityItemId'),
    ),
    createdAt: asNumber(field(raw, 'created_at', 'createdAt')),
    updatedAt: asNumber(field(raw, 'updated_at', 'updatedAt')),
  };
}

export function normalizeSpecArtifactVersion(value: unknown): SpecArtifactVersion {
  const raw = rawObject(value);
  return {
    id: asString(field(raw, 'id')),
    specId: asString(field(raw, 'spec_id', 'specId')),
    revision: asNumber(field(raw, 'revision')),
    repoSpecPath: asString(field(raw, 'repo_spec_path', 'repoSpecPath')),
    markdown: asString(field(raw, 'markdown')),
    markdownSha256: asString(field(raw, 'markdown_sha256', 'markdownSha256')),
    sourceConversationId: asString(field(raw, 'source_conversation_id', 'sourceConversationId')),
    createdAt: asNumber(field(raw, 'created_at', 'createdAt')),
  };
}

function listFromResponse(data: unknown, key: string): unknown[] {
  if (Array.isArray(data)) return data;
  const raw = rawObject(data);
  const value = raw[key];
  return Array.isArray(value) ? value : [];
}

function ideaPayload(input: UpdateSpecIdeaInput & { id?: string; body?: string }): Raw {
  const targetAgent = input.targetAgent;
  return {
    id: input.id,
    title: input.title,
    body: input.body,
    status: input.status,
    target_agent_id: input.targetAgentId ?? targetAgent?.id,
    target_endpoint_id: input.targetEndpointId ?? targetAgent?.endpoint_id,
    target_repo_path: input.targetRepoPath ?? targetAgent?.project_path,
    target_agent_name: input.targetAgentName ?? targetAgent?.name,
    notes: input.notes,
    attachments: input.attachments,
    interview_conversation_id: input.interviewConversationId,
    converted_spec_id: input.convertedSpecId,
    error_message: input.errorMessage,
    archived_at: input.archivedAt,
  };
}

export async function fetchSpecIdeas(endpoint: Endpoint): Promise<SpecIdea[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get('/api/v1/spec-ideas');
  return listFromResponse(res.data, 'ideas').map((item) => normalizeSpecIdea(item, endpoint.id));
}

export async function createSpecIdea(
  endpoint: Endpoint,
  input: UpdateSpecIdeaInput & { id: string; body: string },
): Promise<SpecIdea> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post('/api/v1/spec-ideas', ideaPayload(input));
  return normalizeSpecIdea(field(rawObject(res.data), 'idea') ?? res.data, endpoint.id);
}

export async function updateSpecIdea(
  endpoint: Endpoint,
  id: string,
  input: UpdateSpecIdeaInput,
): Promise<SpecIdea> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.patch(
    `/api/v1/spec-ideas/${encodeURIComponent(id)}`,
    ideaPayload(input),
  );
  return normalizeSpecIdea(field(rawObject(res.data), 'idea') ?? res.data, endpoint.id);
}

export async function startSpecIdeaInterview(
  endpoint: Endpoint,
  id: string,
): Promise<StartSpecIdeaInterviewResult> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post(`/api/v1/spec-ideas/${encodeURIComponent(id)}/interview`, {});
  const raw = rawObject(res.data);
  const rawIdea = field(raw, 'idea');
  return {
    idea: rawIdea ? normalizeSpecIdea(rawIdea, endpoint.id) : undefined,
    conversationId: asString(field(raw, 'conversation_id', 'conversationId')),
  };
}

export async function fetchSpecArtifacts(endpoint: Endpoint): Promise<SpecArtifact[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get('/api/v1/specs');
  return listFromResponse(res.data, 'specs').map((item) =>
    normalizeSpecArtifact(item, endpoint.id),
  );
}

export async function fetchSpecArtifactDetail(
  endpoint: Endpoint,
  id: string,
): Promise<SpecArtifactDetail> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get(`/api/v1/specs/${encodeURIComponent(id)}`);
  const raw = rawObject(res.data);
  const spec = normalizeSpecArtifact(field(raw, 'spec', 'artifact') ?? res.data, endpoint.id);
  const latestVersionValue = field(raw, 'latest_version', 'latestVersion');
  const versions = asArray(field(raw, 'versions'), normalizeSpecArtifactVersion);
  const latestVersion = latestVersionValue
    ? normalizeSpecArtifactVersion(latestVersionValue)
    : versions.find((version) => version.id === spec.latestVersionId);
  return {
    spec,
    latestVersion,
    versions: versions.length > 0 ? versions : latestVersion ? [latestVersion] : [],
  };
}

export async function startSpecImplementation(
  endpoint: Endpoint,
  id: string,
): Promise<StartSpecImplementationResult> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.post(`/api/v1/specs/${encodeURIComponent(id)}/implement`, {});
  const raw = rawObject(res.data);
  const rawSpec = field(raw, 'spec');
  return {
    spec: rawSpec ? normalizeSpecArtifact(rawSpec, endpoint.id) : undefined,
    conversationId: asString(field(raw, 'conversation_id', 'conversationId')),
  };
}
