import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { type Endpoint } from '@/types';
import { useActivityInfiniteQuery } from './useActivityInfiniteQuery';
import { type AggregatedActivityResult } from '../services/activityService';

const mockAggregateActivity = jest.fn();

jest.mock('../services/activityService', () => ({
  aggregateActivity: (...args: unknown[]) => mockAggregateActivity(...args),
}));

function configuredEndpoints(): Endpoint[] {
  return [
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
}

function resultWithAttention(ids: string[]): AggregatedActivityResult {
  return {
    needsAttention: ids.map((id, index) => ({
      id,
      source_id: id,
      section: 'attention',
      conversation_id: `conv-${index}`,
      agent_id: `agent-${index}`,
      agent_name: 'Deploy Project',
      title: `Decision ${index}`,
      subtitle: 'Ship release notes',
      status_label: 'Pending',
      tone: 'attention',
      timestamp: 1000 - index,
      ask_id: `ask-${index}`,
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    })),
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

function emptyActivity(): AggregatedActivityResult {
  return {
    needsAttention: [],
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useActivityInfiniteQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /// Initial page query: Activity pagination starts with a 20-row cumulative request.
  ///
  /// Data construction:
  ///   endpoints = ep-1 + ep-2
  ///   initial page limit = 20（SPEC first page size）
  ///   aggregate result = 1 attention row
  ///
  /// Execution process:
  ///   1. Render useActivityInfiniteQuery with enabled=true.
  ///   2. Wait until the first page resolves.
  ///   3. Inspect aggregateActivity arguments and hook data.
  ///
  /// Expected result:
  ///   - Positive: aggregateActivity receives endpoints and limit 20.
  ///   - Positive: hook exposes the loaded attention row.
  ///   - Negative: old implicit default limit call is not used.
  it('loads the first Activity page with limit 20', async () => {
    const endpoints = configuredEndpoints();
    mockAggregateActivity.mockResolvedValueOnce(resultWithAttention(['attention-1']));

    const { result } = renderHook(() => useActivityInfiniteQuery({ endpoints, enabled: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(1);
    });

    expect({
      actual: mockAggregateActivity.mock.calls[0],
      reason: 'initial query should request Activity with the first-page limit',
    }).toEqual({ actual: [endpoints, 20], reason: expect.any(String) });
    expect({
      actual: result.current.activity.needsAttention[0].id,
      reason: 'the hook should expose loaded first-page Activity data',
    }).toEqual({ actual: 'attention-1', reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[0].length,
      reason: 'the old implicit default aggregateActivity(endpoints) call should not be used',
    }).toEqual({ actual: 2, reason: expect.any(String) });
  });

  /// Next page query: loadMore requests the next cumulative Activity limit.
  ///
  /// Data construction:
  ///   first page ids  = ["attention-1"] from limit 20
  ///   second page ids = ["attention-1", "attention-2"] from limit 40
  ///   next limit      = 20 + 20 = 40
  ///
  /// Execution process:
  ///   1. Render the hook and wait for the first page.
  ///   2. Call fetchNextPage().
  ///   3. Wait for the second page to merge.
  ///
  /// Expected result:
  ///   - Positive: second request uses limit 40.
  ///   - Positive: attention-2 becomes visible.
  ///   - Negative: attention-1 is not duplicated after the cumulative merge.
  it('loads the next cumulative Activity page with limit 40', async () => {
    const endpoints = configuredEndpoints();
    mockAggregateActivity
      .mockResolvedValueOnce(resultWithAttention(['attention-1']))
      .mockResolvedValueOnce(resultWithAttention(['attention-1', 'attention-2']));

    const { result } = renderHook(() => useActivityInfiniteQuery({ endpoints, enabled: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(1);
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(2);
    });

    expect({
      actual: mockAggregateActivity.mock.calls[1],
      reason: 'load more should request the second cumulative limit',
    }).toEqual({ actual: [endpoints, 40], reason: expect.any(String) });
    expect({
      actual: result.current.activity.needsAttention.some((item) => item.id === 'attention-2'),
      reason: 'the second cumulative page should expose the newly loaded row',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: result.current.activity.needsAttention.filter((item) => item.id === 'attention-1')
        .length,
      reason: 'overlapping first-page rows must not duplicate after load more',
    }).toEqual({ actual: 1, reason: expect.any(String) });
  });

  /// Manual refresh after load-more: pull refresh should reset pagination to the first page.
  ///
  /// Data construction:
  ///   first page ids     = ["attention-1"] from limit 20
  ///   second page ids    = ["attention-1", "attention-2"] from limit 40
  ///   refreshed page ids = ["attention-refreshed"] from limit 20
  ///
  /// Execution process:
  ///   1. Render the hook and wait for the first page.
  ///   2. Load the second cumulative page.
  ///   3. Call refreshFirstPage().
  ///   4. Inspect aggregateActivity calls and visible data.
  ///
  /// Expected result:
  ///   - Positive: refreshFirstPage requests limit 20 after a limit 40 page exists.
  ///   - Positive: refreshed first-page data becomes visible.
  ///   - Negative: refreshFirstPage does not request limit 40 or keep second-page-only rows.
  it('refreshes back to the first Activity page after load more', async () => {
    const endpoints = configuredEndpoints();
    mockAggregateActivity
      .mockResolvedValueOnce(resultWithAttention(['attention-1']))
      .mockResolvedValueOnce(resultWithAttention(['attention-1', 'attention-2']))
      .mockResolvedValueOnce(resultWithAttention(['attention-refreshed']));

    const { result } = renderHook(() => useActivityInfiniteQuery({ endpoints, enabled: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(1);
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(2);
    });
    await act(async () => {
      await result.current.refreshFirstPage();
    });
    await waitFor(() => {
      expect(result.current.activity.needsAttention[0].id).toBe('attention-refreshed');
    });

    expect({
      actual: mockAggregateActivity.mock.calls[2],
      reason: 'manual refresh should reset the infinite query to its first-page limit',
    }).toEqual({ actual: [endpoints, 20], reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[2][1] === 40,
      reason: 'manual refresh must not keep refetching the already loaded second-page limit',
    }).toEqual({ actual: false, reason: expect.any(String) });
    expect({
      actual: result.current.activity.needsAttention.some((item) => item.id === 'attention-2'),
      reason: 'second-page-only rows should not remain after first-page refresh data replaces them',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Next page failure: failed loadMore keeps existing data and exposes retry state.
  ///
  /// Data construction:
  ///   first page ids = ["attention-1"]
  ///   second page    = rejected Error("offline")
  ///
  /// Execution process:
  ///   1. Render and load the first page.
  ///   2. Call fetchNextPage() and let it reject internally.
  ///   3. Inspect current data and loadMoreError.
  ///
  /// Expected result:
  ///   - Positive: first page data remains visible.
  ///   - Positive: loadMoreError contains the rejected error.
  ///   - Negative: failed next page does not clear already loaded rows.
  it('keeps loaded Activity visible when a next page fails', async () => {
    const endpoints = configuredEndpoints();
    mockAggregateActivity
      .mockResolvedValueOnce(resultWithAttention(['attention-1']))
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useActivityInfiniteQuery({ endpoints, enabled: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.activity.needsAttention).toHaveLength(1);
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect({
      actual: result.current.activity.needsAttention[0].id,
      reason: 'first-page data should remain visible after load-more failure',
    }).toEqual({ actual: 'attention-1', reason: expect.any(String) });
    expect({
      actual: result.current.loadMoreError?.message,
      reason: 'load more failures should be exposed for retry UI',
    }).toEqual({ actual: 'offline', reason: expect.any(String) });
    expect({
      actual: result.current.activity.needsAttention.length === 0,
      reason: 'a failed next page must not clear already loaded rows',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Empty endpoints: no configured endpoints should not issue Activity network requests.
  ///
  /// Data construction:
  ///   endpoints = []
  ///   expected aggregate = empty sections + no failures
  ///
  /// Execution process:
  ///   1. Render the hook with an empty endpoint list.
  ///   2. Inspect returned activity and aggregateActivity calls.
  ///
  /// Expected result:
  ///   - Positive: hook returns an empty aggregate.
  ///   - Negative: aggregateActivity is not called with an empty endpoint list.
  it('returns empty Activity without querying when no endpoints are configured', async () => {
    const { result } = renderHook(
      () => useActivityInfiniteQuery({ endpoints: [], enabled: true }),
      { wrapper: wrapper() },
    );

    await waitFor(() => {
      expect(result.current.activity).toEqual(emptyActivity());
    });

    expect({
      actual: result.current.activity,
      reason: 'empty endpoint state should produce a stable empty aggregate',
    }).toEqual({ actual: emptyActivity(), reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls.length,
      reason: 'empty endpoint state must not call aggregateActivity',
    }).toEqual({ actual: 0, reason: expect.any(String) });
  });
});
