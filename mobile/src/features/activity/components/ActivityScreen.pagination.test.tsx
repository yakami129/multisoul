import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { FlatList } from 'react-native';
import ActivityScreen, { type ActivityItem } from './ActivityScreen';

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

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'attention-1',
    section: 'attention',
    projectName: 'Deploy Project',
    title: 'Deploy now?',
    subtitle: 'Ship release notes',
    statusLabel: 'Pending',
    tone: 'attention',
    timestamp: Date.now(),
    endpointId: 'ep-1',
    endpointLabel: 'Office Mac',
    conversationId: 'conv-1',
    agentId: 'agent-1',
    agentName: 'Deploy Project',
    resourceId: 'agent-1',
    resourceName: 'Deploy Project',
    askId: 'ask-1',
    readAt: null,
    ...overrides,
  };
}

describe('ActivityScreen pagination rendering', () => {
  /// Virtualized non-empty list: populated Activity must render through FlatList.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   running        = 0 rows
  ///   done           = 0 rows
  ///
  /// Execution process:
  ///   1. Render ActivityScreen with one visible row.
  ///   2. Read the non-empty list by test id.
  ///   3. Inspect its native component type and row text.
  ///
  /// Expected result:
  ///   - Positive: the non-empty list is a FlatList with testID activity-list.
  ///   - Positive: the row title renders.
  ///   - Negative: non-empty content does not use the old activity-scroll ScrollView id.
  it('renders non-empty Activity content with a FlatList', () => {
    render(
      <ActivityScreen needsAttention={[item()]} running={[]} done={[]} onOpenItem={jest.fn()} />,
    );

    const list = screen.UNSAFE_getByType(FlatList);

    expect({
      actual: list.props.testID,
      reason: 'non-empty Activity content should be virtualized through FlatList',
    }).toEqual({ actual: 'activity-list', reason: expect.any(String) });
    expect({
      actual: screen.getByText('Deploy now?') != null,
      reason: 'the Activity row should still render inside the virtualized list',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByTestId('activity-scroll') == null,
      reason: 'the old non-empty ScrollView test id should not be used for populated lists',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// End reached: FlatList bottom reach should ask the parent to load more when pages remain.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   hasMore        = true
  ///   onLoadMore     = jest mock with initial calls 0
  ///
  /// Execution process:
  ///   1. Render ActivityScreen with hasMore=true.
  ///   2. Invoke the FlatList onEndReached callback.
  ///   3. Inspect onLoadMore calls.
  ///
  /// Expected result:
  ///   - Positive: onLoadMore is called once.
  ///   - Negative: onRetryLoadMore is not called by normal scroll-end loading.
  it('calls onLoadMore when the FlatList reaches the end and more pages exist', () => {
    const onLoadMore = jest.fn();
    const onRetryLoadMore = jest.fn();
    render(
      <ActivityScreen
        needsAttention={[item()]}
        running={[]}
        done={[]}
        hasMore
        onLoadMore={onLoadMore}
        onRetryLoadMore={onRetryLoadMore}
        onOpenItem={jest.fn()}
      />,
    );

    fireEvent(screen.getByTestId('activity-list'), 'onEndReached');

    expect({
      actual: onLoadMore.mock.calls.length,
      reason: 'scrolling to the end should trigger one load-more request',
    }).toEqual({ actual: 1, reason: expect.any(String) });
    expect({
      actual: onRetryLoadMore.mock.calls.length,
      reason: 'normal end-reached loading should not use the explicit retry callback',
    }).toEqual({ actual: 0, reason: expect.any(String) });
  });

  /// Loading footer: in-flight loadMore should show a stable footer spinner label.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   isLoadingMore  = true
  ///
  /// Execution process:
  ///   1. Render ActivityScreen with isLoadingMore=true.
  ///   2. Inspect footer loading text.
  ///
  /// Expected result:
  ///   - Positive: footer loading label renders.
  ///   - Negative: retry footer is not shown while loading is active.
  it('shows a footer loading state while more Activity is loading', () => {
    render(
      <ActivityScreen
        needsAttention={[item()]}
        running={[]}
        done={[]}
        isLoadingMore
        loadMoreError="offline"
        onOpenItem={jest.fn()}
      />,
    );

    expect({
      actual: screen.getByText('Loading more activity...') != null,
      reason: 'loading-more footer should communicate that pagination is in flight',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByLabelText('Retry loading more activity') == null,
      reason: 'retry footer should not be visible while loading-more is active',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// Retry footer: failed loadMore should expose a retry button without hiding loaded rows.
  ///
  /// Data construction:
  ///   needsAttention = 1 row
  ///   loadMoreError  = "offline"
  ///   onRetryLoadMore = jest mock with initial calls 0
  ///
  /// Execution process:
  ///   1. Render ActivityScreen with a load-more error.
  ///   2. Press the retry button.
  ///   3. Inspect row visibility and retry calls.
  ///
  /// Expected result:
  ///   - Positive: retry button renders and calls onRetryLoadMore once.
  ///   - Positive: already loaded row remains visible.
  ///   - Negative: loading footer is not shown for a settled error.
  it('shows a retry footer after load-more failure while keeping loaded rows visible', () => {
    const onRetryLoadMore = jest.fn();
    render(
      <ActivityScreen
        needsAttention={[item()]}
        running={[]}
        done={[]}
        loadMoreError="offline"
        onRetryLoadMore={onRetryLoadMore}
        onOpenItem={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Retry loading more activity'));

    expect({
      actual: onRetryLoadMore.mock.calls.length,
      reason: 'retry footer should call the explicit retry callback',
    }).toEqual({ actual: 1, reason: expect.any(String) });
    expect({
      actual: screen.getByText('Deploy now?') != null,
      reason: 'load-more errors must not hide already loaded rows',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Loading more activity...') == null,
      reason: 'loading footer should not be visible for a settled load-more error',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });

  /// Empty/all-failed states: non-list states keep their refreshable ScrollView containers.
  ///
  /// Data construction:
  ///   empty state     = no endpoints false? hasEndpoints=false and no rows
  ///   allFailed state = allFailed=true and no rows
  ///
  /// Execution process:
  ///   1. Render empty setup state and inspect activity-scroll.
  ///   2. Render all-failed state and inspect activity-scroll.
  ///
  /// Expected result:
  ///   - Positive: empty state keeps activity-scroll for refresh behavior.
  ///   - Positive: all-failed state keeps activity-scroll for refresh behavior.
  ///   - Negative: neither non-list state renders activity-list.
  it('keeps refreshable scroll containers for empty and all-failed states', () => {
    const empty = render(
      <ActivityScreen
        needsAttention={[]}
        running={[]}
        done={[]}
        hasEndpoints={false}
        onOpenItem={jest.fn()}
      />,
    );

    expect({
      actual: empty.getByTestId('activity-scroll') != null,
      reason: 'empty setup state should keep its refreshable ScrollView container',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: empty.queryByTestId('activity-list') == null,
      reason: 'empty setup state should not render the virtualized non-empty list',
    }).toEqual({ actual: true, reason: expect.any(String) });

    empty.unmount();
    render(
      <ActivityScreen
        needsAttention={[]}
        running={[]}
        done={[]}
        allFailed
        onOpenItem={jest.fn()}
      />,
    );

    expect({
      actual: screen.getByTestId('activity-scroll') != null,
      reason: 'all-failed state should keep its refreshable ScrollView container',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByTestId('activity-list') == null,
      reason: 'all-failed state should not render the virtualized non-empty list',
    }).toEqual({ actual: true, reason: expect.any(String) });
  });
});
