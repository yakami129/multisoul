import { getEndpointClient } from '@/api/endpointClient';
import { type Endpoint } from '@/types';
import { aggregateActivity, type ActivityApiItem, fetchEndpointActivity } from './activityService';

const mockGet = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet })),
}));

const endpoints: Endpoint[] = [
  {
    id: 'ep-1',
    label: 'Office Mac',
    base_url: 'http://office.local:8765',
    token: 'tok-office',
    last_seen_at: null,
  },
  {
    id: 'ep-2',
    label: 'Studio Mac',
    base_url: 'http://studio.local:8765',
    token: 'tok-studio',
    last_seen_at: null,
  },
];

const attentionOld: ActivityApiItem = {
  id: 'attention:conv-1:ask-1',
  section: 'attention',
  conversation_id: 'conv-1',
  agent_id: 'agent-1',
  agent_name: 'Deploy Project',
  title: 'Deploy now?',
  subtitle: 'Ship release notes',
  status_label: 'Pending',
  tone: 'attention',
  timestamp: 1000,
  ask_id: 'ask-1',
};

const attentionNewDuplicateId: ActivityApiItem = {
  ...attentionOld,
  conversation_id: 'conv-2',
  agent_id: 'agent-2',
  agent_name: 'Billing Project',
  title: 'Run migration?',
  subtitle: 'Database migration',
  timestamp: 3000,
  ask_id: 'ask-2',
};

const runningItem: ActivityApiItem = {
  id: 'running:conv-3',
  section: 'running',
  conversation_id: 'conv-3',
  agent_id: 'agent-3',
  agent_name: 'Auth Project',
  title: 'Tighten sign in states',
  subtitle: 'Checking state machine',
  status_label: 'Running',
  tone: 'running',
  timestamp: 2000,
};

const doneItem: ActivityApiItem = {
  id: 'done:conv-4',
  section: 'done',
  conversation_id: 'conv-4',
  agent_id: 'agent-4',
  agent_name: 'Docs Project',
  title: 'Ship release notes',
  subtitle: 'Release notes are ready',
  status_label: 'Done',
  tone: 'done',
  timestamp: 4000,
};

describe('activityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /// Single endpoint fetch: Activity API uses the DB-backed endpoint and injects endpoint context.
  ///
  /// Data construction:
  ///   endpoint        = ep-1 / Office Mac / http://office.local:8765 / tok-office
  ///   API items       = one attention item with local id "attention:conv-1:ask-1"
  ///   limit           = default 50 items per section
  ///
  /// Execution process:
  ///   1. Mock GET /api/v1/activity to return one item.
  ///   2. Call fetchEndpointActivity(endpoint).
  ///   3. Inspect the HTTP call and transformed item.
  ///
  /// Expected result:
  ///   - Positive: the endpoint client is created with ep-1 base URL and token.
  ///   - Positive: the request includes limit_per_section=50.
  ///   - Positive: the returned id is globally namespaced as ep-1:item.id.
  ///   - Negative: the local source id is not lost during namespacing.
  it('fetches one endpoint activity with limit_per_section=50 and endpoint context', async () => {
    mockGet.mockResolvedValueOnce({ data: { items: [attentionOld] } });

    const result = await fetchEndpointActivity(endpoints[0]);

    expect(getEndpointClient).toHaveBeenCalledWith('http://office.local:8765', 'tok-office');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/activity', {
      params: { limit_per_section: 50 },
    });
    expect(result[0]).toMatchObject({
      id: 'ep-1:attention:conv-1:ask-1',
      source_id: 'attention:conv-1:ask-1',
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    });
    expect(result[0].id).not.toBe(
      'attention:conv-1:ask-1',
      'global item id must not reuse the endpoint-local id directly',
    );
  });

  /// Multi-endpoint aggregation: sections merge independently and sort newest first.
  ///
  /// Data construction:
  ///   ep-1 attention timestamp = 1000
  ///   ep-2 attention timestamp = 3000
  ///   ep-1 running timestamp   = 2000
  ///   ep-2 done timestamp      = 4000
  ///
  /// Execution process:
  ///   1. Mock two successful endpoint Activity responses.
  ///   2. Aggregate both endpoints.
  ///   3. Inspect each section independently.
  ///
  /// Expected result:
  ///   - Positive: both endpoints are requested.
  ///   - Positive: attention is sorted 3000 before 1000.
  ///   - Positive: running and done sections retain their own items.
  ///   - Negative: no failed endpoints are reported for successful requests.
  it('aggregates all endpoints by section and sorts each section by timestamp descending', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { items: [attentionOld, runningItem] } })
      .mockResolvedValueOnce({ data: { items: [attentionNewDuplicateId, doneItem] } });

    const result = await aggregateActivity(endpoints);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.needsAttention.map((item) => item.title)).toEqual([
      'Run migration?',
      'Deploy now?',
    ]);
    expect(result.running[0].title).toBe('Tighten sign in states');
    expect(result.done[0].title).toBe('Ship release notes');
    expect(result.failedEndpoints).toEqual([]);
  });

  /// Global id uniqueness: identical endpoint-local ids must not collide across machines.
  ///
  /// Data construction:
  ///   ep-1 item id = "attention:conv-1:ask-1"
  ///   ep-2 item id = "attention:conv-1:ask-1" (same local id, different endpoint)
  ///   global ids   = "ep-1:attention:conv-1:ask-1" and "ep-2:attention:conv-1:ask-1"
  ///
  /// Execution process:
  ///   1. Mock both endpoints with the same local Activity item id.
  ///   2. Aggregate both endpoints.
  ///   3. Inspect the generated ids.
  ///
  /// Expected result:
  ///   - Positive: both global ids exist.
  ///   - Negative: the two items do not collapse into a single duplicate row.
  it('preserves duplicate endpoint-local item ids by prefixing endpoint_id', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { items: [attentionOld] } })
      .mockResolvedValueOnce({ data: { items: [attentionOld] } });

    const result = await aggregateActivity(endpoints);

    expect(result.needsAttention).toHaveLength(2);
    expect(result.needsAttention.some((item) => item.id === 'ep-1:attention:conv-1:ask-1')).toBe(
      true,
      'ep-1 global id should exist for the first endpoint item',
    );
    expect(result.needsAttention.some((item) => item.id === 'ep-2:attention:conv-1:ask-1')).toBe(
      true,
      'ep-2 global id should exist for the second endpoint item',
    );
    expect(new Set(result.needsAttention.map((item) => item.id)).size).toBe(
      2,
      'global ids should be unique even when endpoint-local ids match',
    );
  });

  /// Partial failure: failed endpoints are exposed without blocking successful Activity rows.
  ///
  /// Data construction:
  ///   ep-1 = successful response with one running item
  ///   ep-2 = rejected request
  ///
  /// Execution process:
  ///   1. Mock ep-1 success and ep-2 failure.
  ///   2. Aggregate both endpoints.
  ///   3. Inspect successful sections and failure labels.
  ///
  /// Expected result:
  ///   - Positive: ep-1 running item remains visible in the aggregate.
  ///   - Positive: ep-2 label is reported for retry UI.
  ///   - Negative: the failure does not erase successful sections.
  it('returns successful items and failed endpoint labels when one endpoint fails', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { items: [runningItem] } })
      .mockRejectedValueOnce(new Error('offline'));

    const result = await aggregateActivity(endpoints);

    expect(result.running).toHaveLength(1);
    expect(result.running[0].endpoint_label).toBe('Office Mac');
    expect(result.failedEndpoints).toEqual([{ endpoint_id: 'ep-2', endpoint_label: 'Studio Mac' }]);
    expect(result.needsAttention).toEqual([]);
  });
});
