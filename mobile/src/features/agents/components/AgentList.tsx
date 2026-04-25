import React from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
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
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-3 text-slate-500 text-base">Loading agents...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Text className="text-lg font-semibold text-danger mb-2">Failed to load agents.</Text>
        <Text className="text-sm text-slate-400 text-center mb-4">{String(error)}</Text>
        <Button label="Retry" onPress={onRefetch} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900" style={{ paddingTop: insets.top }}>
      <Text className="text-3xl font-bold text-slate-900 dark:text-slate-100 px-4 py-3">
        Agents
      </Text>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <AgentCard agent={item} index={index} onPress={() => onAgentPress(item.id)} />
        )}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={onRefetch} />}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-base text-slate-400">No agents registered yet.</Text>
          </View>
        }
        contentContainerStyle={agents.length === 0 ? { flex: 1 } : { paddingBottom: 24 }}
      />
    </View>
  );
}
