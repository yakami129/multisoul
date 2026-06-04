import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';
import { type AggregatedActivityResult } from '@/features/activity/services/activityService';
import { type Endpoint } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockPush = jest.fn();
const mockAggregateActivity = jest.fn();
const mockMarkDoneActivityRead = jest.fn();
const mockMarkAllDoneActivityRead = jest.fn();
const mockAbortConversation = jest.fn();
const mockDeleteConversation = jest.fn();
const mockUseActivityEvents = jest.fn();
let mockEndpoints: Endpoint[] = [];
const mockRemoveAppStateListener = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => callback(), [callback]);
  },
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/activity/hooks/useActivityEvents', () => ({
  useActivityEvents: (...args: unknown[]) => mockUseActivityEvents(...args),
}));

jest.mock('@/features/activity/services/activityService', () => ({
  aggregateActivity: (...args: unknown[]) => mockAggregateActivity(...args),
  markDoneActivityRead: (...args: unknown[]) => mockMarkDoneActivityRead(...args),
  markAllDoneActivityRead: (...args: unknown[]) => mockMarkAllDoneActivityRead(...args),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  abortConversation: (...args: unknown[]) => mockAbortConversation(...args),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}));

jest.mock('@/store/endpointStore', () => ({
  useEndpointStore: (selector: (state: { endpoints: Endpoint[] }) => unknown) =>
    selector({ endpoints: mockEndpoints }),
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: (selector: (state: { removeConversation: jest.Mock }) => unknown) =>
    selector({ removeConversation: jest.fn() }),
}));

jest.mock('@/features/activity/components/ActivityScreen', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return function MockActivityScreen(props: {
    needsAttention: Array<{ id: string; title: string }>;
    running: Array<{ id: string; title: string }>;
    done: Array<{ id: string; title: string }>;
    isRefreshing?: boolean;
    isLoadingMore?: boolean;
    hasMore?: boolean;
    loadMoreError?: string | null;
    onLoadMore?: () => void;
    onRetryLoadMore?: () => void;
    onRefresh?: () => void;
    onFilterChange?: () => void;
  }) {
    return (
      <View>
        <Text testID="refreshing-state">{props.isRefreshing ? 'refreshing' : 'idle'}</Text>
        <Text testID="has-more-state">{props.hasMore ? 'has-more' : 'no-more'}</Text>
        {props.needsAttention.map((item) => (
          <Text key={item.id}>{item.title}</Text>
        ))}
        {props.running.map((item) => (
          <Text key={item.id}>{item.title}</Text>
        ))}
        {props.done.map((item) => (
          <Text key={item.id}>{item.title}</Text>
        ))}
        {props.isLoadingMore ? <Text>Loading more activity</Text> : null}
        {props.loadMoreError ? <Text>Load more failed: {props.loadMoreError}</Text> : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Load more activity"
          onPress={props.onLoadMore}
        >
          <Text>Load More</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry loading more activity"
          onPress={props.onRetryLoadMore}
        >
          <Text>Retry More</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh activity"
          onPress={props.onRefresh}
        >
          <Text>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Switch Activity filter"
          onPress={props.onFilterChange}
        >
          <Text>Switch Filter</Text>
        </TouchableOpacity>
      </View>
    );
  };
});

function configuredEndpoints(): Endpoint[] {
  return [
    {
      id: 'ep-1',
      label: 'Office Mac',
      base_url: 'http://office.local:8765',
      token: 'tok-office',
      last_seen_at: null,
    },
  ];
}

function activityResult(titles: string[]): AggregatedActivityResult {
  return {
    needsAttention: titles.map((title, index) => ({
      id: `ep-1:attention:conv-${index}:ask-${index}`,
      source_id: `attention:conv-${index}:ask-${index}`,
      section: 'attention',
      conversation_id: `conv-${index}`,
      agent_id: 'agent-1',
      agent_name: 'Deploy Project',
      title,
      subtitle: 'Ship release notes',
      status_label: 'Pending',
      tone: 'attention',
      timestamp: 3000 - index,
      ask_id: `ask-${index}`,
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    })),
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

function setAppState(state: string) {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

function renderActivity() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityTab />
    </QueryClientProvider>,
  );
}

describe('ActivityTab pagination integration', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockPush.mockReset();
    mockAggregateActivity.mockReset();
    mockMarkDoneActivityRead.mockReset();
    mockMarkAllDoneActivityRead.mockReset();
    mockAbortConversation.mockReset();
    mockDeleteConversation.mockReset();
    mockUseActivityEvents.mockReset();
    mockEndpoints = configuredEndpoints();
    mockAggregateActivity.mockResolvedValue(activityResult(['First decision']));
    mockMarkDoneActivityRead.mockResolvedValue(undefined);
    mockMarkAllDoneActivityRead.mockResolvedValue(undefined);
    mockAbortConversation.mockResolvedValue(undefined);
    mockDeleteConversation.mockResolvedValue(undefined);
    mockRemoveAppStateListener.mockReset();
    setAppState('active');
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
      return { remove: mockRemoveAppStateListener };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /// First page integration: ActivityTab must use the pagination first-page limit.
  ///
  /// Data construction:
  ///   endpoints = [ep-1]
  ///   first page limit = 20（SPEC page size）
  ///   response titles = ["First decision"]
  ///
  /// Execution process:
  ///   1. Render ActivityTab inside QueryClientProvider.
  ///   2. Wait for the first decision row.
  ///   3. Inspect aggregateActivity arguments.
  ///
  /// Expected result:
  ///   - Positive: aggregateActivity is called with endpoints and limit 20.
  ///   - Positive: first-page data is rendered.
  ///   - Negative: the old aggregateActivity(endpoints) call shape is not used.
  it('requests the first Activity page with limit 20', async () => {
    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });

    expect({
      actual: mockAggregateActivity.mock.calls[0],
      reason: 'ActivityTab should request the first paginated Activity window',
    }).toEqual({ actual: [mockEndpoints, 20], reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[0].length,
      reason: 'ActivityTab must not call aggregateActivity with the old implicit default limit',
    }).toEqual({ actual: 2, reason: expect.any(String) });
  });

  /// Load more integration: ActivityTab requests the next cumulative page.
  ///
  /// Data construction:
  ///   first page titles  = ["First decision"] from limit 20
  ///   second page titles = ["First decision", "Second decision"] from limit 40
  ///   next limit         = 20 + 20 = 40
  ///
  /// Execution process:
  ///   1. Render ActivityTab and wait for first page.
  ///   2. Press the mocked ActivityScreen load-more control.
  ///   3. Wait for second page data.
  ///
  /// Expected result:
  ///   - Positive: second request uses limit 40.
  ///   - Positive: second decision renders.
  ///   - Negative: first decision is not duplicated after cumulative merge.
  it('requests limit 40 when the screen loads more Activity', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult(['First decision']))
      .mockResolvedValueOnce(activityResult(['First decision', 'Second decision']));

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Load more activity'));
    });
    await waitFor(() => {
      expect(screen.getByText('Second decision')).toBeTruthy();
    });

    expect({
      actual: mockAggregateActivity.mock.calls[1],
      reason: 'load-more should request the next cumulative Activity limit',
    }).toEqual({ actual: [mockEndpoints, 40], reason: expect.any(String) });
    expect({
      actual: screen.getAllByText('First decision').length,
      reason: 'cumulative page overlap must not duplicate already loaded rows',
    }).toEqual({ actual: 1, reason: expect.any(String) });
  });

  /// Load more failure: ActivityTab keeps existing rows and forwards retry state.
  ///
  /// Data construction:
  ///   first page = ["First decision"]
  ///   second page = Error("offline")
  ///
  /// Execution process:
  ///   1. Render ActivityTab and wait for first page.
  ///   2. Press load-more and let the second request fail.
  ///   3. Inspect row visibility and error text from ActivityScreen props.
  ///
  /// Expected result:
  ///   - Positive: first decision remains rendered.
  ///   - Positive: load-more error is displayed.
  ///   - Negative: a failed next page does not clear first-page data.
  it('keeps loaded rows visible and forwards load-more errors', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult(['First decision']))
      .mockRejectedValueOnce(new Error('offline'));

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Load more activity'));
    });

    expect({
      actual: screen.getByText('First decision') != null,
      reason: 'first-page row should stay visible after a load-more failure',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.getByText('Load more failed: offline') != null,
      reason: 'ActivityScreen should receive load-more failure text for retry UI',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Second decision') == null,
      reason: 'failed load-more should not invent rows from the rejected page',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// Pull refresh integration: manual refresh reloads the first page limit.
  ///
  /// Data construction:
  ///   first page title  = "First decision"
  ///   refresh page title = "Refreshed decision"
  ///   refresh limit     = 20
  ///
  /// Execution process:
  ///   1. Render ActivityTab and wait for the first page.
  ///   2. Press the mocked refresh control.
  ///   3. Inspect the second aggregateActivity call.
  ///
  /// Expected result:
  ///   - Positive: refresh issues another limit 20 request.
  ///   - Positive: refreshed row renders.
  ///   - Negative: refresh does not request limit 40 unless the user asked to load more.
  it('refreshes Activity by reloading the first page', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult(['First decision']))
      .mockResolvedValueOnce(activityResult(['Refreshed decision']));

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Refresh activity'));
    });
    await waitFor(() => {
      expect(screen.getByText('Refreshed decision')).toBeTruthy();
    });

    expect({
      actual: mockAggregateActivity.mock.calls[1],
      reason: 'manual refresh should reload the first Activity page',
    }).toEqual({ actual: [mockEndpoints, 20], reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[1][1] === 40,
      reason: 'manual refresh should not advance pagination by itself',
    }).toEqual({ actual: false, reason: expect.any(String) });
  });

  /// Pull refresh after load-more: manual refresh resets the Activity limit to page one.
  ///
  /// Data construction:
  ///   first page title   = "First decision" from limit 20
  ///   second page title  = "Second decision" from limit 40
  ///   refresh page title = "Refreshed decision" from limit 20
  ///
  /// Execution process:
  ///   1. Render ActivityTab and wait for the first page.
  ///   2. Press the load-more control to request limit 40.
  ///   3. Press the refresh control.
  ///   4. Inspect the third aggregateActivity call and rendered rows.
  ///
  /// Expected result:
  ///   - Positive: refresh after load-more requests limit 20.
  ///   - Positive: refreshed first-page row renders.
  ///   - Negative: refresh does not request limit 40 or keep the second-page-only row visible.
  it('resets pagination to page one when refreshed after load more', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult(['First decision']))
      .mockResolvedValueOnce(activityResult(['First decision', 'Second decision']))
      .mockResolvedValueOnce(activityResult(['Refreshed decision']));

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Load more activity'));
    });
    await waitFor(() => {
      expect(screen.getByText('Second decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Refresh activity'));
    });
    await waitFor(() => {
      expect(screen.getByText('Refreshed decision')).toBeTruthy();
    });

    expect({
      actual: mockAggregateActivity.mock.calls[2],
      reason: 'manual refresh after load-more should request the first Activity page again',
    }).toEqual({ actual: [mockEndpoints, 20], reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[2][1] === 40,
      reason: 'manual refresh after load-more must not keep requesting the second cumulative limit',
    }).toEqual({ actual: false, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Second decision') == null,
      reason: 'second-page-only rows should not remain visible after first-page refresh',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// Filter refetch integration: switching an Activity filter refreshes cached pages silently.
  ///
  /// Data construction:
  ///   first page title           = "First decision" from limit 20
  ///   second page title          = "Second decision" from limit 40
  ///   filter refetch page 1      = "Refetched first decision" from limit 20
  ///   filter refetch page 2      = "Refetched first decision" + "Refetched second decision" from limit 40
  ///
  /// Execution process:
  ///   1. Render ActivityTab and load the second cumulative page.
  ///   2. Press the mocked filter switch control.
  ///   3. Inspect the filter-triggered refetch calls and rendered rows.
  ///
  /// Expected result:
  ///   - Positive: filter switch refreshes the already cached limit 20 page.
  ///   - Positive: filter switch also refreshes the already cached limit 40 page.
  ///   - Positive: refreshed second-page row renders after the silent refetch settles.
  ///   - Negative: filter switch does not reset pagination back to only the first page.
  it('silently refreshes cached Activity pages when the filter changes', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult(['First decision']))
      .mockResolvedValueOnce(activityResult(['First decision', 'Second decision']))
      .mockResolvedValueOnce(activityResult(['Refetched first decision']))
      .mockResolvedValueOnce(
        activityResult(['Refetched first decision', 'Refetched second decision']),
      );

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText('First decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Load more activity'));
    });
    await waitFor(() => {
      expect(screen.getByText('Second decision')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Switch Activity filter'));
    });
    await waitFor(() => {
      expect(screen.getByText('Refetched second decision')).toBeTruthy();
    });

    expect({
      actual: mockAggregateActivity.mock.calls[2],
      reason: 'filter changes should refresh the first cached Activity page',
    }).toEqual({ actual: [mockEndpoints, 20], reason: expect.any(String) });
    expect({
      actual: mockAggregateActivity.mock.calls[3],
      reason:
        'filter changes should refresh the second cached Activity page instead of dropping it',
    }).toEqual({ actual: [mockEndpoints, 40], reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Second decision') == null,
      reason: 'old second-page data should be replaced by refreshed second-page data',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });
});
