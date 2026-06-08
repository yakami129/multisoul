import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conversationDisplaySummary, conversationDisplayTitle } from '@/features/chat';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type Agent, type Conversation } from '@/types';

interface Props {
  agent: Agent | undefined;
  recentConversations?: Conversation[];
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onNewChat: () => void;
  onOpenConversation?: (conversation: Conversation) => void;
  onDeleteConversation?: (conversation: Conversation) => void;
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
  const mostRecent = [...conversations].sort((a, b) => b.last_message_at - a.last_message_at)[0];
  if (mostRecent?.status === 'failed') {
    return { label: `Failed on ${machine} · ${displayRuntime(agent.runtime)}`, tone: 'failed' };
  }
  return { label: `Idle on ${machine} · ${displayRuntime(agent.runtime)}`, tone: 'idle' };
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
        accessibilityLabel="Back to Agents"
      >
        <ChevronLeft size={20} color={brandColors.ink} />
        <Text style={s.backText}>Agents</Text>
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
  onDeleteConversation,
}: Props) {
  const insets = useSafeAreaInsets();
  const status = agent ? projectStatus(agent, recentConversations) : undefined;
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const renderDeleteAction = (conversation: Conversation) => (
    <TouchableOpacity
      style={s.deleteAction}
      onPress={() => onDeleteConversation?.(conversation)}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${conversationDisplayTitle(conversation)}`}
    >
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <View style={s.centered}>
          <ActivityIndicator size="large" color={brandColors.cyan} />
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
          <Text style={s.workspacePath} selectable>
            {agent.project_path}
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
          <Plus size={16} color={brandColors.white} />
          <Text style={s.newChatBtnText}>New Chat</Text>
        </TouchableOpacity>

        <Text style={s.sectionTitle}>Recent Chats</Text>
        <View style={s.chatGroup}>
          {recentConversations.length === 0 ? (
            <Text style={s.emptyRecentText}>No recent chats yet.</Text>
          ) : (
            recentConversations.map((conversation, index) => (
              <View key={conversation.id}>
                <Swipeable
                  ref={(ref) => {
                    if (ref) swipeableRefs.current.set(conversation.id, ref);
                    else swipeableRefs.current.delete(conversation.id);
                  }}
                  onSwipeableOpen={() => {
                    if (openSwipeableRef.current) openSwipeableRef.current.close();
                    openSwipeableRef.current = swipeableRefs.current.get(conversation.id) ?? null;
                  }}
                  renderRightActions={() => renderDeleteAction(conversation)}
                  overshootRight={false}
                >
                  <TouchableOpacity
                    style={s.chatRow}
                    onPress={() => onOpenConversation?.(conversation)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${conversationDisplayTitle(conversation)}`}
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
                        {conversationDisplayTitle(conversation)}
                      </Text>
                      <Text style={s.chatSummary} numberOfLines={1}>
                        {conversationDisplaySummary(conversation)}
                      </Text>
                    </View>
                    <View style={s.chatMeta}>
                      <Text style={s.chatTime}>{relativeTime(conversation.last_message_at)}</Text>
                      <ChevronRight size={13} color={brandColors.textSoft} />
                    </View>
                  </TouchableOpacity>
                </Swipeable>
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
  root: { flex: 1, backgroundColor: brandColors.cream },
  nav: {
    height: 44,
    backgroundColor: brandColors.cream,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: brandColors.ink },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter', fontSize: 13, color: brandColors.textSoft },
  errorTitle: {
    fontFamily: brandTypography.display,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    color: brandColors.error,
  },
  backBtn: {
    borderWidth: 1,
    borderColor: brandColors.coral,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backBtnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: brandColors.coral },
  scroll: { paddingBottom: 110 },
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 8 },
  projectName: {
    fontFamily: brandTypography.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: brandColors.ink,
  },
  workspacePath: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 18,
    color: brandColors.textSoft,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: brandRgba.white88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: brandColors.textMuted },
  statusDotActive: { backgroundColor: brandColors.cyan },
  statusDotFailed: { backgroundColor: brandColors.error },
  statusText: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  newChatBtn: {
    marginHorizontal: 16,
    height: 44,
    backgroundColor: brandColors.ink,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  newChatBtnText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.white,
  },
  sectionTitle: {
    height: 38,
    paddingHorizontal: 20,
    paddingTop: 14,
    fontFamily: brandTypography.display,
    fontSize: 20,
    fontWeight: '700',
    color: brandColors.ink,
  },
  chatGroup: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  emptyRecentText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textSoft,
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
  chatDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: brandColors.textMuted },
  chatDotActive: { backgroundColor: brandColors.coral },
  chatInfo: { flex: 1, gap: 3 },
  chatTitle: { fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: brandColors.ink },
  chatSummary: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  chatMeta: { alignItems: 'flex-end', gap: 4 },
  chatTime: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textMuted },
  divider: { height: 1, backgroundColor: brandRgba.silver78, marginLeft: 32 },
  deleteAction: {
    width: 80,
    backgroundColor: brandColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: brandColors.error },
});
