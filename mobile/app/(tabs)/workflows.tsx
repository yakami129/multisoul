import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import {
  WorkflowFormScreen,
  type WorkflowFormInitialValues,
} from '@/features/workflows/components/WorkflowFormScreen';
import { WorkflowListScreen } from '@/features/workflows/components/WorkflowListScreen';
import { WorkflowTemplatePickerScreen } from '@/features/workflows/components/WorkflowTemplatePickerScreen';
import {
  createWorkflow,
  deleteWorkflow,
  disableWorkflow,
  enableWorkflow,
  fetchWorkflows,
  updateWorkflow,
} from '@/features/workflows/services/workflowService';
import { type WorkflowTemplate } from '@/features/workflows/templates';
import { type WorkflowInput, type Workflow } from '@/features/workflows/types';
import { useEndpointStore } from '@/store/endpointStore';
import { brandColors } from '@/theme/brandRefresh';

function workflowToFormValues(wf: Workflow): WorkflowFormInitialValues {
  return {
    name: wf.name,
    agent_id: wf.agent_id,
    project_id: wf.project_id,
    resource_id: wf.resource_id,
    prompt: wf.prompt,
    mode: wf.mode,
    schedule_kind: wf.schedule_kind,
    time_of_day: wf.time_of_day,
    day_of_week: wf.day_of_week,
    interval_minutes: wf.interval_minutes,
    max_runs: wf.max_runs,
    expires_at: wf.expires_at,
    stop_condition: wf.stop_condition,
  };
}

export default function WorkflowsTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const queryClient = useQueryClient();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [templateInitialValues, setTemplateInitialValues] =
    useState<WorkflowFormInitialValues | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);

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
      const agent = agents.find((a) => a.id === (input.resource_id ?? input.agent_id));
      if (!agent) throw new Error('Agent not found');
      const ep = endpoints.find((e) => e.id === agent.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await createWorkflow(ep, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      closeWorkflowSheet();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ workflow, input }: { workflow: Workflow; input: WorkflowInput }) => {
      const ep = endpoints.find((e) => e.id === workflow.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await updateWorkflow(ep, workflow.id, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      closeWorkflowSheet();
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

  const visibleFormAgents = editingWorkflow
    ? agents.filter((agent) => agent.endpoint_id === editingWorkflow.endpoint_id)
    : agents;

  function openBlankWorkflow() {
    setEditingWorkflow(null);
    setTemplateInitialValues(null);
    setShowTemplatePicker(false);
    setShowForm(true);
  }

  function openTemplateWorkflow(template: WorkflowTemplate) {
    setEditingWorkflow(null);
    setTemplateInitialValues(template.initial_values as WorkflowFormInitialValues);
    setShowTemplatePicker(false);
    setShowForm(true);
  }

  function openEditWorkflow(workflow: Workflow) {
    setShowTemplatePicker(false);
    setShowForm(false);
    setTemplateInitialValues(null);
    setEditingWorkflow(workflow);
  }

  function closeWorkflowSheet() {
    setShowTemplatePicker(false);
    setShowForm(false);
    setTemplateInitialValues(null);
    setEditingWorkflow(null);
  }

  return (
    <>
      <WorkflowListScreen
        workflows={workflows}
        hasEndpoints={endpoints.length > 0}
        isRefreshing={isFetching}
        onCreateWorkflow={() => setShowTemplatePicker(true)}
        onToggleEnabled={(workflowId, enabled, endpointId) =>
          toggleMutation.mutate({ workflowId, enabled, endpointId })
        }
        onOpenWorkflow={(wf) =>
          router.push(`/workflow/${encodeURIComponent(wf.id)}` as `/${string}`)
        }
        onEditWorkflow={openEditWorkflow}
        onDeleteWorkflow={(wf) => deleteMutation.mutate(wf)}
      />
      <Modal
        visible={showTemplatePicker || showForm || editingWorkflow !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeWorkflowSheet}
      >
        <View style={{ flex: 1, backgroundColor: brandColors.cream }}>
          {showTemplatePicker ? (
            <WorkflowTemplatePickerScreen
              onSelectBlank={openBlankWorkflow}
              onSelectTemplate={openTemplateWorkflow}
              onCancel={closeWorkflowSheet}
            />
          ) : showForm || editingWorkflow ? (
            <WorkflowFormScreen
              key={
                editingWorkflow
                  ? `edit-${editingWorkflow.endpoint_id}-${editingWorkflow.id}`
                  : templateInitialValues
                    ? `template-${templateInitialValues.name}`
                    : 'blank'
              }
              agents={visibleFormAgents}
              endpoints={endpoints}
              lockedEndpointId={editingWorkflow?.endpoint_id}
              initialValues={
                editingWorkflow
                  ? workflowToFormValues(editingWorkflow)
                  : (templateInitialValues ?? undefined)
              }
              title={editingWorkflow ? t('workflows.titleEdit') : t('workflows.titleNew')}
              onSave={(input) =>
                editingWorkflow
                  ? updateMutation.mutate({ workflow: editingWorkflow, input })
                  : createMutation.mutate(input)
              }
              onCancel={closeWorkflowSheet}
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
}
