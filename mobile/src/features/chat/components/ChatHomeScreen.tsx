import { Search, Pencil } from 'lucide-react-native';
import React, { useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { type Conversation } from '@/types';

const truncate = (s: string, max = 50) => (s.length > max ? s.slice(0, max) + '...' : s);

interface Props {
  conversations: Conversation[];
  onPressConversation: (conv: Conversation) => void;
  onPressNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export default function ChatHomeScreen({
  conversations,
  onPressConversation,
  onPressNewChat,
  onDeleteConversation,
  isRefreshing = false,
  onRefresh,
}: Props) {
  const [search, setSearch] = React.useState('');
  const openSwipeableRef = useRef<Swipeable | null>(null);

  const filtered = conversations.filter(
    (c) =>
      c.agent_name.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.first_user_message ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const renderDeleteAction = (conv: Conversation) => (
    <TouchableOpacity style={s.deleteAction} onPress={() => onDeleteConversation(conv.id)}>
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>MULTISOUL</Text>
        <TouchableOpacity onPress={onPressNewChat}>
          <Pencil size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <View style={s.searchBar}>
          <Search size={16} color="#666666" />
          <TextInput
            style={s.searchInput}
            placeholder="Search..."
            placeholderTextColor="#666666"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <View style={s.sectionWrap}>
        <Text style={s.sectionLabel}>RECENT</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={s.list}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
        }
        renderItem={({ item }) => {
          const initials = item.agent_name.slice(0, 2).toUpperCase();
          const running = item.status === 'running' || item.status === 'awaiting_question';
          return (
            <Swipeable
              ref={(ref) => {
                if (ref && openSwipeableRef.current && openSwipeableRef.current !== ref) {
                  openSwipeableRef.current.close();
                }
                openSwipeableRef.current = ref;
              }}
              renderRightActions={() => renderDeleteAction(item)}
              overshootRight={false}
            >
              <TouchableOpacity style={s.row} onPress={() => onPressConversation(item)}>
                <View style={s.avatarWrap}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{initials}</Text>
                  </View>
                  {running && <View style={s.unreadDot} />}
                </View>
                <View style={s.rowContent}>
                  <View style={s.rowTop}>
                    <Text style={s.agentName}>{item.agent_name}</Text>
                    <Text style={s.timestamp}>
                      {new Date(item.last_message_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text style={s.lastMessage} numberOfLines={1}>
                    {item.first_user_message ?? ''}
                  </Text>
                  {item.last_ai_reply ? (
                    <Text style={s.description} numberOfLines={1}>
                      {truncate(item.last_ai_reply)}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  headerTitle: { fontFamily: 'Anton', fontSize: 32, color: '#FFFFFF' },
  searchWrap: { height: 68, backgroundColor: '#0D0D0D', padding: 12 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter', fontSize: 16, color: '#FFFFFF', height: 44 },
  sectionWrap: { height: 36, justifyContent: 'center', paddingHorizontal: 16 },
  sectionLabel: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 110 },
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#0D0D0D',
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 14, color: '#FFFFFF' },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF6B35',
  },
  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentName: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  timestamp: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  lastMessage: { fontFamily: 'Inter', fontSize: 14, color: '#888888' },
  description: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  deleteAction: {
    width: 80,
    backgroundColor: '#1A1A1A',
    borderLeftWidth: 1,
    borderLeftColor: '#FF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF4444' },
});
