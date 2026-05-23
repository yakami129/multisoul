import { getEndpointClient } from '@/api/endpointClient';
import { type Endpoint } from '@/types';

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
  ask_id?: string;
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

interface ActivityApiResponse {
  items: ActivityApiItem[];
}

function byNewest(a: AggregatedActivityItem, b: AggregatedActivityItem): number {
  return b.timestamp - a.timestamp;
}

function withEndpointContext(item: ActivityApiItem, endpoint: Endpoint): AggregatedActivityItem {
  return {
    ...item,
    id: `${endpoint.id}:${item.id}`,
    source_id: item.id,
    endpoint_id: endpoint.id,
    endpoint_label: endpoint.label,
  };
}

export async function fetchEndpointActivity(
  endpoint: Endpoint,
  limitPerSection = 50,
): Promise<AggregatedActivityItem[]> {
  const client = getEndpointClient(endpoint.base_url, endpoint.token);
  const res = await client.get<ActivityApiResponse>('/api/v1/activity', {
    params: { limit_per_section: limitPerSection },
  });
  return res.data.items.map((item) => withEndpointContext(item, endpoint));
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
