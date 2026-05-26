import {
  activityResultCount,
  hasMoreActivity,
  mergeActivityPages,
  nextActivityLimit,
} from './activityPagination';
import { type AggregatedActivityResult } from './activityService';

function emptyResult(): AggregatedActivityResult {
  return {
    needsAttention: [],
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

function resultWithIds(ids: {
  attention?: string[];
  running?: string[];
  done?: string[];
}): AggregatedActivityResult {
  const baseItem = {
    source_id: 'source',
    section: 'attention' as const,
    conversation_id: 'conv',
    agent_id: 'agent',
    agent_name: 'Project',
    title: 'Title',
    subtitle: 'Subtitle',
    status_label: 'Pending',
    tone: 'attention' as const,
    timestamp: 1,
    endpoint_id: 'ep-1',
    endpoint_label: 'Office Mac',
  };

  return {
    needsAttention: (ids.attention ?? []).map((id, index) => ({
      ...baseItem,
      id,
      source_id: id,
      conversation_id: `conv-attention-${index}`,
      timestamp: 100 - index,
    })),
    running: (ids.running ?? []).map((id, index) => ({
      ...baseItem,
      id,
      source_id: id,
      section: 'running' as const,
      status_label: 'Running',
      tone: 'running' as const,
      conversation_id: `conv-running-${index}`,
      timestamp: 80 - index,
    })),
    done: (ids.done ?? []).map((id, index) => ({
      ...baseItem,
      id,
      source_id: id,
      section: 'done' as const,
      status_label: 'Done',
      tone: 'done' as const,
      conversation_id: `conv-done-${index}`,
      timestamp: 60 - index,
      read_at: index === 0 ? null : 1234,
    })),
    failedEndpoints: [],
  };
}

describe('activityPagination', () => {
  /// Page size progression: the next cumulative request must advance by one page.
  ///
  /// Data construction:
  ///   currentLimit = 20（first page）
  ///   pageSize     = 20（SPEC page size）
  ///   nextLimit    = currentLimit(20) + pageSize(20) = 40
  ///
  /// Execution process:
  ///   1. Call nextActivityLimit(20).
  ///   2. Inspect the returned cumulative limit.
  ///
  /// Expected result:
  ///   - Positive: returned limit is 40, so page two asks for a larger cumulative window.
  ///   - Negative: returned limit is not 20, which would refetch the same first page.
  it('increments the cumulative Activity limit by one page', () => {
    const limit = nextActivityLimit(20);

    expect({
      actual: limit,
      reason: 'page two should request a cumulative 40-row window',
    }).toEqual({ actual: 40, reason: expect.any(String) });
    expect({
      actual: limit === 20,
      reason: 'pagination must not repeat the first-page limit',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Page count: total loaded rows are counted across all three Activity sections.
  ///
  /// Data construction:
  ///   needsAttention = 2 rows
  ///   running        = 1 row
  ///   done           = 2 rows
  ///   total          = 2 + 1 + 2 = 5 rows
  ///
  /// Execution process:
  ///   1. Build an aggregate result with 5 rows across sections.
  ///   2. Call activityResultCount(result).
  ///
  /// Expected result:
  ///   - Positive: count is 5 across all sections.
  ///   - Negative: count is not 2, which would mean only the first section was counted.
  it('counts loaded Activity rows across every section', () => {
    const count = activityResultCount(
      resultWithIds({
        attention: ['attention-1', 'attention-2'],
        running: ['running-1'],
        done: ['done-1', 'done-2'],
      }),
    );

    expect({
      actual: count,
      reason: 'all loaded sections should contribute to the pagination count',
    }).toEqual({ actual: 5, reason: expect.any(String) });
    expect({
      actual: count === 2,
      reason: 'counting only Needs Attention would hide loaded Running and Done rows',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Cumulative merge: later cumulative pages replace earlier overlap without duplicating rows.
  ///
  /// Data construction:
  ///   page 1 attention ids = ["attention-1"]
  ///   page 2 attention ids = ["attention-1", "attention-2"]
  ///   page 2 done ids      = ["done-1"] with read_at = null
  ///
  /// Execution process:
  ///   1. Merge page 1 and page 2.
  ///   2. Inspect each section's ids and Done read state.
  ///
  /// Expected result:
  ///   - Positive: attention-1 exists once.
  ///   - Positive: attention-2 exists from the larger cumulative page.
  ///   - Positive: done-1 remains unread with read_at=null.
  ///   - Negative: attention-1 is not duplicated at the cumulative page boundary.
  it('merges cumulative pages without duplicating overlapping items', () => {
    const first = resultWithIds({ attention: ['attention-1'] });
    const second = resultWithIds({ attention: ['attention-1', 'attention-2'], done: ['done-1'] });

    const merged = mergeActivityPages([first, second]);
    const attentionIds = merged.needsAttention.map((item) => item.id);
    const done = merged.done[0];

    expect({
      actual: attentionIds.includes('attention-1'),
      reason: 'the original first-page attention row should still exist',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: attentionIds.includes('attention-2'),
      reason: 'the larger cumulative page should add the second attention row',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: attentionIds.filter((id) => id === 'attention-1').length,
      reason: 'overlap at the page boundary must not duplicate attention-1',
    }).toEqual({ actual: 1, reason: expect.any(String) });
    expect({
      actual: done.read_at,
      reason: 'unread Done rows must preserve their read_at=null state after merging',
    }).toEqual({ actual: null, reason: expect.any(String) });
  });

  /// Next-page detection: a larger result means there is more Activity to request.
  ///
  /// Data construction:
  ///   previousCount = 2 rows loaded from limit 20
  ///   currentCount  = 4 rows loaded from limit 40
  ///   currentLimit  = 40
  ///
  /// Execution process:
  ///   1. Call hasMoreActivity with growing counts.
  ///   2. Inspect the boolean result.
  ///
  /// Expected result:
  ///   - Positive: hasMoreActivity returns true while the cumulative result grows.
  ///   - Negative: it does not stop after page two when new rows appeared.
  it('keeps pagination open while cumulative results grow', () => {
    const hasMore = hasMoreActivity({
      previousCount: 2,
      currentCount: 4,
      currentLimit: 40,
    });

    expect({
      actual: hasMore,
      reason: 'growth from 2 to 4 rows means another page may exist',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: hasMore === false,
      reason: 'pagination should not close while the latest cumulative request added rows',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// End detection: unchanged cumulative results mean the loaded window has reached the end.
  ///
  /// Data construction:
  ///   previousCount = 4 rows loaded from limit 20
  ///   currentCount  = 4 rows loaded from limit 40
  ///   currentLimit  = 40
  ///
  /// Execution process:
  ///   1. Call hasMoreActivity with unchanged counts.
  ///   2. Inspect the boolean result.
  ///
  /// Expected result:
  ///   - Positive: hasMoreActivity returns false because the larger limit found no new rows.
  ///   - Negative: it does not keep requesting larger limits forever.
  it('closes pagination when a larger cumulative request finds no new rows', () => {
    const hasMore = hasMoreActivity({
      previousCount: 4,
      currentCount: 4,
      currentLimit: 40,
    });

    expect({
      actual: hasMore,
      reason: 'unchanged row count after a larger limit means the endpoint is exhausted',
    }).toEqual({ actual: false, reason: expect.any(String) });
    expect({
      actual: hasMore === true,
      reason: 'pagination must not keep increasing limits when no new rows appear',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Empty merge: no loaded pages should produce the standard empty aggregate.
  ///
  /// Data construction:
  ///   pages = []（no successful request yet）
  ///
  /// Execution process:
  ///   1. Call mergeActivityPages([]).
  ///   2. Inspect all returned arrays.
  ///
  /// Expected result:
  ///   - Positive: all Activity sections are empty arrays.
  ///   - Negative: failedEndpoints is not invented by pagination utilities.
  it('returns an empty aggregate when no pages have loaded', () => {
    const merged = mergeActivityPages([]);
    const expected = emptyResult();

    expect({
      actual: merged.needsAttention.length,
      reason: 'empty merge should not invent Needs Attention rows',
    }).toEqual({ actual: expected.needsAttention.length, reason: expect.any(String) });
    expect({
      actual: merged.running.length,
      reason: 'empty merge should not invent Running rows',
    }).toEqual({ actual: expected.running.length, reason: expect.any(String) });
    expect({
      actual: merged.done.length,
      reason: 'empty merge should not invent Done rows',
    }).toEqual({ actual: expected.done.length, reason: expect.any(String) });
    expect({
      actual: merged.failedEndpoints.length,
      reason: 'pagination utility should not synthesize endpoint failures',
    }).toEqual({ actual: expected.failedEndpoints.length, reason: expect.any(String) });
  });
});
