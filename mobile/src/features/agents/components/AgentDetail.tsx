import { ArrowLeft, Folder, MessageCircle, Plus } from 'lucide-react-native';
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

function projectStatus(conversations: Conversation[]): ProjectStatus {
  if (conversations.some((conv) => conv.status === 'awaiting_question')) {
    return { label: 'Awaiting answer', tone: 'active' };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'Running', tone: 'active' };
  }
  if (conversations.some((conv) => conv.status === 'failed')) {
    return { label: 'Failed', tone: 'failed' };
  }
  return { label: 'Idle', tone: 'idle' };
}

function conversationSummary(conversation: Conversation): string {
  return conversation.first_user_message ?? conversation.last_ai_reply ?? conversation.status;
}

function conversationStatusLabel(status: Conversation['status']): string {
  switch (status) {
    case 'awaiting_question':
      return 'Awaiting';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'idle':
      return 'Idle';
  }
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
  const status = projectStatus(recentConversations);

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <TouchableOpacity onPress={onBack}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.navTitle}>PROJECT</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={s.loadingText}>LOADING...</Text>
        </View>
      </View>
    );
  }

  if (isError || !agent) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <TouchableOpacity onPress={onBack}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.navTitle}>PROJECT</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={s.centered}>
          <Text style={s.errorTitle}>FAILED TO LOAD</Text>
          <TouchableOpacity style={s.backBtn} onPress={onBack}>
            <Text style={s.backBtnText}>GO BACK</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.nav}>
        <TouchableOpacity onPress={onBack}>
          <ArrowLeft size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={s.navTitle}>PROJECT</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.headerCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={s.headerInfo}>
            <Text style={s.agentName}>{agent.name.toUpperCase()}</Text>
            <View style={s.badgeRow}>
              <View
                style={[
                  s.statusBadge,
                  status.tone === 'active' && s.statusBadgeActive,
                  status.tone === 'failed' && s.statusBadgeFailed,
                ]}
              >
                <Text
                  style={[
                    s.statusText,
                    status.tone === 'active' && s.statusTextActive,
                    status.tone === 'failed' && s.statusTextFailed,
                  ]}
                >
                  {status.label}
                </Text>
              </View>
              <View style={s.runtimeBadge}>
                <Text style={s.runtimeText}>{agent.runtime.toUpperCase()}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.row}>
            <Text style={s.rowLabel}>ENDPOINT</Text>
            <Text style={s.rowValue}>{agent.endpoint_label}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>WORKSPACE</Text>
            <View style={s.projectRow}>
              <Folder size={12} color="#555555" />
              <Text style={s.rowValueMono} numberOfLines={2}>
                {agent.project_path}
              </Text>
            </View>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>ID</Text>
            <Text style={s.rowValueMono} numberOfLines={1}>
              {agent.id}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={s.newChatBtn} onPress={onNewChat}>
          <Plus size={16} color="#FFFFFF" />
          <Text style={s.newChatBtnText}>New Chat</Text>
        </TouchableOpacity>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Recent Chats</Text>
          {recentConversations.length === 0 ? (
            <Text style={s.emptyRecentText}>No recent chats yet.</Text>
          ) : (
            recentConversations.map((conversation, index) => (
              <React.Fragment key={conversation.id}>
                <TouchableOpacity
                  style={s.chatRow}
                  onPress={() => onOpenConversation?.(conversation)}
                >
                  <View style={s.chatIcon}>
                    <MessageCircle size={14} color="#FF6B35" />
                  </View>
                  <View style={s.chatInfo}>
                    <Text style={s.chatTitle} numberOfLines={1}>
                      {conversation.title}
                    </Text>
                    <Text style={s.chatSummary} numberOfLines={1}>
                      {conversationSummary(conversation)}
                    </Text>
                  </View>
                  <Text style={s.chatStatus}>{conversationStatusLabel(conversation.status)}</Text>
                </TouchableOpacity>
                {index < recentConversations.length - 1 ? <View style={s.divider} /> : null}
              </React.Fragment>
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
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  navTitle: { fontFamily: 'Inter', fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 2 },
  errorTitle: { fontFamily: 'Inter', fontSize: 20, fontWeight: '700', color: '#FF4444' },
  backBtn: {
    borderWidth: 1,
    borderColor: '#FF6B35',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backBtnText: { fontFamily: 'Inter', fontSize: 12, color: '#FF6B35', letterSpacing: 1.5 },
  scroll: { padding: 16, gap: 12 },
  headerCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Inter', fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  headerInfo: { flex: 1, gap: 6 },
  agentName: { fontFamily: 'Inter', fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#1A1A1A',
  },
  statusBadgeActive: { backgroundColor: '#1A1A1A' },
  statusBadgeFailed: { backgroundColor: '#1A1A1A' },
  statusText: { fontFamily: 'Inter', fontSize: 10, color: '#888888', letterSpacing: 0.5 },
  statusTextActive: { color: '#FF6B35' },
  statusTextFailed: { color: '#FF4444' },
  runtimeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#0D0D0D',
  },
  runtimeText: { fontFamily: 'Inter', fontSize: 10, color: '#888888', letterSpacing: 0.8 },
  section: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#666666',
    letterSpacing: 1.5,
    paddingTop: 2,
  },
  rowValue: { fontFamily: 'Inter', fontSize: 13, color: '#DDDDDD', flex: 1, textAlign: 'right' },
  rowValueMono: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#888888',
    flex: 1,
    textAlign: 'right',
  },
  projectRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    justifyContent: 'flex-end',
  },
  divider: { height: 1, backgroundColor: '#1E1E1E' },
  newChatBtn: {
    height: 44,
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  newChatBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  emptyRecentText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInfo: { flex: 1, gap: 2 },
  chatTitle: { fontFamily: 'Inter', fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  chatSummary: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  chatStatus: { fontFamily: 'Inter', fontSize: 11, color: '#666666' },
});
