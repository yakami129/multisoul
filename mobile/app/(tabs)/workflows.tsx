import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import { WorkflowFormScreen } from '@/features/workflows/components/WorkflowFormScreen';
import { WorkflowListScreen } from '@/features/workflows/components/WorkflowListScreen';
import {
  createWorkflow,
  deleteWorkflow,
  disableWorkflow,
  enableWorkflow,
  fetchWorkflows,
} from '@/features/workflows/services/workflowService';
import { type WorkflowInput, type Workflow } from '@/features/workflows/types';
import { useEndpointStore } from '@/store/endpointStore';
import { brandColors } from '@/theme/brandRefresh';

export default function WorkflowsTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: workflows = [], isFetching } = useQuery({
    queryKey: ['workflows', endpoints.map((e) => e.id)],
    queryFn: async () => {
      const results = await Promise.allSettled(endpoints.map((ep) => fetchWorkflows(ep)));
      return results
        .filter((r): r is PromiseFulfilledResult<Workflow[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
    },
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id), 'workflows'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({
      workflowId,
      enabled,
      endpointId,
    }: {
      workflowId: string;
      enabled: boolean;
      endpointId: string;
    }) => {
      const ep = endpoints.find((e) => e.id === endpointId);
      if (!ep) return;
      if (enabled) {
        await enableWorkflow(ep, workflowId);
      } else {
        await disableWorkflow(ep, workflowId);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: WorkflowInput) => {
      const agent = agents.find((a) => a.id === input.agent_id);
      if (!agent) throw new Error('Agent not found');
      const ep = endpoints.find((e) => e.id === agent.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await createWorkflow(ep, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (wf: Workflow) => {
      const ep = endpoints.find((e) => e.id === wf.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await deleteWorkflow(ep, wf.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  return (
    <>
      <WorkflowListScreen
        workflows={workflows}
        hasEndpoints={endpoints.length > 0}
        isRefreshing={isFetching}
        onCreateWorkflow={() => setShowForm(true)}
        onToggleEnabled={(workflowId, enabled, endpointId) =>
          toggleMutation.mutate({ workflowId, enabled, endpointId })
        }
        onOpenWorkflow={(wf) =>
          router.push(`/workflow/${encodeURIComponent(wf.id)}` as `/${string}`)
        }
        onDeleteWorkflow={(wf) => deleteMutation.mutate(wf)}
      />
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: brandColors.cream }}>
          <WorkflowFormScreen
            agents={agents}
            onSave={(input) => createMutation.mutate(input)}
            onCancel={() => setShowForm(false)}
          />
        </View>
      </Modal>
    </>
  );
}
