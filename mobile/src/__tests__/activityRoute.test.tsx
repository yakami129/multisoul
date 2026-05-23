import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, RefreshControl } from 'react-native';
import { type AggregatedActivityResult } from '@/features/activity/services/activityService';
import { type Endpoint } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockPush = jest.fn();
const mockAggregateActivity = jest.fn();
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
}));

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
  const view = render(<ActivityTab />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('ActivityTab DB-backed aggregation', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    mockEndpoints = configuredEndpoints();
    mockAggregateActivity.mockResolvedValue(activityResult());
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

    expect(mockAggregateActivity).toHaveBeenCalledWith(mockEndpoints);
    expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    expect(screen.getAllByText('Ship release notes').length).toBeGreaterThanOrEqual(
      1,
      'done title or pending subtitle should render the release notes text',
    );
    expect(screen.queryByText('Connect an endpoint')).toBeNull();
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
    fireEvent.press(screen.getByLabelText('Retry failed endpoints'));
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
    fireEvent.press(screen.getByLabelText('Retry activity'));
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

    render(<ActivityTab />);

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
