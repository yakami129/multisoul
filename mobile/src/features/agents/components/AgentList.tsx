import AsyncStorage from '@react-native-async-storage/async-storage';
import { SlidersHorizontal, AlertCircle } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Agent } from '@/types';
import { AgentCard } from './AgentCard';
import { getWorkspaceList, filterAgentsByWorkspace } from '../utils/workspaceUtils';

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

  const STORAGE_KEY = '@multisoul:selected_workspace';
  const [selectedWorkspace, setSelectedWorkspace] = React.useState<string>('all');
  const [fadeAnim] = React.useState(new Animated.Value(1));

  const workspaces = React.useMemo(() => getWorkspaceList(agents), [agents]);

  const filteredAgents = React.useMemo(
    () => filterAgentsByWorkspace(agents, selectedWorkspace),
    [agents, selectedWorkspace],
  );

  // 恢复上次选中的工作空间
  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value && (value === 'all' || workspaces.includes(value))) {
          setSelectedWorkspace(value);
        }
      })
      .catch(() => {
        // 静默失败，使用默认值 'all'
      });
  }, [workspaces]);

  const handleWorkspaceChange = React.useCallback(
    (workspace: string) => {
      if (workspace === selectedWorkspace) return;

      // 淡出动画
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        // 更新选中的工作空间
        setSelectedWorkspace(workspace);

        // 保存到 AsyncStorage
        AsyncStorage.setItem(STORAGE_KEY, workspace).catch(() => {
          // 静默失败
        });

        // 淡入动画
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    },
    [selectedWorkspace, fadeAnim],
  );

  const renderWorkspaceChip = React.useCallback(
    (workspace: string, label: string) => {
      const isSelected = selectedWorkspace === workspace;
      return (
        <Pressable
          key={workspace}
          testID={`workspace-chip-${workspace}`}
          accessibilityRole="button"
          onPress={() => handleWorkspaceChange(workspace)}
          style={({ pressed }) => {
            return [s.chip, isSelected && s.chipSelected, pressed && s.chipPressed];
          }}
        >
          <Text style={[s.chipText, isSelected && s.chipTextSelected]}>{label}</Text>
        </Pressable>
      );
    },
    [selectedWorkspace, handleWorkspaceChange],
  );

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

      {/* Workspace Filter */}
      <View style={s.filterSection}>
        <Text style={s.filterLabel}>WORKSPACE</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScrollContent}
        >
          {renderWorkspaceChip('all', 'All')}
          {workspaces.map((workspace) => renderWorkspaceChip(workspace, workspace))}
        </ScrollView>
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <FlatList
          data={filteredAgents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AgentCard
              agent={item}
              onPress={() => onAgentPress(item.id, item.endpoint_id, item.name)}
            />
          )}
          ItemSeparatorComponent={AgentCardSeparator}
          scrollEnabled={filteredAgents.length > 0}
          bounces={filteredAgents.length > 0}
          alwaysBounceVertical={filteredAgents.length > 0}
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
              <Text style={s.emptyTitle}>
                {selectedWorkspace === 'all'
                  ? 'NO AGENTS REGISTERED'
                  : 'NO AGENTS IN THIS WORKSPACE'}
              </Text>
              <Text style={s.emptyDesc}>
                {selectedWorkspace === 'all'
                  ? 'Register your first agent via the CLI or API.'
                  : `No agents found in the "${selectedWorkspace}" workspace.`}
              </Text>
            </View>
          }
          contentContainerStyle={filteredAgents.length === 0 ? s.emptyContainer : s.listContent}
        />
      </Animated.View>
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
  filterSection: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    backgroundColor: '#0D0D0D',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  filterLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1.5,
  },
  chipScrollContent: {
    gap: 6,
    padding: 4,
    paddingRight: 20,
    borderRadius: 22,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  chip: {
    height: 36,
    minWidth: 56,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  chipSelected: {
    backgroundColor: '#FF6B35',
    borderColor: '#FF6B35',
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: 'normal',
    color: '#DDDDDD',
  },
  chipTextSelected: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  listContainer: {
    flex: 1,
  },
});
