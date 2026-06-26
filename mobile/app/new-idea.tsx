import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { AgentTargetPickerSheet } from '@/components/agent-target';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import { IdeaEditorSheet, type IdeaEditorValue } from '@/features/specs/components/IdeaEditorSheet';
import { type SpecIdeaAttachment, type SpecTarget } from '@/features/specs/components/specUiModels';
import { useEndpointStore } from '@/store/endpointStore';
import { useSpecStore } from '../src/store/specStore';

function buildLinkAttachment(url: string): SpecIdeaAttachment {
  return {
    id: `link-${Date.now()}`,
    kind: 'link',
    title: 'Link',
    uri: url,
    createdAt: Date.now(),
  };
}

export default function NewIdeaRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    body?: string;
    url?: string;
    title?: string;
  }>();

  const endpoints = useEndpointStore((s) => s.endpoints);
  const createIdea = useSpecStore((s) => s.createIdea);

  const [targetPickerVisible, setTargetPickerVisible] = React.useState(false);
  const [draftTarget, setDraftTarget] = React.useState<SpecTarget | undefined>();

  // Capture initial params once so the editor value is stable across renders.
  const initialParamsRef = React.useRef(params);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((ep) => ep.id), 'new-idea'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const initialAttachments: SpecIdeaAttachment[] = React.useMemo(() => {
    const { url } = initialParamsRef.current;
    return url ? [buildLinkAttachment(url)] : [];
  }, []);

  const initialValue = React.useMemo(() => {
    const { title, body } = initialParamsRef.current;
    return {
      title: title ?? '',
      body: body ?? '',
      attachments: initialAttachments,
    };
  }, [initialAttachments]);

  const handleSave = React.useCallback(
    async (value: IdeaEditorValue) => {
      const target = value.target ?? draftTarget;
      const idea = await createIdea({
        title: value.title,
        body: value.body,
        attachments: value.attachments,
        targetAgentId: target?.agentId,
        targetEndpointId: target?.endpointId,
        targetRepoPath: target?.repoPath,
        targetAgentName: target?.agentName,
        targetProjectId: target?.projectId ?? undefined,
        targetProjectName: target?.projectName ?? target?.repoPath,
        targetResourceId: target?.resourceId ?? target?.agentId,
        targetResourceName: target?.resourceName ?? target?.agentName,
      });
      router.replace(`/idea/${idea.id}` as `/${string}`);
    },
    [createIdea, draftTarget, router],
  );

  const handleClose = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/specs' as `/${string}`);
    }
  }, [router]);

  return (
    <>
      <IdeaEditorSheet
        visible
        initialValue={initialValue}
        target={draftTarget}
        onChooseTarget={() => setTargetPickerVisible(true)}
        onClose={handleClose}
        onSave={(value) => void handleSave(value)}
      >
        <AgentTargetPickerSheet
          visible={targetPickerVisible}
          endpoints={endpoints}
          agents={agents}
          selectedTarget={draftTarget}
          presentation="inline"
          onClose={() => setTargetPickerVisible(false)}
          onDone={(target) => {
            setDraftTarget(target);
            setTargetPickerVisible(false);
          }}
        />
      </IdeaEditorSheet>
    </>
  );
}
