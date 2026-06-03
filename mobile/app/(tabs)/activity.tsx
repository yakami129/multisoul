import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityScreen, { type ActivityItem } from '@/features/activity/components/ActivityScreen';
import { useActivityInfiniteQuery } from '@/features/activity/hooks/useActivityInfiniteQuery';
import {
  markAllDoneActivityRead,
  markDoneActivityRead,
  type AggregatedActivityItem,
} from '@/features/activity/services/activityService';
import { abortConversation, deleteConversation } from '@/features/chat/services/chatService';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { brandColors } from '@/theme/brandRefresh';

const POLL_INTERVAL_MS = 15_000;

function toScreenItem(item: AggregatedActivityItem): ActivityItem {
  return {
    id: item.id,
    section: item.section,
    projectName: item.agent_name || item.endpoint_label,
    title: item.title,
    subtitle: item.subtitle,
    statusLabel: item.status_label,
    tone: item.tone,
    timestamp: item.timestamp,
    endpointId: item.endpoint_id,
    endpointLabel: item.endpoint_label,
    conversationId: item.conversation_id,
    agentId: item.agent_id,
    agentName: item.agent_name,
    workflowId: item.workflow_id,
    workflowRunId: item.workflow_run_id,
    workflowName: item.workflow_name,
    askId: item.ask_id,
    readAt: item.read_at ?? null,
  };
}

export default function ActivityTab() {
  const endpoints = useEndpointStore((s) => s.endpoints);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [readOverrides, setReadOverrides] = useState<Record<string, number>>({});
  const [hiddenConversationIds, setHiddenConversationIds] = useState<Set<string>>(() => new Set());
  const [isPullRefreshActive, setIsPullRefreshActive] = useState(false);
  const {
    activity,
    isRefreshing,
    isFetchingNextPage,
    hasNextPage,
    loadMoreError,
    refetch: refetchActivity,
    refreshFirstPage,
    fetchNextPage,
  } = useActivityInfiniteQuery({ endpoints, enabled: focused });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
      };
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!focused || appState !== 'active') return undefined;
    const timer = setInterval(() => {
      void refetchActivity();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [appState, focused, refetchActivity]);

  useEffect(() => {
    if (endpoints.length === 0) {
      setHiddenConversationIds(new Set());
      setReadOverrides({});
    }
  }, [endpoints.length]);

  const handlePullRefresh = useCallback(async () => {
    setIsPullRefreshActive(true);
    try {
      await refreshFirstPage();
      // After refresh, clear local read overrides since we have fresh server data
      setReadOverrides({});
    } finally {
      setIsPullRefreshActive(false);
    }
  }, [refreshFirstPage]);

  const applyLocalActivityState = (item: AggregatedActivityItem): AggregatedActivityItem | null => {
    if (hiddenConversationIds.has(item.conversation_id)) return null;
    const readAt = readOverrides[item.conversation_id];
    if (item.section === 'done' && readAt != null) return { ...item, read_at: readAt };
    return item;
  };
  const toVisibleScreenItems = (items: AggregatedActivityItem[]) =>
    items
      .map(applyLocalActivityState)
      .filter((item): item is AggregatedActivityItem => item != null)
      .map(toScreenItem);

  const needsAttention = toVisibleScreenItems(activity.needsAttention);
  const running = toVisibleScreenItems(activity.running);
  const done = toVisibleScreenItems(activity.done);
  const allFailed =
    endpoints.length > 0 &&
    activity.failedEndpoints.length === endpoints.length &&
    needsAttention.length + running.length + done.length === 0;

  const setDoneRead = (conversationIds: Set<string>, readAt: number) => {
    setReadOverrides((current) => {
      const next = { ...current };
      conversationIds.forEach((conversationId) => {
        next[conversationId] = readAt;
      });
      return next;
    });
  };

  const clearDoneReadOverrides = (conversationIds: Set<string>) => {
    setReadOverrides((current) => {
      const next = { ...current };
      conversationIds.forEach((conversationId) => {
        delete next[conversationId];
      });
      return next;
    });
  };

  const handleOpenItem = (item: ActivityItem) => {
    if (item.section === 'done' && item.readAt == null) {
      const endpoint = endpoints.find((ep) => ep.id === item.endpointId);
      const conversationIds = new Set([item.conversationId]);
      setDoneRead(conversationIds, Date.now());
      if (endpoint) {
        void markDoneActivityRead(endpoint, item.conversationId)
          .then(() => {
            // Success: clear local override since server now has the read state
            clearDoneReadOverrides(conversationIds);
          })
          .catch(() => {
            // Failure: revert local override and refresh
            clearDoneReadOverrides(conversationIds);
            return refetchActivity();
          });
      }
    }

    router.push(
      buildChatDetailPath({
        conversationId: item.conversationId,
        endpointId: item.endpointId,
        agentId: item.agentId,
        agentName: item.agentName,
        focusAskId: item.section === 'attention' ? item.askId : undefined,
      }),
    );
  };

  const handleMarkAllDoneRead = () => {
    const unreadDone = activity.done.filter((item) => item.read_at == null);
    if (unreadDone.length === 0) return;

    const unreadEndpointIds = new Set(unreadDone.map((item) => item.endpoint_id));
    const unreadConversationIds = new Set(unreadDone.map((item) => item.conversation_id));
    const unreadConversationIdsByEndpoint = new Map<string, Set<string>>();
    unreadDone.forEach((item) => {
      const conversationIds = unreadConversationIdsByEndpoint.get(item.endpoint_id) ?? new Set();
      conversationIds.add(item.conversation_id);
      unreadConversationIdsByEndpoint.set(item.endpoint_id, conversationIds);
    });
    setDoneRead(unreadConversationIds, Date.now());

    endpoints
      .filter((endpoint) => unreadEndpointIds.has(endpoint.id))
      .forEach((endpoint) => {
        void markAllDoneActivityRead(endpoint)
          .then(() => {
            // Success: clear local overrides since server now has the read state
            clearDoneReadOverrides(unreadConversationIdsByEndpoint.get(endpoint.id) ?? new Set());
          })
          .catch(() => {
            // Failure: revert local overrides and refresh
            clearDoneReadOverrides(unreadConversationIdsByEndpoint.get(endpoint.id) ?? new Set());
            return refetchActivity();
          });
      });
  };

  const removeActivityConversation = (conversationId: string) => {
    setHiddenConversationIds((current) => {
      const next = new Set(current);
      next.add(conversationId);
      return next;
    });
  };

  const handleDeleteItem = async (item: ActivityItem) => {
    const endpoint = endpoints.find((ep) => ep.id === item.endpointId);
    if (!endpoint) return;

    try {
      if (item.section === 'attention' || item.section === 'running') {
        await abortConversation(endpoint.base_url, endpoint.token, item.conversationId);
      }
      await deleteConversation(endpoint.base_url, endpoint.token, item.conversationId);
      removeActivityConversation(item.conversationId);
      removeConversation(item.conversationId);
      await refetchActivity();
    } catch {
      // Keep the Activity row visible when the endpoint refuses or loses the delete request.
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ActivityScreen
        needsAttention={needsAttention}
        running={running}
        done={done}
        failedEndpointLabels={activity.failedEndpoints.map((failure) => failure.endpoint_label)}
        hasEndpoints={endpoints.length > 0}
        allFailed={allFailed}
        onRetry={() => {
          void refreshFirstPage();
        }}
        onOpenItem={handleOpenItem}
        onMarkAllDoneRead={handleMarkAllDoneRead}
        onDeleteItem={(item) => {
          void handleDeleteItem(item);
        }}
        isRefreshing={isPullRefreshActive && isRefreshing}
        isLoadingMore={isFetchingNextPage}
        hasMore={hasNextPage}
        loadMoreError={loadMoreError?.message ?? null}
        onLoadMore={() => {
          void fetchNextPage();
        }}
        onRetryLoadMore={() => {
          void fetchNextPage();
        }}
        onFilterChange={() => {
          void refetchActivity();
        }}
        onRefresh={() => {
          void handlePullRefresh();
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brandColors.cream },
});
