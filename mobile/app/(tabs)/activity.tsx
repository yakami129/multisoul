import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityScreen, { type ActivityItem } from '@/features/activity/components/ActivityScreen';
import { conversationDisplaySummary, conversationDisplayTitle } from '@/features/chat';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import { type AskQuestionPayload, type Conversation, type InboxItem } from '@/types';

type PendingActivityItem = ActivityItem & {
  source: 'inbox';
  endpointId: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  askId: string;
  inboxId: string;
};

type ConversationActivityItem = ActivityItem & {
  source: 'conversation';
  conversation: Conversation;
};

type RoutedActivityItem = PendingActivityItem | ConversationActivityItem;

function questionTitle(item: InboxItem): string {
  const payload = item.payload as AskQuestionPayload | null;
  return payload?.questions[0]?.text ?? item.body;
}

function doneStatus(conversation: Conversation): { label: string; tone: ActivityItem['tone'] } {
  if (conversation.status === 'failed') return { label: 'Failed', tone: 'failed' };
  return { label: 'Done', tone: 'done' };
}

function byNewest(a: ActivityItem, b: ActivityItem) {
  return b.timestamp - a.timestamp;
}

export default function ActivityTab() {
  const inboxItems = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const load = useInboxStore((s) => s.load);
  const conversations = useChatStore((s) => s.conversations);
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void handleRefresh();
    }, [handleRefresh]),
  );

  const { needsAttention, running, done } = useMemo(() => {
    const attention = inboxItems
      .filter((item) => item.kind === 'pending_question' && item.payload !== null)
      .map<PendingActivityItem>((item) => {
        const payload = item.payload as AskQuestionPayload;
        return {
          id: `attention:${item.id}`,
          source: 'inbox',
          section: 'attention',
          projectName: item.title,
          title: questionTitle(item),
          subtitle: item.conversation_id,
          statusLabel: 'Needs input',
          tone: 'attention',
          timestamp: item.received_at,
          endpointId: item.endpoint_id,
          conversationId: item.conversation_id,
          agentId: item.agent_id,
          agentName: item.title,
          askId: payload.ask_id,
          inboxId: item.id,
        };
      })
      .sort(byNewest);

    const active = conversations
      .filter((conversation) => conversation.status === 'running')
      .map<ConversationActivityItem>((conversation) => ({
        id: `running:${conversation.id}`,
        source: 'conversation',
        section: 'running',
        projectName: conversation.agent_name,
        title: conversationDisplayTitle(conversation),
        subtitle: conversationDisplaySummary(conversation),
        statusLabel: 'Running',
        tone: 'running',
        timestamp: conversation.last_message_at,
        conversation,
      }))
      .sort(byNewest);

    const completed = conversations
      .filter(
        (conversation) => conversation.status === 'completed' || conversation.status === 'failed',
      )
      .map<ConversationActivityItem>((conversation) => {
        const status = doneStatus(conversation);
        return {
          id: `done:${conversation.id}`,
          source: 'conversation',
          section: 'done',
          projectName: conversation.agent_name,
          title: conversationDisplayTitle(conversation),
          subtitle: conversationDisplaySummary(conversation),
          statusLabel: status.label,
          tone: status.tone,
          timestamp: conversation.last_message_at,
          conversation,
        };
      })
      .sort(byNewest);

    return { needsAttention: attention, running: active, done: completed };
  }, [inboxItems, conversations]);

  const handleOpenItem = (item: ActivityItem) => {
    const routed = item as RoutedActivityItem;
    if (routed.source === 'inbox') {
      void markRead(routed.inboxId);
      router.push(
        buildChatDetailPath({
          conversationId: routed.conversationId,
          endpointId: routed.endpointId,
          agentId: routed.agentId,
          agentName: routed.agentName,
          focusAskId: routed.askId,
        }),
      );
      return;
    }

    router.push(
      buildChatDetailPath({
        conversationId: routed.conversation.id,
        endpointId: routed.conversation.endpoint_id,
        agentId: routed.conversation.agent_id,
        agentName: routed.conversation.agent_name,
      }),
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <ActivityScreen
        needsAttention={needsAttention}
        running={running}
        done={done}
        onOpenItem={handleOpenItem}
        isRefreshing={refreshing}
        onRefresh={() => {
          void handleRefresh();
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
});
