import { getEndpointClient } from '@/api/endpointClient';
import { type Agent, type Conversation, type Endpoint } from '@/types';

export type ActivitySection = 'attention' | 'running' | 'done';
export type ActivityTone = 'attention' | 'running' | 'done' | 'failed';

export interface ActivityApiItem {
  id: string;
  section: ActivitySection;
  conversation_id: string;
  agent_id: string;
  agent_name: string;
  title: string;
  subtitle: string;
  status_label: string;
  tone: ActivityTone;
  timestamp: number;
  read_at?: number | null;
  ask_id?: string;
  workflow_id?: string;
  workflow_run_id?: string;
  workflow_name?: string;
}

export interface AggregatedActivityItem extends ActivityApiItem {
  id: string;
  source_id: string;
  endpoint_id: string;
  endpoint_label: string;
}

export interface ActivityEndpointFailure {
  endpoint_id: string;
  endpoint_label: string;
}

export interface AggregatedActivityResult {
  needsAttention: AggregatedActivityItem[];
  running: AggregatedActivityItem[];
  done: AggregatedActivityItem[];
  failedEndpoints: ActivityEndpointFailure[];
}

const LEGACY_DONE_READ_AT = 1;

interface ActivityApiResponse {
  items: ActivityApiItem[];
}

type LegacyAgent = Omit<Agent, 'endpoint_id' | 'endpoint_label'>;
type LegacyConversation = Omit<Conversation, 'endpoint_id' | 'agent_name'>;

function byNewest(a: AggregatedActivityItem, b: AggregatedActivityItem): number {
  return b.timestamp - a.timestamp;
}

function withEndpointContext(item: ActivityApiItem, endpoint: Endpoint): AggregatedActivityItem {
  const legacyReadState =
    item.section === 'done' && !Object.prototype.hasOwnProperty.call(item, 'read_at')
      ? { read_at: LEGACY_DONE_READ_AT }
      : {};
  return {
    ...item,
    ...legacyReadState,
    id: `${endpoint.id}:${item.id}`,
    source_id: item.id,
    endpoint_id: endpoint.id,
    endpoint_label: endpoint.label,
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    (error as { response?: { status?: number } }).response?.status === 404
  );
}

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function legacyConversationTitle(conversation: LegacyConversation): string {
  return cleanText(conversation.first_user_message) ?? conversation.title;
}

function legacyConversationSubtitle(conversation: LegacyConversation): string {
  return (
    cleanText(conversation.last_ai_reply) ??
    cleanText(conversation.first_user_message) ??
    conversation.title
  );
}

async function fetchLegacyEndpointActivity(
  endpoint: Endpoint,
  limitPerSection: number,
): Promise<AggregatedActivityItem[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const agentsRes = await client.get<LegacyAgent[]>('/api/v1/agents');
  const nested = await Promise.all(
    agentsRes.data.map(async (agent) => {
      const conversationsRes = await client.get<LegacyConversation[]>(
        `/api/v1/agents/${agent.id}/conversations`,
      );
      return conversationsRes.data.map((conversation) =>
        legacyConversationToActivityItem(endpoint, agent, conversation),
      );
    }),
  );
  const items = nested.flat().filter((item): item is AggregatedActivityItem => item != null);
  const perSection = (section: ActivitySection) =>
    items
      .filter((item) => item.section === section)
      .sort(byNewest)
      .slice(0, limitPerSection);
  return [...perSection('attention'), ...perSection('running'), ...perSection('done')];
}

function legacyConversationToActivityItem(
  endpoint: Endpoint,
  agent: LegacyAgent,
  conversation: LegacyConversation,
): AggregatedActivityItem | null {
  const base = {
    conversation_id: conversation.id,
    agent_id: agent.id,
    agent_name: agent.name,
    title: legacyConversationTitle(conversation),
    subtitle: legacyConversationSubtitle(conversation),
    timestamp: conversation.last_message_at,
    endpoint_id: endpoint.id,
    endpoint_label: endpoint.label,
  };

  if (conversation.status === 'awaiting_question') {
    return {
      ...base,
      id: `${endpoint.id}:legacy-attention:${conversation.id}`,
      source_id: `legacy-attention:${conversation.id}`,
      section: 'attention',
      status_label: 'Pending',
      tone: 'attention',
    };
  }

  if (conversation.status === 'running') {
    return {
      ...base,
      id: `${endpoint.id}:legacy-running:${conversation.id}`,
      source_id: `legacy-running:${conversation.id}`,
      section: 'running',
      status_label: 'Running',
      tone: 'running',
    };
  }

  if (conversation.status === 'completed' || conversation.status === 'failed') {
    const failed = conversation.status === 'failed';
    return {
      ...base,
      id: `${endpoint.id}:legacy-done:${conversation.id}`,
      source_id: `legacy-done:${conversation.id}`,
      section: 'done',
      status_label: failed ? 'Failed' : 'Done',
      tone: failed ? 'failed' : 'done',
      read_at: LEGACY_DONE_READ_AT,
    };
  }

  if (conversation.status === 'idle' && cleanText(conversation.last_ai_reply)) {
    return {
      ...base,
      id: `${endpoint.id}:legacy-done:${conversation.id}`,
      source_id: `legacy-done:${conversation.id}`,
      section: 'done',
      status_label: 'Done',
      tone: 'done',
      read_at: LEGACY_DONE_READ_AT,
    };
  }

  return null;
}

export async function fetchEndpointActivity(
  endpoint: Endpoint,
  limitPerSection = 50,
): Promise<AggregatedActivityItem[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  try {
    const res = await client.get<ActivityApiResponse>('/api/v1/activity', {
      params: { limit_per_section: limitPerSection },
    });
    return res.data.items.map((item) => withEndpointContext(item, endpoint));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return fetchLegacyEndpointActivity(endpoint, limitPerSection);
  }
}

export async function markDoneActivityRead(
  endpoint: Endpoint,
  conversationId: string,
): Promise<void> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  await client.post(`/api/v1/activity/done/${conversationId}/read`, {});
}

export async function markAllDoneActivityRead(endpoint: Endpoint): Promise<void> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  await client.post('/api/v1/activity/done/read-all', {});
}

export async function aggregateActivity(
  endpoints: Endpoint[],
  limitPerSection = 50,
): Promise<AggregatedActivityResult> {
  const results = await Promise.allSettled(
    endpoints.map((endpoint) => fetchEndpointActivity(endpoint, limitPerSection)),
  );

  const failedEndpoints: ActivityEndpointFailure[] = [];
  const items: AggregatedActivityItem[] = [];

  results.forEach((result, index) => {
    const endpoint = endpoints[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      return;
    }
    failedEndpoints.push({
      endpoint_id: endpoint.id,
      endpoint_label: endpoint.label,
    });
  });

  return {
    needsAttention: items.filter((item) => item.section === 'attention').sort(byNewest),
    running: items.filter((item) => item.section === 'running').sort(byNewest),
    done: items.filter((item) => item.section === 'done').sort(byNewest),
    failedEndpoints,
  };
}
