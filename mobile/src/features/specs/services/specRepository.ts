import { getDb } from '@/db';
import { type Agent } from '@/types';
import {
  type LegacySpecStatus,
  type SpecAnswer,
  type SpecDraft,
  type SpecQuestionRound,
} from '../types';

interface SpecRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  target_agent_id: string;
  target_endpoint_id: string;
  target_repo_path: string;
  target_agent_name: string;
  target_runtime: Agent['runtime'];
  questions_json: string;
  answers_json: string;
  markdown_preview: string | null;
  repo_spec_path: string | null;
  linked_conversation_id: string | null;
  linked_activity_item_id: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToSpec(row: SpecRow): SpecDraft {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as LegacySpecStatus,
    targetAgentId: row.target_agent_id,
    targetEndpointId: row.target_endpoint_id,
    targetRepoPath: row.target_repo_path,
    targetAgentName: row.target_agent_name,
    targetRuntime: row.target_runtime,
    questions: parseJson<SpecQuestionRound[]>(row.questions_json, []),
    answers: parseJson<SpecAnswer[]>(row.answers_json, []),
    markdownPreview: row.markdown_preview ?? undefined,
    repoSpecPath: row.repo_spec_path ?? undefined,
    linkedConversationId: row.linked_conversation_id ?? undefined,
    linkedActivityItemId: row.linked_activity_item_id ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSpecs(): Promise<SpecDraft[]> {
  const db = getDb();
  const rows = await db.getAllAsync<SpecRow>(
    `SELECT
      id,
      title,
      slug,
      status,
      target_agent_id,
      target_endpoint_id,
      target_repo_path,
      target_agent_name,
      target_runtime,
      questions_json,
      answers_json,
      markdown_preview,
      repo_spec_path,
      linked_conversation_id,
      linked_activity_item_id,
      error_message,
      created_at,
      updated_at
     FROM specs
     ORDER BY updated_at DESC`,
  );
  return rows.map(rowToSpec);
}

export async function saveSpec(spec: SpecDraft): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO specs (
      id,
      title,
      slug,
      status,
      target_agent_id,
      target_endpoint_id,
      target_repo_path,
      target_agent_name,
      target_runtime,
      questions_json,
      answers_json,
      markdown_preview,
      repo_spec_path,
      linked_conversation_id,
      linked_activity_item_id,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      spec.id,
      spec.title,
      spec.slug,
      spec.status,
      spec.targetAgentId,
      spec.targetEndpointId,
      spec.targetRepoPath,
      spec.targetAgentName,
      spec.targetRuntime,
      JSON.stringify(spec.questions),
      JSON.stringify(spec.answers),
      spec.markdownPreview ?? null,
      spec.repoSpecPath ?? null,
      spec.linkedConversationId ?? null,
      spec.linkedActivityItemId ?? null,
      spec.errorMessage ?? null,
      spec.createdAt,
      spec.updatedAt,
    ],
  );
}

export async function deleteSpec(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM specs WHERE id = ?', [id]);
}
