import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Search, Pencil } from 'lucide-react-native';
import { Conversation } from '@/types';

interface Props {
  conversations: Conversation[];
  onPressConversation: (conv: Conversation) => void;
  onPressNewChat: () => void;
}

export default function ChatHomeScreen({ conversations, onPressConversation, onPressNewChat }: Props) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) =>
    c.agent_name.toLowerCase().includes(search.toLowerCase()) ||
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>MULTISOUL</Text>
        <TouchableOpacity onPress={onPressNewChat}>
          <Pencil size={20} color="#20C20E" />
        </TouchableOpacity>
      </View>

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

      <View style={s.sectionWrap}>
        <Text style={s.sectionLabel}>RECENT</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={s.list}
        renderItem={({ item }) => {
          const initials = item.agent_name.slice(0, 2).toUpperCase();
          const running = item.status === 'running' || item.status === 'awaiting_question';
          return (
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
                    {new Date(item.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Text style={s.lastMessage} numberOfLines={1}>{item.title}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#040D04' },
  header:      { height: 52, backgroundColor: '#061206', flexDirection: 'row',
                 alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  headerTitle: { fontFamily: 'Anton', fontSize: 22, color: '#20C20E' },
  searchWrap:  { height: 68, backgroundColor: '#040D04', padding: 12 },
  searchBar:   { flex: 1, flexDirection: 'row', alignItems: 'center',
                 backgroundColor: '#0A1A0A', borderRadius: 2,
                 borderWidth: 1, borderColor: '#0F2B0F', paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, fontFamily: 'Geist', fontSize: 14, color: '#20C20E', height: 44 },
  sectionWrap: { height: 36, justifyContent: 'center', paddingHorizontal: 16 },
  sectionLabel:{ fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 2 },
  list:        { flex: 1 },
  row:         { height: 72, flexDirection: 'row', alignItems: 'center',
                 paddingHorizontal: 16, gap: 12 },
  avatarWrap:  { position: 'relative' },
  avatar:      { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0F2B0F',
                 alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontFamily: 'Anton', fontSize: 11, color: '#20C20E' },
  unreadDot:   { position: 'absolute', top: -2, right: -2, width: 8, height: 8,
                 borderRadius: 4, backgroundColor: '#FFB000' },
  rowContent:  { flex: 1, gap: 3 },
  rowTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentName:   { fontFamily: 'Anton', fontSize: 14, color: '#20C20E' },
  timestamp:   { fontFamily: 'Inter', fontSize: 11, color: '#0F6B0F' },
  lastMessage: { fontFamily: 'Geist', fontSize: 13, color: '#2D8B2D' },
});
