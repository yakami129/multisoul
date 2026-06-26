import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ProjectList, fetchAllProjects } from '../../src/features/projects';
import { AddEndpointModal } from '../../src/features/settings/components/AddEndpointModal';
import { useEndpointStore } from '../../src/store/endpointStore';

export default function ProjectListScreen() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addEndpoint = useEndpointStore((s) => s.addEndpoint);
  const [addEndpointVisible, setAddEndpointVisible] = React.useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['projects', endpoints.map((e) => e.id)],
    queryFn: () => fetchAllProjects(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  return (
    <>
      <ProjectList
        projects={data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        isFetching={isFetching}
        onRefetch={() => {
          void refetch();
        }}
        onProjectPress={(id, endpoint_id) => {
          router.push(
            `/project/${encodeURIComponent(id)}?endpoint_id=${encodeURIComponent(endpoint_id)}`,
          );
        }}
        onAddEndpoint={() => setAddEndpointVisible(true)}
        onOpenWorkflows={() => router.push('/workflows')}
      />
      <AddEndpointModal
        visible={addEndpointVisible}
        initialTab="qr"
        onClose={() => setAddEndpointVisible(false)}
        onAdd={(label, base_url, token) => {
          void addEndpoint({ label, base_url, token });
        }}
      />
    </>
  );
}
