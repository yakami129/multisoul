import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityScreen, { type ActivityItem } from '@/features/activity/components/ActivityScreen';
import {
  aggregateActivity,
  type AggregatedActivityItem,
  type AggregatedActivityResult,
} from '@/features/activity/services/activityService';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { useEndpointStore } from '@/store/endpointStore';

const POLL_INTERVAL_MS = 15_000;

function emptyActivity(): AggregatedActivityResult {
  return {
    needsAttention: [],
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

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
    askId: item.ask_id,
  };
}

export default function ActivityTab() {
  const endpoints = useEndpointStore((s) => s.endpoints);
  const router = useRouter();
  const [activity, setActivity] = useState<AggregatedActivityResult>(() => emptyActivity());
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refreshActivity = useCallback(
    (showRefreshing = true) => {
      if (inFlightRef.current) return inFlightRef.current;

      if (endpoints.length === 0) {
        setActivity(emptyActivity());
        setHasLoaded(true);
        setRefreshing(false);
        return Promise.resolve();
      }

      if (showRefreshing) setRefreshing(true);

      const request = aggregateActivity(endpoints)
        .then((result) => {
          setActivity(result);
          setHasLoaded(true);
        })
        .finally(() => {
          if (inFlightRef.current === request) {
            inFlightRef.current = null;
          }
          if (showRefreshing) setRefreshing(false);
        });

      inFlightRef.current = request;
      return request;
    },
    [endpoints],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refreshActivity();
      return () => {
        setFocused(false);
      };
    }, [refreshActivity]),
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
      void refreshActivity(false);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [appState, focused, refreshActivity]);

  useEffect(() => {
    if (endpoints.length === 0) {
      setActivity(emptyActivity());
      setHasLoaded(true);
    }
  }, [endpoints.length]);

  const needsAttention = activity.needsAttention.map(toScreenItem);
  const running = activity.running.map(toScreenItem);
  const done = activity.done.map(toScreenItem);
  const allFailed =
    endpoints.length > 0 &&
    hasLoaded &&
    activity.failedEndpoints.length === endpoints.length &&
    needsAttention.length + running.length + done.length === 0;

  const handleOpenItem = (item: ActivityItem) => {
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
          void refreshActivity();
        }}
        onOpenItem={handleOpenItem}
        isRefreshing={refreshing}
        onRefresh={() => {
          void refreshActivity();
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
});
