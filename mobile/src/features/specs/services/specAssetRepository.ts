import { getDb } from '@/db';
import {
  type IdeaStatus,
  type SpecAssetStatus,
  type SpecArtifact,
  type SpecArtifactDetail,
  type SpecArtifactVersion,
  type SpecIdea,
  type SpecIdeaAttachment,
  type SpecIdeaNote,
  type SpecIdeaPendingMutation,
} from '../types';

const LEGACY_MIGRATION_KEY = 'spec_assets_legacy_v1';

interface IdeaRow {
  id: string;
  title: string;
  status: string;
  target_agent_id: string;
  target_endpoint_id: string;
  target_repo_path: string;
  target_agent_name: string;
  body: string;
  notes_json: string;
  attachments_json: string;
  interview_conversation_id: string | null;
  converted_spec_id: string | null;
  error_message: string | null;
  pending_mutation: string | null;
  last_sync_error: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

interface SpecRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  target_agent_id: string;
  target_endpoint_id: string;
  target_repo_path: string;
  target_agent_name?: string;
  target_runtime?: string;
  questions_json?: string;
  answers_json?: string;
  markdown_preview?: string | null;
  repo_spec_path: string | null;
  latest_version_id?: string;
  source_idea_id?: string | null;
  interview_conversation_id?: string | null;
  latest_implementation_conversation_id?: string | null;
  linked_conversation_id?: string | null;
  linked_activity_item_id: string | null;
  error_message?: string | null;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  id: string;
  spec_id: string;
  revision: number;
  repo_spec_path: string;
  markdown: string;
  markdown_sha256: string;
  source_conversation_id: string;
  created_at: number;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function optional(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return value ?? undefined;
}

function rowToIdea(row: IdeaRow): SpecIdea {
  return {
    id: row.id,
    title: row.title,
    status: row.status as IdeaStatus,
    targetAgentId: row.target_agent_id,
    targetEndpointId: row.target_endpoint_id,
    targetRepoPath: row.target_repo_path,
    targetAgentName: row.target_agent_name,
    body: row.body,
    notes: parseJson<SpecIdeaNote[]>(row.notes_json, []),
    attachments: parseJson<SpecIdeaAttachment[]>(row.attachments_json, []),
    interviewConversationId: optional(row.interview_conversation_id),
    convertedSpecId: optional(row.converted_spec_id),
    errorMessage: optional(row.error_message),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: optionalNumber(row.archived_at),
    pendingMutation: optional(row.pending_mutation) as SpecIdeaPendingMutation | undefined,
    lastSyncError: optional(row.last_sync_error),
  };
}

function rowToSpec(row: SpecRow): SpecArtifact {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as SpecAssetStatus,
    targetAgentId: row.target_agent_id,
    targetEndpointId: row.target_endpoint_id,
    targetRepoPath: row.target_repo_path,
    repoSpecPath: row.repo_spec_path ?? '',
    latestVersionId: row.latest_version_id ?? '',
    sourceIdeaId: optional(row.source_idea_id),
    interviewConversationId: row.interview_conversation_id ?? '',
    latestImplementationConversationId: optional(row.latest_implementation_conversation_id),
    linkedActivityItemId: optional(row.linked_activity_item_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToVersion(row: VersionRow): SpecArtifactVersion {
  return {
    id: row.id,
    specId: row.spec_id,
    revision: row.revision,
    repoSpecPath: row.repo_spec_path,
    markdown: row.markdown,
    markdownSha256: row.markdown_sha256,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
  };
}

export async function saveIdea(
  idea: SpecIdea,
  pendingMutation: SpecIdeaPendingMutation | null = idea.pendingMutation ?? null,
  lastSyncError: string | null = idea.lastSyncError ?? null,
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO spec_ideas (
      id, title, status, target_agent_id, target_endpoint_id, target_repo_path, target_agent_name,
      body, notes_json, attachments_json, interview_conversation_id, converted_spec_id,
      error_message, pending_mutation, last_sync_error, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      idea.id,
      idea.title,
      idea.status,
      idea.targetAgentId,
      idea.targetEndpointId,
      idea.targetRepoPath,
      idea.targetAgentName,
      idea.body,
      JSON.stringify(idea.notes),
      JSON.stringify(idea.attachments),
      idea.interviewConversationId ?? null,
      idea.convertedSpecId ?? null,
      idea.errorMessage ?? null,
      pendingMutation,
      lastSyncError,
      idea.createdAt,
      idea.updatedAt,
      idea.archivedAt ?? null,
    ],
  );
}

export async function loadIdeas(): Promise<SpecIdea[]> {
  await migrateLegacySpecs();
  const rows = await getDb().getAllAsync<IdeaRow>(
    'SELECT * FROM spec_ideas ORDER BY updated_at DESC',
  );
  return rows.map(rowToIdea);
}

export async function loadPendingIdeas(endpointId: string): Promise<SpecIdea[]> {
  const rows = await getDb().getAllAsync<IdeaRow>(
    `SELECT * FROM spec_ideas
     WHERE target_endpoint_id = ? AND pending_mutation IS NOT NULL
     ORDER BY updated_at ASC`,
    [endpointId],
  );
  return rows.map(rowToIdea);
}

export async function replaceIdeasForEndpoint(
  endpointId: string,
  ideas: SpecIdea[],
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    'DELETE FROM spec_ideas WHERE target_endpoint_id = ? AND pending_mutation IS NULL',
    [endpointId],
  );
  for (const idea of ideas) {
    await saveIdea({ ...idea, targetEndpointId: endpointId }, null, null);
  }
}

export async function deleteIdea(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM spec_ideas WHERE id = ?', [id]);
}

export async function markIdeaSyncError(id: string, message: string): Promise<void> {
  await getDb().runAsync('UPDATE spec_ideas SET last_sync_error = ? WHERE id = ?', [message, id]);
}

export async function saveSpecArtifact(spec: SpecArtifact): Promise<void> {
  await getDb().runAsync(
    `INSERT OR REPLACE INTO spec_artifacts (
      id, title, slug, status, target_agent_id, target_endpoint_id, target_repo_path,
      repo_spec_path, latest_version_id, source_idea_id, interview_conversation_id,
      latest_implementation_conversation_id, linked_activity_item_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      spec.id,
      spec.title,
      spec.slug,
      spec.status,
      spec.targetAgentId,
      spec.targetEndpointId,
      spec.targetRepoPath,
      spec.repoSpecPath,
      spec.latestVersionId,
      spec.sourceIdeaId ?? null,
      spec.interviewConversationId,
      spec.latestImplementationConversationId ?? null,
      spec.linkedActivityItemId ?? null,
      spec.createdAt,
      spec.updatedAt,
    ],
  );
}

export async function saveSpecArtifactVersion(version: SpecArtifactVersion): Promise<void> {
  await getDb().runAsync(
    `INSERT OR REPLACE INTO spec_artifact_versions (
      id, spec_id, revision, repo_spec_path, markdown, markdown_sha256,
      source_conversation_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.specId,
      version.revision,
      version.repoSpecPath,
      version.markdown,
      version.markdownSha256,
      version.sourceConversationId,
      version.createdAt,
    ],
  );
}

export async function saveSpecArtifactDetail(detail: SpecArtifactDetail): Promise<void> {
  await saveSpecArtifact(detail.spec);
  for (const version of detail.versions) {
    await saveSpecArtifactVersion(version);
  }
}

export async function loadSpecs(): Promise<SpecArtifact[]> {
  await migrateLegacySpecs();
  const rows = await getDb().getAllAsync<SpecRow>(
    'SELECT * FROM spec_artifacts ORDER BY updated_at DESC',
  );
  const specs = rows.map(rowToSpec);
  return Promise.all(
    specs.map(async (spec) => ({
      ...spec,
      latestVersion: spec.latestVersionId ? await loadVersionById(spec.latestVersionId) : undefined,
    })),
  );
}

export async function loadSpecDetail(id: string): Promise<SpecArtifactDetail | undefined> {
  const specRows = await getDb().getAllAsync<SpecRow>('SELECT * FROM spec_artifacts WHERE id = ?', [
    id,
  ]);
  const spec = specRows[0] ? rowToSpec(specRows[0]) : undefined;
  if (!spec) return undefined;
  const versionRows = await getDb().getAllAsync<VersionRow>(
    'SELECT * FROM spec_artifact_versions WHERE spec_id = ? ORDER BY revision DESC',
    [id],
  );
  const versions = versionRows.map(rowToVersion);
  return {
    spec,
    latestVersion: versions.find((version) => version.id === spec.latestVersionId) ?? versions[0],
    versions,
  };
}

async function loadVersionById(id: string): Promise<SpecArtifactVersion | undefined> {
  const rows = await getDb().getAllAsync<VersionRow>(
    'SELECT * FROM spec_artifact_versions WHERE id = ?',
    [id],
  );
  return rows[0] ? rowToVersion(rows[0]) : undefined;
}

export async function replaceSpecsForEndpoint(
  endpointId: string,
  specs: SpecArtifact[],
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM spec_artifact_versions
     WHERE spec_id IN (SELECT id FROM spec_artifacts WHERE target_endpoint_id = ?)`,
    [endpointId],
  );
  await db.runAsync('DELETE FROM spec_artifacts WHERE target_endpoint_id = ?', [endpointId]);
  for (const spec of specs) {
    await saveSpecArtifact({ ...spec, targetEndpointId: endpointId });
    if (spec.latestVersion) {
      await saveSpecArtifactVersion(spec.latestVersion);
    }
  }
}

function legacyStatus(status: string): SpecAssetStatus {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'draft' || status === 'review') return 'draft';
  return 'ready';
}

function notesFromLegacyAnswers(raw: string | null | undefined): SpecIdeaNote[] {
  const answers = parseJson<Array<{ questionId?: string; value?: unknown; answeredAt?: number }>>(
    raw,
    [],
  );
  return answers.map((answer, index) => ({
    id: `legacy_note_${index + 1}`,
    body: `${answer.questionId ?? 'answer'}: ${
      Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? '')
    }`,
    createdAt: answer.answeredAt ?? 0,
    updatedAt: answer.answeredAt ?? 0,
  }));
}

export async function migrateLegacySpecs(): Promise<void> {
  const db = getDb();
  const existing = await db.getAllAsync<{ key: string }>(
    'SELECT key FROM app_migrations WHERE key = ?',
    [LEGACY_MIGRATION_KEY],
  );
  if (existing.length > 0) return;

  const rows = await db.getAllAsync<SpecRow>('SELECT * FROM specs ORDER BY updated_at ASC');
  for (const row of rows) {
    const ideaId = `legacy_idea_${row.id}`;
    if (['draft', 'review', 'approved'].includes(row.status)) {
      await saveIdea({
        id: ideaId,
        title: row.title,
        status: 'open',
        targetAgentId: row.target_agent_id,
        targetEndpointId: row.target_endpoint_id,
        targetRepoPath: row.target_repo_path,
        targetAgentName: row.target_agent_name ?? '',
        body: row.markdown_preview ?? row.title,
        notes: notesFromLegacyAnswers(row.answers_json),
        attachments: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
    if (row.repo_spec_path && row.markdown_preview) {
      const specId = `legacy_spec_${row.id}`;
      const versionId = `legacy_specver_${row.id}`;
      await saveSpecArtifact({
        id: specId,
        title: row.title,
        slug: row.slug,
        status: legacyStatus(row.status),
        targetAgentId: row.target_agent_id,
        targetEndpointId: row.target_endpoint_id,
        targetRepoPath: row.target_repo_path,
        repoSpecPath: row.repo_spec_path,
        latestVersionId: versionId,
        sourceIdeaId: undefined,
        interviewConversationId: row.linked_conversation_id ?? '',
        linkedActivityItemId: row.linked_activity_item_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      await saveSpecArtifactVersion({
        id: versionId,
        specId,
        revision: 1,
        repoSpecPath: row.repo_spec_path,
        markdown: row.markdown_preview,
        markdownSha256: `legacy:${row.id}`,
        sourceConversationId: row.linked_conversation_id ?? '',
        createdAt: row.updated_at,
      });
    }
  }

  await db.runAsync('INSERT OR REPLACE INTO app_migrations (key, applied_at) VALUES (?, ?)', [
    LEGACY_MIGRATION_KEY,
    Date.now(),
  ]);
}
