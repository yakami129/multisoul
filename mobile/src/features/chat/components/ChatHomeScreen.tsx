import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { MessageCircle, Inbox, User, Search, Pencil } from 'lucide-react-native';
import { Conversation } from '../types';

interface Props {
  conversations: Conversation[];
  onPressConversation: (id: string) => void;
  onPressNewChat: () => void;
  activeTab?: 'chat' | 'inbox' | 'profile';
  onPressTab?: (tab: 'chat' | 'inbox' | 'profile') => void;
  inboxBadgeCount?: number;
}

export default function ChatHomeScreen({
  conversations,
  onPressConversation,
  onPressNewChat,
  activeTab = 'chat',
  onPressTab,
  inboxBadgeCount = 0,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) =>
    c.agentName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>GROK</Text>
        <TouchableOpacity onPress={onPressNewChat}>
          <Pencil size={20} color="#20C20E" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <View style={s.searchBar}>
          <Search size={16} color="#2D8B2D" />
          <TextInput
            style={s.searchInput}
            placeholder="Search..."
            placeholderTextColor="#2D8B2D"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Section label */}
      <View style={s.sectionWrap}>
        <Text style={s.sectionLabel}>RECENT</Text>
      </View>

      {/* Conversation list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={s.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => onPressConversation(item.id)}>
            <View style={s.avatarWrap}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{item.agentInitials}</Text>
              </View>
              {item.hasUnread && <View style={s.unreadDot} />}
            </View>
            <View style={s.rowContent}>
              <View style={s.rowTop}>
                <Text style={s.agentName}>{item.agentName}</Text>
                <Text style={s.timestamp}>{item.timestamp}</Text>
              </View>
              <Text style={s.lastMessage} numberOfLines={1}>
                {item.lastMessage}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Tab bar */}
      <View style={s.tabBar}>
        <TouchableOpacity style={s.tab} onPress={() => onPressTab?.('chat')}>
          <MessageCircle
            size={24}
            color={activeTab === 'chat' ? '#33FF33' : '#2D8B2D'}
          />
          <Text style={[s.tabLabel, activeTab === 'chat' && s.tabLabelActive]}>
            Chat
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.tab} onPress={() => onPressTab?.('inbox')}>
          <View>
            <Inbox size={24} color={activeTab === 'inbox' ? '#33FF33' : '#2D8B2D'} />
            {inboxBadgeCount > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{inboxBadgeCount}</Text>
              </View>
            )}
          </View>
          <Text style={[s.tabLabel, activeTab === 'inbox' && s.tabLabelActive]}>
            Inbox
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.tab} onPress={() => onPressTab?.('profile')}>
          <User size={24} color={activeTab === 'profile' ? '#33FF33' : '#2D8B2D'} />
          <Text style={[s.tabLabel, activeTab === 'profile' && s.tabLabelActive]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040D04',
  },
  header: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerTitle: {
    fontFamily: 'Anton',
    fontSize: 22,
    color: '#20C20E',
  },
  searchWrap: {
    height: 68,
    backgroundColor: '#040D04',
    padding: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A1A0A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    height: 44,
  },
  sectionWrap: {
    height: 36,
    backgroundColor: '#040D04',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 2,
  },
  list: {
    flex: 1,
    backgroundColor: '#040D04',
  },
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#040D04',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Anton',
    fontSize: 11,
    color: '#20C20E',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFB000',
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agentName: {
    fontFamily: 'Anton',
    fontSize: 14,
    color: '#20C20E',
  },
  timestamp: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#0F6B0F',
  },
  lastMessage: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#2D8B2D',
  },
  tabBar: {
    height: 83,
    backgroundColor: '#061206',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tabLabel: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#2D8B2D',
  },
  tabLabelActive: {
    color: '#33FF33',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFB000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '700',
    color: '#040D04',
  },
});
