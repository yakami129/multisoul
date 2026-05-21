import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Agent, type Conversation } from '@/types';

interface Props {
  agent: Agent | undefined;
  recentConversations?: Conversation[];
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onNewChat: () => void;
  onOpenConversation?: (conversation: Conversation) => void;
}

type ProjectStatus = {
  label: string;
  tone: 'idle' | 'active' | 'failed';
};

function displayRuntime(runtime: Agent['runtime']) {
  switch (runtime) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor-cli':
      return 'Cursor CLI';
    case 'custom':
      return 'Custom';
  }
}

function projectStatus(agent: Agent, conversations: Conversation[]): ProjectStatus {
  const machine = agent.endpoint_label;
  if (conversations.some((conv) => conv.status === 'awaiting_question')) {
    return {
      label: `Awaiting answer on ${machine} · ${displayRuntime(agent.runtime)}`,
      tone: 'active',
    };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: `Running on ${machine} · ${displayRuntime(agent.runtime)}`, tone: 'active' };
  }
  if (conversations.some((conv) => conv.status === 'failed')) {
    return { label: `Failed on ${machine} · ${displayRuntime(agent.runtime)}`, tone: 'failed' };
  }
  return { label: `Idle on ${machine} · ${displayRuntime(agent.runtime)}`, tone: 'idle' };
}

function conversationSummary(conversation: Conversation): string {
  return conversation.last_ai_reply ?? conversation.first_user_message ?? conversation.status;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.nav}>
      <TouchableOpacity
        onPress={onBack}
        style={s.backLink}
        accessibilityRole="button"
        accessibilityLabel="Back to Projects"
      >
        <ChevronLeft size={20} color="#FF6B35" />
        <Text style={s.backText}>Projects</Text>
      </TouchableOpacity>
    </View>
  );
}

export function AgentDetail({
  agent,
  recentConversations = [],
  isLoading,
  isError,
  onBack,
  onNewChat,
  onOpenConversation,
}: Props) {
  const insets = useSafeAreaInsets();
  const status = agent ? projectStatus(agent, recentConversations) : undefined;

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={s.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (isError || !agent || !status) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <View style={s.centered}>
          <Text style={s.errorTitle}>Failed to load</Text>
          <TouchableOpacity style={s.backBtn} onPress={onBack}>
            <Text style={s.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header onBack={onBack} />

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Text style={s.projectName} numberOfLines={2}>
            {agent.name}
          </Text>
          <View style={s.statusPill}>
            <View
              style={[
                s.statusDot,
                status.tone === 'active' && s.statusDotActive,
                status.tone === 'failed' && s.statusDotFailed,
              ]}
            />
            <Text style={s.statusText} numberOfLines={1}>
              {status.label}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={s.newChatBtn} onPress={onNewChat} accessibilityRole="button">
          <Plus size={16} color="#FFFFFF" />
          <Text style={s.newChatBtnText}>New Chat</Text>
        </TouchableOpacity>

        <Text style={s.sectionTitle}>Recent Chats</Text>
        <View style={s.chatGroup}>
          {recentConversations.length === 0 ? (
            <Text style={s.emptyRecentText}>No recent chats yet.</Text>
          ) : (
            recentConversations.map((conversation, index) => (
              <View key={conversation.id}>
                <TouchableOpacity
                  style={s.chatRow}
                  onPress={() => onOpenConversation?.(conversation)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${conversation.title}`}
                >
                  <View
                    style={[
                      s.chatDot,
                      (conversation.status === 'running' ||
                        conversation.status === 'awaiting_question') &&
                        s.chatDotActive,
                    ]}
                  />
                  <View style={s.chatInfo}>
                    <Text style={s.chatTitle} numberOfLines={1}>
                      {conversation.title}
                    </Text>
                    <Text style={s.chatSummary} numberOfLines={1}>
                      {conversationSummary(conversation)}
                    </Text>
                  </View>
                  <View style={s.chatMeta}>
                    <Text style={s.chatTime}>{relativeTime(conversation.last_message_at)}</Text>
                    <ChevronRight size={13} color="#666666" />
                  </View>
                </TouchableOpacity>
                {index < recentConversations.length - 1 ? <View style={s.divider} /> : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  nav: {
    height: 44,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontFamily: 'Inter', fontSize: 15, color: '#FF6B35' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  errorTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FF4444' },
  backBtn: {
    borderWidth: 1,
    borderColor: '#FF6B35',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FF6B35' },
  scroll: { paddingBottom: 110 },
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 8 },
  projectName: { fontFamily: 'Inter', fontSize: 34, fontWeight: '700', color: '#FFFFFF' },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#555555' },
  statusDotActive: { backgroundColor: '#4CAF50' },
  statusDotFailed: { backgroundColor: '#FF4444' },
  statusText: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  newChatBtn: {
    marginHorizontal: 16,
    height: 44,
    backgroundColor: '#FF6B35',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  newChatBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  sectionTitle: {
    height: 38,
    paddingHorizontal: 20,
    paddingTop: 14,
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chatGroup: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    overflow: 'hidden',
  },
  emptyRecentText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  chatRow: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  chatDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1A1A1A' },
  chatDotActive: { backgroundColor: '#FF6B35' },
  chatInfo: { flex: 1, gap: 3 },
  chatTitle: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  chatSummary: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  chatMeta: { alignItems: 'flex-end', gap: 4 },
  chatTime: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  divider: { height: 1, backgroundColor: '#1E1E1E', marginLeft: 32 },
});
