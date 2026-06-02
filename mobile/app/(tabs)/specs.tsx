import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import { SpecsListScreen } from '@/features/specs/components/SpecsListScreen';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { useEndpointStore } from '../../src/store/endpointStore';
import { useSpecStore } from '../../src/store/specStore';

export default function SpecsTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const specs = useSpecStore((s) => s.specs);
  const createSpec = useSpecStore((s) => s.createSpec);
  const deleteSpec = useSpecStore((s) => s.deleteSpec);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((endpoint) => endpoint.id), 'spec-create'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const handleCreateSpec = React.useCallback(async () => {
    const targetAgent = agents[0];
    if (!targetAgent) return;
    const spec = await createSpec({ title: 'Untitled Spec', targetAgent });
    router.push(`/spec/${encodeURIComponent(spec.id)}` as `/${string}`);
  }, [agents, createSpec, router]);

  const handleDeleteSpec = React.useCallback(
    (id: string) => {
      const spec = specs.find((item) => item.id === id);
      if (!spec) return;
      Alert.alert('Delete Spec', `Delete "${spec.title}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteSpec(id);
          },
        },
      ]);
    },
    [deleteSpec, specs],
  );

  return (
    <SpecsListScreen
      specs={specs}
      canCreate={agents.length > 0}
      onCreateSpec={() => {
        void handleCreateSpec();
      }}
      onOpenSpec={(id) => router.push(`/spec/${encodeURIComponent(id)}` as `/${string}`)}
      onDeleteSpec={handleDeleteSpec}
    />
  );
}
