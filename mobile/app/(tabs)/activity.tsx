import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityScreen, { type ActivityItem } from '@/features/activity/components/ActivityScreen';
import { conversationDisplaySummary, conversationDisplayTitle } from '@/features/chat';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import {
  type AskQuestionPayload,
  type Conversation,
  type InboxItem,
  type WsMessage,
} from '@/types';

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

interface AnsweredAskCache {
  checkedConversationIds: Set<string>;
  answeredAskIdsByConversation: Record<string, Set<string>>;
}

function questionTitle(item: InboxItem): string {
  const payload = item.payload as AskQuestionPayload | null;
  return payload?.questions[0]?.text ?? item.body;
}

function questionTitleFromPayload(payload: AskQuestionPayload): string {
  return payload.questions[0]?.text ?? 'Agent needs input';
}

function doneStatus(conversation: Conversation): { label: string; tone: ActivityItem['tone'] } {
  if (conversation.status === 'failed') return { label: 'Failed', tone: 'failed' };
  return { label: 'Done', tone: 'done' };
}

function byNewest(a: ActivityItem, b: ActivityItem) {
  return b.timestamp - a.timestamp;
}

function setEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  return Array.from(a).every((value) => b.has(value));
}

function answeredAskIdsEqual(a: Record<string, Set<string>>, b: Record<string, Set<string>>) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const aSet = a[key];
    const bSet = b[key];
    if (!bSet || aSet.size !== bSet.size) return false;
    return Array.from(aSet).every((askId) => bSet.has(askId));
  });
}

function answeredAskCacheEqual(a: AnsweredAskCache, b: AnsweredAskCache) {
  return (
    setEqual(a.checkedConversationIds, b.checkedConversationIds) &&
    answeredAskIdsEqual(a.answeredAskIdsByConversation, b.answeredAskIdsByConversation)
  );
}

export default function ActivityTab() {
  const inboxItems = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const load = useInboxStore((s) => s.load);
  const conversations = useChatStore((s) => s.conversations);
  const messagesByConversation = useChatStore((s) => s.messages);
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [answeredAskCache, setAnsweredAskCache] = useState<AnsweredAskCache>({
    checkedConversationIds: new Set(),
    answeredAskIdsByConversation: {},
  });

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

  useEffect(() => {
    const conversationIds = Array.from(
      new Set(
        inboxItems
          .filter((item) => item.kind === 'pending_question' && item.payload !== null)
          .map((item) => item.conversation_id),
      ),
    );

    if (conversationIds.length === 0) {
      setAnsweredAskCache((current) => {
        const next = {
          checkedConversationIds: new Set<string>(),
          answeredAskIdsByConversation: {},
        };
        return answeredAskCacheEqual(current, next) ? current : next;
      });
      return;
    }

    let cancelled = false;
    Promise.all(
      conversationIds.map(async (conversationId) => {
        const answered = await loadAnsweredAsks(conversationId);
        return [conversationId, new Set(answered.keys())] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const next: AnsweredAskCache = {
          checkedConversationIds: new Set(conversationIds),
          answeredAskIdsByConversation: Object.fromEntries(
            entries.filter(([, askIds]) => askIds.size > 0),
          ),
        };
        setAnsweredAskCache((current) => (answeredAskCacheEqual(current, next) ? current : next));
      })
      .catch(() => {
        if (cancelled) return;
        const next = {
          checkedConversationIds: new Set<string>(),
          answeredAskIdsByConversation: {},
        };
        setAnsweredAskCache((current) => (answeredAskCacheEqual(current, next) ? current : next));
      });

    return () => {
      cancelled = true;
    };
  }, [inboxItems]);

  const { needsAttention, running, done } = useMemo(() => {
    const conversationsById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    const loadedAskIds = new Set<string>();
    const answeredLoadedAskIds = new Set<string>();

    const loadedQuestions = Object.entries(messagesByConversation).flatMap(
      ([conversationId, messages]) => {
        const conversation = conversationsById.get(conversationId);
        return messages
          .filter((message): message is WsMessage & { payload: AskQuestionPayload } => {
            if (message.role !== 'ask_question') return false;
            const payload = message.payload as AskQuestionPayload | null;
            return payload?.ask_id != null;
          })
          .map<PendingActivityItem>((message) => {
            const payload = message.payload as AskQuestionPayload;
            loadedAskIds.add(payload.ask_id);
            if (message.answered) {
              answeredLoadedAskIds.add(payload.ask_id);
            }
            return {
              id: `attention:${payload.ask_id}`,
              source: 'inbox',
              section: 'attention',
              projectName: conversation?.agent_name ?? 'Agent',
              title: questionTitleFromPayload(payload),
              subtitle: conversation ? conversationDisplayTitle(conversation) : conversationId,
              statusLabel: 'Pending',
              tone: 'attention',
              timestamp: message.created_at,
              endpointId: conversation?.endpoint_id ?? '',
              conversationId,
              agentId: conversation?.agent_id ?? '',
              agentName: conversation?.agent_name ?? 'Agent',
              askId: payload.ask_id,
              inboxId: payload.ask_id,
            };
          });
      },
    );

    const inboxFallback = inboxItems
      .filter((item) => {
        if (item.kind !== 'pending_question' || item.payload === null) return false;
        const askId = item.payload.ask_id;
        if (loadedAskIds.has(askId) || answeredLoadedAskIds.has(askId)) return false;
        if (!answeredAskCache.checkedConversationIds.has(item.conversation_id)) return false;
        return !answeredAskCache.answeredAskIdsByConversation[item.conversation_id]?.has(askId);
      })
      .map<PendingActivityItem>((item) => {
        const payload = item.payload as AskQuestionPayload;
        return {
          id: `attention:${item.id}`,
          source: 'inbox',
          section: 'attention',
          projectName: item.title,
          title: questionTitle(item),
          subtitle: item.conversation_id,
          statusLabel: 'Pending',
          tone: 'attention',
          timestamp: item.received_at,
          endpointId: item.endpoint_id,
          conversationId: item.conversation_id,
          agentId: item.agent_id,
          agentName: item.title,
          askId: payload.ask_id,
          inboxId: item.id,
        };
      });

    const attention = [
      ...loadedQuestions.filter((item) => !answeredLoadedAskIds.has(item.askId)),
      ...inboxFallback,
    ].sort(byNewest);

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
  }, [inboxItems, conversations, messagesByConversation, answeredAskCache]);

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
