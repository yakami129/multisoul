import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { SpecsHomeScreen } from '@/features/specs/components/SpecsHomeScreen';
import { useSpecEvents } from '@/features/specs/hooks/useSpecEvents';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { useEndpointStore } from '../../src/store/endpointStore';
import { useSpecStore } from '../../src/store/specStore';

export default function SpecsTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const ideas = useSpecStore((s) => s.ideas);
  const specArtifacts = useSpecStore((s) => s.specArtifacts);
  const loadAssets = useSpecStore((s) => s.loadAssets);
  const refreshAssets = useSpecStore((s) => s.refreshAssets);
  const createIdea = useSpecStore((s) => s.createIdea);
  const archiveIdea = useSpecStore((s) => s.archiveIdea);
  const unarchiveIdea = useSpecStore((s) => s.unarchiveIdea);
  const deleteArchivedIdea = useSpecStore((s) => s.deleteArchivedIdea);
  const deleteSpecArtifact = useSpecStore((s) => s.deleteSpecArtifact);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((endpoint) => endpoint.id), 'spec-create'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  React.useEffect(() => {
    void loadAssets().then(() => {
      if (endpoints.length > 0) void refreshAssets(endpoints);
    });
  }, [endpoints, loadAssets, refreshAssets]);

  useSpecEvents({
    endpoints,
    enabled: endpoints.length > 0,
    onRefresh: () => refreshAssets(endpoints),
  });

  return (
    <SpecsHomeScreen
      ideas={ideas}
      specs={specArtifacts}
      endpoints={endpoints}
      agents={agents}
      canCreateIdea
      onCreateIdea={(value) => {
        const targetAgent = value.target
          ? agents.find(
              (agent) =>
                agent.id === value.target?.agentId && agent.endpoint_id === value.target.endpointId,
            )
          : undefined;
        void createIdea({
          title: value.title,
          body: value.body,
          attachments: value.attachments,
          targetAgent,
          targetAgentId: value.target?.agentId,
          targetEndpointId: value.target?.endpointId,
          targetRepoPath: value.target?.repoPath,
          targetAgentName: value.target?.agentName,
        });
      }}
      onOpenIdea={(id) => router.push(`/idea/${encodeURIComponent(id)}` as `/${string}`)}
      onOpenSpec={(id) => router.push(`/spec/${encodeURIComponent(id)}` as `/${string}`)}
      onArchiveIdea={(id) => {
        void archiveIdea(id);
      }}
      onUnarchiveIdea={(id) => {
        void unarchiveIdea(id);
      }}
      onDeleteArchivedIdea={(id) => {
        const idea = ideas.find((item) => item.id === id);
        const endpoint = idea ? endpoints.find((ep) => ep.id === idea.targetEndpointId) : undefined;
        void deleteArchivedIdea(id, endpoint);
      }}
      onDeleteSpec={(id) => {
        const spec = specArtifacts.find((item) => item.id === id);
        const endpoint = spec ? endpoints.find((ep) => ep.id === spec.targetEndpointId) : undefined;
        void deleteSpecArtifact(id, endpoint);
      }}
    />
  );
}
