import { SlidersHorizontal, AlertCircle } from 'lucide-react-native';
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
import { type Agent } from '@/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: Agent[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onAgentPress: (id: string, endpoint_id: string, name: string) => void;
}

function AgentCardSeparator() {
  return <View style={s.cardSeparator} />;
}

export function AgentList({ agents, isLoading, isError, error, onRefetch, onAgentPress }: Props) {
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      onRefetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefetch]);

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>AGENTS</Text>
          </View>
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#FF6B35" />
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
            <AlertCircle size={36} color="#FF6B35" />
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
        <SlidersHorizontal size={20} color="#888888" />
      </View>

      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AgentCard
            agent={item}
            onPress={() => onAgentPress(item.id, item.endpoint_id, item.name)}
          />
        )}
        ItemSeparatorComponent={AgentCardSeparator}
        scrollEnabled={agents.length > 0}
        bounces={agents.length > 0}
        alwaysBounceVertical={agents.length > 0}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor="#FF6B35"
            colors={['#FF6B35']}
          />
        }
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>NO AGENTS REGISTERED</Text>
            <Text style={s.emptyDesc}>Register your first agent via the CLI or API.</Text>
          </View>
        }
        contentContainerStyle={agents.length === 0 ? s.emptyContainer : s.listContent}
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
  headerLeft: { gap: 2 },
  headerTitle: { fontFamily: 'Anton', fontSize: 20, color: '#FFFFFF' },
  headerSub: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 1.5 },
  headerSubError: { fontFamily: 'Inter', fontSize: 11, color: '#FF6B35', letterSpacing: 1.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 2 },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: { fontFamily: 'Anton', fontSize: 20, color: '#FF6B35' },
  errorDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    maxWidth: 260,
  },
  retryBtn: {
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  listContent: { paddingTop: 16, paddingBottom: 110 },
  cardSeparator: { height: 12 },
  emptyContainer: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { fontFamily: 'Anton', fontSize: 18, color: '#FFFFFF' },
  emptyDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    maxWidth: 260,
  },
});
