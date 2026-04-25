import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SlidersHorizontal, AlertCircle } from 'lucide-react-native';
import { Agent } from '@/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: Agent[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onAgentPress: (id: string) => void;
}

export function AgentList({
  agents,
  isLoading,
  isError,
  error,
  isFetching,
  onRefetch,
  onAgentPress,
}: Props) {
  const insets = useSafeAreaInsets();

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>AGENTS</Text>
          </View>
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#20C20E" />
          <Text style={s.loadingText}>LOADING AGENTS...</Text>
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>AGENTS</Text>
            <Text style={s.headerSubError}>CONNECTION FAILED</Text>
          </View>
        </View>
        <View style={s.centered}>
          <View style={s.errorIconWrap}>
            <AlertCircle size={36} color="#FFB000" />
          </View>
          <Text style={s.errorTitle}>FAILED TO LOAD</Text>
          <Text style={s.errorDesc}>{String(error)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={onRefetch}>
            <Text style={s.retryText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle}>AGENTS</Text>
          <Text style={s.headerSub}>{agents.length} REGISTERED</Text>
        </View>
        <SlidersHorizontal size={20} color="#2D8B2D" />
      </View>

      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AgentCard agent={item} onPress={() => onAgentPress(item.id)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={onRefetch}
            tintColor="#20C20E"
            colors={['#20C20E']}
          />
        }
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>NO AGENTS REGISTERED</Text>
            <Text style={s.emptyDesc}>
              Register your first agent via the CLI or API.
            </Text>
          </View>
        }
        contentContainerStyle={agents.length === 0 ? s.emptyContainer : s.listContent}
      />
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
  headerLeft: {
    gap: 2,
  },
  headerTitle: {
    fontFamily: 'Anton',
    fontSize: 20,
    color: '#20C20E',
  },
  headerSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    letterSpacing: 1.5,
  },
  headerSubError: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#FFB000',
    letterSpacing: 1.5,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  loadingText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    letterSpacing: 2,
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 2,
    backgroundColor: '#061206',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    fontFamily: 'Anton',
    fontSize: 20,
    color: '#FFB000',
  },
  errorDesc: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#147A16',
    textAlign: 'center',
    maxWidth: 260,
  },
  retryBtn: {
    height: 36,
    paddingHorizontal: 24,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: '#20C20E',
    letterSpacing: 1.5,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontFamily: 'Anton',
    fontSize: 18,
    color: '#2D8B2D',
  },
  emptyDesc: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#147A16',
    textAlign: 'center',
    maxWidth: 260,
  },
});
