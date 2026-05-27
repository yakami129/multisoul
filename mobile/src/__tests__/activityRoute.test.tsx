import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, RefreshControl, StyleSheet } from 'react-native';
import { type AggregatedActivityResult } from '@/features/activity/services/activityService';
import { type Endpoint } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockPush = jest.fn();
const mockAggregateActivity = jest.fn();
const mockMarkDoneActivityRead = jest.fn();
const mockMarkAllDoneActivityRead = jest.fn();
const mockAbortConversation = jest.fn();
const mockDeleteConversation = jest.fn();
let mockEndpoints: Endpoint[] = [];
let appStateHandler: ((state: string) => void) | null = null;
const mockRemoveAppStateListener = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => callback(), [callback]);
  },
  useRouter: () => ({ push: mockPush }),
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

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions?.()}
      </View>
    ),
  };
});

jest.mock('@/store/endpointStore', () => ({
  useEndpointStore: (selector: (state: { endpoints: Endpoint[] }) => unknown) =>
    selector({ endpoints: mockEndpoints }),
}));

function setAppState(state: string) {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

function activityResult(
  overrides: Partial<AggregatedActivityResult> = {},
): AggregatedActivityResult {
  return {
    needsAttention: [
      {
        id: 'ep-1:attention:conv-pending:ask-1',
        source_id: 'attention:conv-pending:ask-1',
        section: 'attention',
        conversation_id: 'conv-pending',
        agent_id: 'agent-1',
        agent_name: 'Deploy Project',
        title: 'Deploy now?',
        subtitle: 'Ship release notes',
        status_label: 'Pending',
        tone: 'attention',
        timestamp: 3000,
        ask_id: 'ask-1',
        endpoint_id: 'ep-1',
        endpoint_label: 'Office Mac',
      },
    ],
    running: [
      {
        id: 'ep-1:running:conv-running',
        source_id: 'running:conv-running',
        section: 'running',
        conversation_id: 'conv-running',
        agent_id: 'agent-2',
        agent_name: 'Auth Project',
        title: 'Tighten sign in states',
        subtitle: 'Checking state machine',
        status_label: 'Running',
        tone: 'running',
        timestamp: 2000,
        endpoint_id: 'ep-1',
        endpoint_label: 'Office Mac',
      },
    ],
    done: [
      {
        id: 'ep-2:done:conv-done',
        source_id: 'done:conv-done',
        section: 'done',
        conversation_id: 'conv-done',
        agent_id: 'agent-3',
        agent_name: 'Docs Project',
        title: 'Ship release notes',
        subtitle: 'Release notes are ready',
        status_label: 'Done',
        tone: 'done',
        timestamp: 1000,
        read_at: null,
        endpoint_id: 'ep-2',
        endpoint_label: 'Studio Mac',
      },
    ],
    failedEndpoints: [],
    ...overrides,
  };
}

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderActivity() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ActivityTab />
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('ActivityTab DB-backed aggregation', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockPush.mockReset();
    mockAggregateActivity.mockReset();
    mockMarkDoneActivityRead.mockReset();
    mockMarkAllDoneActivityRead.mockReset();
    mockAbortConversation.mockReset();
    mockDeleteConversation.mockReset();
    mockEndpoints = configuredEndpoints();
    mockAggregateActivity.mockResolvedValue(activityResult());
    mockMarkDoneActivityRead.mockResolvedValue(undefined);
    mockMarkAllDoneActivityRead.mockResolvedValue(undefined);
    mockAbortConversation.mockResolvedValue(undefined);
    mockDeleteConversation.mockResolvedValue(undefined);
    appStateHandler = null;
    mockRemoveAppStateListener.mockReset();
    setAppState('active');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      appStateHandler = handler as (state: string) => void;
      return { remove: mockRemoveAppStateListener };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /// First open aggregation: Activity requests every configured endpoint through the service.
  /// Data construction:
  ///   endpoints = ep-1 Office Mac + ep-2 Studio Mac
  ///   service result = pending + running + done sections from DB-backed Activity items
  /// Execution process:
  ///   1. Render ActivityTab while the tab is focused and the app is active.
  ///   2. Wait for the first focus refresh to resolve.
  ///   3. Inspect the service call and rendered rows.
  /// Expected result:
  ///   - Positive: aggregateActivity receives both configured endpoints.
  ///   - Positive: pending, running, and done items render.
  ///   - Negative: setup empty state is not shown when endpoints exist and data loads.
  it('loads all configured endpoints on first open and renders DB-backed sections', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Deploy now?')).toBeTruthy();
    });

    expect(mockAggregateActivity).toHaveBeenCalledWith(mockEndpoints, 20);
    expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    expect(screen.getAllByText('Ship release notes').length).toBeGreaterThanOrEqual(
      1,
      'done title or pending subtitle should render the release notes text',
    );
    expect(screen.queryByText('Connect an endpoint')).toBeNull();
  });

  /// Activity tabs: top filter exposes inventory counts and the Done unread marker.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   running        = 1 row
  ///   done           = 1 unread row (read_at = null)
  ///   total          = 1 + 1 + 1 = 3
  ///
  /// Execution process:
  ///   1. Render ActivityTab with one row per section.
  ///   2. Wait for the DB-backed aggregate to render.
  ///   3. Inspect top filter accessibility labels and Done unread marker.
  ///
  /// Expected result:
  ///   - Positive: All tab announces 3 total items.
  ///   - Positive: Pending, Running, and Done tabs announce their own counts.
  ///   - Positive: Done unread marker renders because the Done row has read_at=null.
  ///   - Negative: legacy section title "Needs Attention" is not shown in the All tab redesign.
  it('shows Activity tab counts and a Done unread marker on first render', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show All activity, 3 items')).toBeTruthy();
    });

    expect(screen.getByLabelText('Show Pending activity, 1 item')).toBeTruthy();
    expect(screen.getByLabelText('Show Running activity, 1 item')).toBeTruthy();
    expect(screen.getByLabelText('Show Done activity, 1 item, 1 unread')).toBeTruthy();
    expect(screen.getByTestId('activity-done-unread-dot')).toBeTruthy();
    expect(screen.queryByText('Needs Attention')).toBeNull();
  });

  /// Activity tabs visual hierarchy: top filter uses the prototype's raised pill surface.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   running        = 1 row
  ///   done           = 1 unread row
  ///   total          = 1 + 1 + 1 = 3
  ///
  /// Execution process:
  ///   1. Render ActivityTab with the default All filter selected.
  ///   2. Read the parent segmented-control style from the All tab button.
  ///   3. Read the active All tab button style and inactive Pending label style.
  ///
  /// Expected result:
  ///   - Positive: outer segmented control uses #1A1A1A, matching the prototype surface.
  ///   - Positive: selected tab uses #2A2A2A so it remains visibly raised.
  ///   - Positive: selected label is white.
  ///   - Negative: inactive Pending label is not promoted to white.
  it('uses the prototype color hierarchy for the Activity top filter', async () => {
    await renderActivity();

    const allTab = await screen.findByLabelText('Show All activity, 3 items');
    const segmentStyle = StyleSheet.flatten(
      screen.getByTestId('activity-filter-segment').props.style,
    );
    const allTabStyle = StyleSheet.flatten(allTab.props.style);
    const allTextStyle = StyleSheet.flatten(screen.getByText('All 3').props.style);
    const pendingTextStyle = StyleSheet.flatten(screen.getByText('Pending 1').props.style);

    expect(segmentStyle.backgroundColor).toBe('#1A1A1A');
    expect(allTabStyle.backgroundColor).toBe('#2A2A2A');
    expect(allTextStyle.color).toBe('#FFFFFF');
    expect(pendingTextStyle.color).toBe('#888888');
  });

  /// Done filter: Done-only view splits unread and read completion results.
  ///
  /// Data construction:
  ///   done unread = ep-2 / conv-done / read_at null
  ///   done read   = ep-1 / conv-read / read_at 1234
  ///   counts      = Unread 1, Read 1
  ///
  /// Execution process:
  ///   1. Render ActivityTab with one unread and one read Done item.
  ///   2. Open the Done filter.
  ///   3. Inspect Done-only segmented controls and visible rows.
  ///
  /// Expected result:
  ///   - Positive: Unread 1 and Read 1 controls render only inside Done.
  ///   - Positive: Mark All Read is visible while unread Done exists.
  ///   - Positive: unread Done row is visible by default.
  ///   - Negative: read Done row is hidden while the Unread sub-filter is active.
  it('splits Done items into Unread and Read sub-filters', async () => {
    mockAggregateActivity.mockResolvedValue(
      activityResult({
        needsAttention: [],
        running: [],
        done: [
          {
            id: 'ep-2:done:conv-done',
            source_id: 'done:conv-done',
            section: 'done',
            conversation_id: 'conv-done',
            agent_id: 'agent-3',
            agent_name: 'Docs Project',
            title: 'Unread result',
            subtitle: 'Release notes are ready',
            status_label: 'Done',
            tone: 'done',
            timestamp: 2000,
            read_at: null,
            endpoint_id: 'ep-2',
            endpoint_label: 'Studio Mac',
          },
          {
            id: 'ep-1:done:conv-read',
            source_id: 'done:conv-read',
            section: 'done',
            conversation_id: 'conv-read',
            agent_id: 'agent-1',
            agent_name: 'Deploy Project',
            title: 'Read result',
            subtitle: 'Already reviewed',
            status_label: 'Done',
            tone: 'done',
            timestamp: 1000,
            read_at: 1234,
            endpoint_id: 'ep-1',
            endpoint_label: 'Office Mac',
          },
        ],
      }),
    );

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Done activity, 2 items, 1 unread')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Show Done activity, 2 items, 1 unread'));

    expect(screen.getByText('Unread 1')).toBeTruthy();
    expect(screen.getByText('Read 1')).toBeTruthy();
    expect(screen.getByLabelText('Mark all Done items read')).toBeTruthy();
    expect(screen.getByText('Unread result')).toBeTruthy();
    expect(screen.queryByText('Read result')).toBeNull();
  });

  /// Done filter interaction: Unread remains selectable even when the unread count is zero.
  ///
  /// Data construction:
  ///   done unread = 0 rows
  ///   done read   = 1 row (read_at = 1234)
  ///   counts      = Unread 0, Read 1
  ///
  /// Execution process:
  ///   1. Render ActivityTab with only read Done rows.
  ///   2. Open the Done filter, which defaults to Read because unread count is zero.
  ///   3. Press the Unread 0 segment.
  ///
  /// Expected result:
  ///   - Positive: read row is visible when Done opens with zero unread rows.
  ///   - Positive: pressing Unread 0 switches to the empty unread list.
  ///   - Negative: Read row must not remain visible after the user explicitly selects Unread.
  it('allows selecting Unread even when all Done items are already read', async () => {
    mockAggregateActivity.mockResolvedValue(
      activityResult({
        needsAttention: [],
        running: [],
        done: [
          {
            id: 'ep-1:done:conv-read',
            source_id: 'done:conv-read',
            section: 'done',
            conversation_id: 'conv-read',
            agent_id: 'agent-1',
            agent_name: 'Deploy Project',
            title: 'Read only result',
            subtitle: 'Already reviewed',
            status_label: 'Done',
            tone: 'done',
            timestamp: 1000,
            read_at: 1234,
            endpoint_id: 'ep-1',
            endpoint_label: 'Office Mac',
          },
        ],
      }),
    );

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Done activity, 1 item')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Show Done activity, 1 item'));

    expect(screen.getByText('Unread 0')).toBeTruthy();
    expect(screen.getByText('Read 1')).toBeTruthy();
    expect(screen.getByText('Read only result')).toBeTruthy();

    fireEvent.press(screen.getByText('Unread 0'));

    expect(screen.queryByText('Read only result')).toBeNull();
    expect(screen.getByText('No recent results.')).toBeTruthy();
  });

  /// Done open behavior: opening an unread Done row marks it read optimistically and still navigates.
  ///
  /// Data construction:
  ///   unread Done row = ep-2 / conv-done / agent-3 / read_at null
  ///   endpoint ep-2   = http://studio.local:8765 / tok-studio
  ///
  /// Execution process:
  ///   1. Render ActivityTab and switch to Done.
  ///   2. Press the unread Done row.
  ///   3. Inspect mark-read call and route navigation.
  ///
  /// Expected result:
  ///   - Positive: markDoneActivityRead is called with ep-2 and conv-done.
  ///   - Positive: navigation to the conversation still happens.
  ///   - Negative: running/pending answer focus is not added to the Done route.
  it('marks an unread Done item read when opening it and then navigates', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Done activity, 1 item, 1 unread')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Show Done activity, 1 item, 1 unread'));
    fireEvent.press(screen.getByLabelText('Open Ship release notes'));

    expect(mockMarkDoneActivityRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ep-2', token: 'tok-studio' }),
      'conv-done',
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-done?endpoint_id=ep-2&agent_id=agent-3&agent_name=Docs%20Project',
    );
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('focus_ask_id='));
  });

  /// Done read failure: rejected mark-read must restore the server's unread state.
  ///
  /// Data construction:
  ///   initial Done row        = ep-2 / conv-done / read_at null
  ///   filter-reset Done row   = ep-2 / conv-done / read_at null
  ///   markDoneActivityRead   = Error("read failed")
  ///   failure-refetch row    = ep-2 / conv-done / read_at null
  ///
  /// Execution process:
  ///   1. Render ActivityTab and switch to the Done filter.
  ///   2. Switch to the Done filter, which refreshes page one.
  ///   3. Open the unread Done row, which applies a local read override.
  ///   4. Let markDoneActivityRead reject and wait for the failure refetch.
  ///   5. Inspect Done unread state after the refetch settles.
  ///
  /// Expected result:
  ///   - Positive: the refetched server unread state is visible again.
  ///   - Positive: Done filter announces one unread item after the failed mutation.
  ///   - Negative: the local optimistic read override does not persist after failure.
  it('restores unread Done state when marking a Done item read fails', async () => {
    mockMarkDoneActivityRead.mockRejectedValueOnce(new Error('read failed'));
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockResolvedValueOnce(activityResult())
      .mockResolvedValueOnce(activityResult());

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Done activity, 1 item, 1 unread')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Show Done activity, 1 item, 1 unread'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Open Ship release notes'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(3);
    });

    expect({
      actual: screen.getByLabelText('Show Done activity, 1 item, 1 unread') != null,
      reason: 'failed read mutation should restore the server unread count after refetch',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.getByText('Unread 1') != null,
      reason: 'Done sub-filter should return to one unread row after read failure',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Unread 0') == null,
      reason: 'optimistic read override must not persist after mark-read failure',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// Mark all read: Done action sends one read-all request per endpoint that owns unread Done rows.
  ///
  /// Data construction:
  ///   unread Done rows = ep-2 / conv-done only
  ///   read Done rows   = none in ep-1
  ///
  /// Execution process:
  ///   1. Render ActivityTab and switch to Done.
  ///   2. Press Mark All Read.
  ///   3. Inspect endpoint mutation calls.
  ///
  /// Expected result:
  ///   - Positive: markAllDoneActivityRead is called once for ep-2.
  ///   - Negative: ep-1 is not called because it has no unread Done row.
  ///   - Negative: markDoneActivityRead is not used for the bulk action.
  it('marks all unread Done items read for endpoints that have unread Done rows', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Done activity, 1 item, 1 unread')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Show Done activity, 1 item, 1 unread'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Mark all Done items read'));
      await Promise.resolve();
    });

    expect(mockMarkAllDoneActivityRead).toHaveBeenCalledTimes(1);
    expect(mockMarkAllDoneActivityRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ep-2', token: 'tok-studio' }),
    );
    expect(mockMarkAllDoneActivityRead).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ep-1' }),
    );
    expect(mockMarkDoneActivityRead).not.toHaveBeenCalled();
  });

  /// Route construction: every Activity item opens the matching endpoint Chat detail route.
  /// Data construction:
  ///   pending item = ep-1 / agent-1 / conv-pending / ask-1
  ///   running item = ep-1 / agent-2 / conv-running / no ask
  ///   done item    = ep-2 / agent-3 / conv-done / no ask
  /// Execution process:
  ///   1. Render all three sections from the Activity API aggregate.
  ///   2. Press each rendered row.
  ///   3. Inspect pushed routes.
  /// Expected result:
  ///   - Positive: pending route includes endpoint_id, agent_id, agent_name, and focus_ask_id.
  ///   - Positive: running route includes endpoint_id, agent_id, and agent_name.
  ///   - Positive: done route uses its own endpoint_id.
  ///   - Negative: running/done routes do not include focus_ask_id.
  it('opens pending, running, and done items with endpoint-aware chat routes', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Open Deploy now?')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Open Deploy now?'));
    fireEvent.press(screen.getByLabelText('Open Tighten sign in states'));
    fireEvent.press(screen.getByLabelText('Open Ship release notes'));

    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-pending?endpoint_id=ep-1&agent_id=agent-1&agent_name=Deploy%20Project&focus_ask_id=ask-1',
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-running?endpoint_id=ep-1&agent_id=agent-2&agent_name=Auth%20Project',
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-done?endpoint_id=ep-2&agent_id=agent-3&agent_name=Docs%20Project',
    );
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining('conv-running?endpoint_id=ep-1&focus_ask_id='),
    );
  });

  /// Activity swipe actions: all visible Activity sections expose one DELETE action per row.
  ///
  /// Data construction:
  ///   needsAttention = conv-pending
  ///   running        = conv-running
  ///   done           = conv-done
  ///   mocked Swipeable renders renderRightActions immediately
  ///
  /// Execution process:
  ///   1. Render ActivityTab with one item in each section.
  ///   2. Query the visible DELETE labels.
  ///
  /// Expected result:
  ///   - Positive: three DELETE buttons render, one per Activity row.
  ///   - Negative: the empty Activity state is not shown while rows exist.
  it('renders DELETE swipe actions for Activity items in every section', async () => {
    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Deploy now?')).toBeTruthy();
    });

    expect(screen.getAllByText('DELETE')).toHaveLength(3);
    expect(screen.queryByText('All caught up')).toBeNull();
  });

  /// Activity pending deletion: attention rows must stop the conversation before deleting it.
  ///
  /// Data construction:
  ///   DELETE target = attention conv-pending on ep-1
  ///   endpoint ep-1 = http://office.local:8765 / tok-office
  ///   refresh result after delete = no pending row, running + done remain
  ///
  /// Execution process:
  ///   1. Render ActivityTab with pending/running/done rows.
  ///   2. Press the first DELETE action, which belongs to the pending row.
  ///   3. Wait for abort, delete, and refresh to complete.
  ///
  /// Expected result:
  ///   - Positive: abortConversation is called before deleteConversation for conv-pending.
  ///   - Positive: deleteConversation uses ep-1 credentials and conv-pending.
  ///   - Positive: the pending row disappears after refresh.
  ///   - Negative: delete is not attempted before abort.
  it('aborts then deletes an attention Activity item and refreshes it away', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockResolvedValueOnce(activityResult({ needsAttention: [] }));

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Deploy now?')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getAllByText('DELETE')[0]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith(
        'http://office.local:8765',
        'tok-office',
        'conv-pending',
      );
    });

    expect(mockAbortConversation).toHaveBeenCalledWith(
      'http://office.local:8765',
      'tok-office',
      'conv-pending',
    );
    expect(mockAbortConversation.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteConversation.mock.invocationCallOrder[0],
    );
    await waitFor(() => {
      expect(screen.queryByText('Deploy now?')).toBeNull();
    });
  });

  /// Activity running deletion: running rows follow the same stop-before-delete policy.
  ///
  /// Data construction:
  ///   DELETE target = running conv-running on ep-1
  ///   refresh result after delete = pending + done remain, running removed
  ///
  /// Execution process:
  ///   1. Render ActivityTab.
  ///   2. Press the second DELETE action, which belongs to the running row.
  ///   3. Inspect service calls and refreshed UI.
  ///
  /// Expected result:
  ///   - Positive: abortConversation is called for conv-running.
  ///   - Positive: deleteConversation is called for conv-running.
  ///   - Positive: the running row disappears after refresh.
  ///   - Negative: the pending row remains visible.
  it('aborts then deletes a running Activity item', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockResolvedValueOnce(activityResult({ running: [] }));

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getAllByText('DELETE')[1]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith(
        'http://office.local:8765',
        'tok-office',
        'conv-running',
      );
    });

    expect(mockAbortConversation).toHaveBeenCalledWith(
      'http://office.local:8765',
      'tok-office',
      'conv-running',
    );
    await waitFor(() => {
      expect(screen.queryByText('Tighten sign in states')).toBeNull();
    });
    expect(screen.getByText('Deploy now?')).toBeTruthy();
  });

  /// Activity done deletion: completed rows delete directly without aborting.
  ///
  /// Data construction:
  ///   DELETE target = done conv-done on ep-2
  ///   endpoint ep-2 = http://studio.local:8765 / tok-studio
  ///   refresh result after delete = pending + running remain, done removed
  ///
  /// Execution process:
  ///   1. Render ActivityTab with all sections.
  ///   2. Press the third DELETE action, which belongs to the done row.
  ///   3. Inspect service calls and refreshed UI.
  ///
  /// Expected result:
  ///   - Positive: deleteConversation uses ep-2 credentials and conv-done.
  ///   - Positive: the done row disappears after refresh.
  ///   - Negative: abortConversation is not called for completed Activity.
  it('deletes a done Activity item without aborting', async () => {
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockResolvedValueOnce(activityResult({ done: [] }));

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Open Ship release notes')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getAllByText('DELETE')[2]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith(
        'http://studio.local:8765',
        'tok-studio',
        'conv-done',
      );
    });

    expect(mockAbortConversation).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByLabelText('Open Ship release notes')).toBeNull();
    });
  });

  /// Activity delete failure: failed delete calls must leave the Activity row visible.
  ///
  /// Data construction:
  ///   DELETE target = done conv-done
  ///   deleteConversation rejects with a network error
  ///
  /// Execution process:
  ///   1. Render ActivityTab.
  ///   2. Press the done row DELETE action.
  ///   3. Let the rejected promise settle.
  ///
  /// Expected result:
  ///   - Positive: deleteConversation is attempted for conv-done.
  ///   - Positive: the done row remains visible after the failure.
  ///   - Negative: no refresh request is made after a failed delete.
  it('keeps an Activity item visible when delete fails', async () => {
    mockDeleteConversation.mockRejectedValueOnce(new Error('delete failed'));

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Open Ship release notes')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getAllByText('DELETE')[2]);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith(
        'http://studio.local:8765',
        'tok-studio',
        'conv-done',
      );
    });

    expect(screen.getByLabelText('Open Ship release notes')).toBeTruthy();
    expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
  });

  /// Partial endpoint failure: successful endpoint rows remain visible with retry affordance.
  /// Data construction:
  ///   ep-1 = one running Activity item
  ///   ep-2 = failed endpoint label "Studio Mac"
  /// Execution process:
  ///   1. Render an aggregate result with running data plus one failed endpoint.
  ///   2. Wait for the successful row.
  ///   3. Press the partial failure Retry control.
  /// Expected result:
  ///   - Positive: the successful running item renders.
  ///   - Positive: failed endpoint label is displayed.
  ///   - Positive: Retry triggers another aggregate request.
  ///   - Negative: the global all-failed error does not render for partial failure.
  it('renders partial endpoint failures without blocking successful sections and retries', async () => {
    mockAggregateActivity.mockResolvedValue(
      activityResult({
        needsAttention: [],
        done: [],
        failedEndpoints: [{ endpoint_id: 'ep-2', endpoint_label: 'Studio Mac' }],
      }),
    );

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    });

    expect(screen.getByText('Some endpoints failed: Studio Mac')).toBeTruthy();
    expect(screen.queryByText('Could not load activity')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Retry failed endpoints'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
  });

  /// Partial empty failure: failed endpoint labels still render when successful endpoints are empty.
  /// Data construction:
  ///   ep-1 = successful Activity response with no rows
  ///   ep-2 = failed endpoint label "Studio Mac"
  /// Execution process:
  ///   1. Render an aggregate result with empty sections and one failed endpoint.
  ///   2. Inspect the empty state and partial failure banner.
  /// Expected result:
  ///   - Positive: the failed endpoint label is exposed with Retry.
  ///   - Positive: the non-error empty state remains visible.
  ///   - Negative: the global all-failed error is not shown because at least one endpoint succeeded.
  it('shows partial endpoint failures even when successful endpoints return no rows', async () => {
    mockAggregateActivity.mockResolvedValue(
      activityResult({
        needsAttention: [],
        running: [],
        done: [],
        failedEndpoints: [{ endpoint_id: 'ep-2', endpoint_label: 'Studio Mac' }],
      }),
    );

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Some endpoints failed: Studio Mac')).toBeTruthy();
    });

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByLabelText('Retry failed endpoints')).toBeTruthy();
    expect(screen.queryByText('Could not load activity')).toBeNull();
  });

  /// All endpoint failure: Activity shows a retryable global error.
  /// Data construction:
  ///   endpoints = ep-1 + ep-2
  ///   sections  = all empty
  ///   failures  = ep-1 + ep-2
  /// Execution process:
  ///   1. Render Activity with both endpoint requests reported as failed.
  ///   2. Wait for the global error state.
  ///   3. Press Retry.
  /// Expected result:
  ///   - Positive: the global error state renders.
  ///   - Positive: Retry triggers another aggregate request.
  ///   - Negative: the non-error setup state is not used for configured endpoint failures.
  it('renders a retryable global error when all endpoints fail', async () => {
    mockAggregateActivity.mockResolvedValue(
      activityResult({
        needsAttention: [],
        running: [],
        done: [],
        failedEndpoints: [
          { endpoint_id: 'ep-1', endpoint_label: 'Office Mac' },
          { endpoint_id: 'ep-2', endpoint_label: 'Studio Mac' },
        ],
      }),
    );

    await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Could not load activity')).toBeTruthy();
    });

    expect(screen.queryByText('Connect an endpoint')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Retry activity'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
  });

  /// No endpoint setup: empty configured endpoints are a setup state, not a failure.
  /// Data construction:
  ///   endpoints = []
  ///   aggregate service = should not be called because there is nothing to fetch
  /// Execution process:
  ///   1. Render ActivityTab with no configured endpoints.
  ///   2. Inspect the empty state.
  /// Expected result:
  ///   - Positive: setup guidance renders.
  ///   - Negative: aggregateActivity is not called.
  ///   - Negative: retryable error state is not shown.
  it('shows a non-error setup state when no endpoints are configured', async () => {
    mockEndpoints = [];

    await renderActivity();

    expect(screen.getByText('Connect an endpoint')).toBeTruthy();
    expect(mockAggregateActivity).not.toHaveBeenCalled();
    expect(screen.queryByText('Could not load activity')).toBeNull();
  });

  /// Pull-to-refresh: manual refresh requests all endpoints again.
  /// Data construction:
  ///   initial service result = one item in each section
  ///   manual refresh        = RefreshControl onRefresh callback
  /// Execution process:
  ///   1. Render Activity and wait for initial data.
  ///   2. Invoke the ScrollView RefreshControl callback.
  ///   3. Inspect service call count.
  /// Expected result:
  ///   - Positive: refresh calls aggregateActivity a second time.
  ///   - Negative: refresh does not call the old inbox/chat loaders.
  it('refreshes Activity through pull-to-refresh', async () => {
    const view = await renderActivity();

    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
    });

    const refreshControl = view.UNSAFE_getByType(RefreshControl);
    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
  });

  /// Focus refresh UI state: automatic Activity focus refresh must stay visually silent.
  ///
  /// Data construction:
  ///   endpoints = ep-1 Office Mac + ep-2 Studio Mac
  ///   request #1 = unresolved focus refresh promise
  ///   refreshing flag should remain false because the user did not pull to refresh
  ///
  /// Execution process:
  ///   1. Render ActivityTab while the tab is focused.
  ///   2. Keep the aggregate request pending so any refresh spinner would remain visible.
  ///   3. Inspect the ScrollView RefreshControl state.
  ///
  /// Expected result:
  ///   - Positive: aggregateActivity is called once, so focus data refresh still runs.
  ///   - Negative: RefreshControl.refreshing is false, so iOS does not show forced pull refresh UI.
  it('keeps focus refresh visually silent while data is in flight', async () => {
    const first = deferred<AggregatedActivityResult>();
    mockAggregateActivity.mockReturnValueOnce(first.promise);

    const view = await renderActivity();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockAggregateActivity).toHaveBeenCalledTimes(
      1,
      'focus refresh should still fetch Activity data on entry',
    );
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(
      false,
      'focus refresh must not drive the pull-to-refresh spinner',
    );

    await act(async () => {
      first.resolve(activityResult());
      await first.promise;
    });
  });

  /// Filter refetch UI state: switching Activity filters must not expose pull-to-refresh chrome.
  ///
  /// Data construction:
  ///   initial data       = 1 pending + 1 running + 1 done row
  ///   filter refetch     = unresolved promise after pressing the Running filter
  ///   refreshing flag    = false because the user did not perform a pull gesture
  ///
  /// Execution process:
  ///   1. Render ActivityTab and wait for the initial loaded list.
  ///   2. Press the Running filter, which refreshes page one while cached rows remain visible.
  ///   3. Keep the refetch unresolved and inspect the FlatList RefreshControl state.
  ///
  /// Expected result:
  ///   - Positive: aggregateActivity is called a second time for the filter reset.
  ///   - Positive: the Running row remains visible while the silent refetch is in flight.
  ///   - Negative: RefreshControl.refreshing stays false, so the top pull spinner is not shown.
  it('keeps filter-switch refetch visually silent while cached Activity remains visible', async () => {
    const filterRefetch = deferred<AggregatedActivityResult>();
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockReturnValueOnce(filterRefetch.promise);

    const view = await renderActivity();

    await waitFor(() => {
      expect(screen.getByLabelText('Show Running activity, 1 item')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Show Running activity, 1 item'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockAggregateActivity).toHaveBeenCalledTimes(
      2,
      'filter switch should still refetch the first Activity page',
    );
    expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(
      false,
      'filter-switch refetch must not drive the pull-to-refresh spinner',
    );

    await act(async () => {
      filterRefetch.resolve(activityResult());
      await filterRefetch.promise;
    });
  });

  /// Polling refetch UI state: interval refresh must update data without forced pull UI.
  ///
  /// Data construction:
  ///   interval        = 15_000ms
  ///   initial data    = 1 pending + 1 running + 1 done row
  ///   poll refetch    = unresolved promise after one interval tick
  ///   refreshing flag = false because polling is background refresh, not manual pull refresh
  ///
  /// Execution process:
  ///   1. Render ActivityTab with fake timers and wait for initial data.
  ///   2. Advance timers by one polling interval.
  ///   3. Keep the polling request unresolved and inspect the FlatList RefreshControl state.
  ///
  /// Expected result:
  ///   - Positive: polling starts a second aggregateActivity call after 15 seconds.
  ///   - Positive: existing Activity rows remain visible during the poll.
  ///   - Negative: RefreshControl.refreshing stays false, preventing the top spinner regression.
  it('keeps polling refetch visually silent while cached Activity remains visible', async () => {
    jest.useFakeTimers();
    const pollRefetch = deferred<AggregatedActivityResult>();
    mockAggregateActivity
      .mockResolvedValueOnce(activityResult())
      .mockReturnValueOnce(pollRefetch.promise);

    const view = await renderActivity();

    await waitFor(() => {
      expect(screen.getByText('Deploy now?')).toBeTruthy();
    });
    await act(async () => {
      jest.advanceTimersByTime(15_000);
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(mockAggregateActivity).toHaveBeenCalledTimes(
      2,
      'foreground polling should refetch Activity after one interval',
    );
    expect(screen.getByText('Deploy now?')).toBeTruthy();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(
      false,
      'polling refetch must not drive the pull-to-refresh spinner',
    );

    await act(async () => {
      pollRefetch.resolve(activityResult());
      await pollRefetch.promise;
    });
  });

  /// Visible polling: focused foreground Activity refreshes every 15 seconds and stops on unmount.
  /// Data construction:
  ///   interval = 15_000ms
  ///   first focus refresh = call #1
  ///   first interval tick = call #2
  /// Execution process:
  ///   1. Render Activity with fake timers.
  ///   2. Advance timers by 15 seconds.
  ///   3. Unmount and advance another 15 seconds.
  /// Expected result:
  ///   - Positive: the visible interval triggers exactly one extra request.
  ///   - Positive: AppState listener is removed on unmount.
  ///   - Negative: no polling request is made after unmount.
  it('polls every 15 seconds while visible and stops on unmount', async () => {
    jest.useFakeTimers();
    const view = await renderActivity();

    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
    });

    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
    });

    view.unmount();
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(mockRemoveAppStateListener).toHaveBeenCalledTimes(1);
    expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
  });

  /// Background lifecycle: polling stops while the app is not active.
  /// Data construction:
  ///   app state active     = initial visible Activity state
  ///   app state background = should clear polling interval
  ///   interval             = 15_000ms
  /// Execution process:
  ///   1. Render Activity and wait for initial refresh.
  ///   2. Dispatch AppState "background".
  ///   3. Advance timers past one poll interval.
  /// Expected result:
  ///   - Positive: initial active refresh runs.
  ///   - Negative: no interval refresh runs while backgrounded.
  it('stops polling when the app enters the background', async () => {
    jest.useFakeTimers();
    await renderActivity();

    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
    });

    act(() => {
      appStateHandler?.('background');
    });
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
  });

  /// In-flight guard: polling never starts overlapping requests.
  /// Data construction:
  ///   request #1 = unresolved promise from initial focus refresh
  ///   interval   = 15_000ms
  ///   request #2 = allowed only after request #1 settles
  /// Execution process:
  ///   1. Render Activity with the first aggregate request pending.
  ///   2. Advance two polling intervals while request #1 is still pending.
  ///   3. Resolve request #1 and advance one more interval.
  /// Expected result:
  ///   - Positive: only request #1 exists while it is in flight.
  ///   - Positive: request #2 starts after request #1 settles and the next interval fires.
  ///   - Negative: no overlapping request is created during the pending window.
  it('avoids overlapping polling requests when a prior fetch is in flight', async () => {
    jest.useFakeTimers();
    const first = deferred<AggregatedActivityResult>();
    mockAggregateActivity.mockReturnValueOnce(first.promise);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityTab />
      </QueryClientProvider>,
    );

    expect(mockAggregateActivity).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockAggregateActivity).toHaveBeenCalledTimes(
      1,
      'polling should not overlap while the first fetch is unresolved',
    );

    await act(async () => {
      first.resolve(activityResult());
      await first.promise;
    });
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    await waitFor(() => {
      expect(mockAggregateActivity).toHaveBeenCalledTimes(2);
    });
  });
});
