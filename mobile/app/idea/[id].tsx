import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { AgentTargetPickerSheet } from '@/components/agent-target';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { IdeaDetailScreen } from '@/features/specs/components/IdeaDetailScreen';
import { IdeaEditorSheet, type IdeaEditorValue } from '@/features/specs/components/IdeaEditorSheet';
import { type SpecTarget } from '@/features/specs/components/specUiModels';
import { saveIdea } from '@/features/specs/services/specAssetRepository';
import {
  startSpecIdeaInterview,
  syncSpecIdeaBeforeServerAction,
} from '@/features/specs/services/specAssetService';
import { useEndpointStore } from '@/store/endpointStore';
import { useSpecStore } from '../../src/store/specStore';

function resolveIdeaId(rawId: string | string[] | undefined): string | undefined {
  if (typeof rawId === 'string') return rawId;
  if (Array.isArray(rawId) && typeof rawId[0] === 'string') return rawId[0];
  return undefined;
}

export default function IdeaDetailRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ideaId = resolveIdeaId(id);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const idea = useSpecStore((s) => s.ideas.find((item) => item.id === ideaId));
  const loadAssets = useSpecStore((s) => s.loadAssets);
  const archiveIdea = useSpecStore((s) => s.archiveIdea);
  const unarchiveIdea = useSpecStore((s) => s.unarchiveIdea);
  const updateIdea = useSpecStore((s) => s.updateIdea);
  const [isStartingInterview, setIsStartingInterview] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string>();
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [targetPickerVisible, setTargetPickerVisible] = React.useState(false);
  const [draftTarget, setDraftTarget] = React.useState<SpecTarget | undefined>();

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((ep) => ep.id), 'idea-edit'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const buildIdeaTarget = React.useCallback(
    (current: typeof idea): SpecTarget | undefined => {
      if (!current?.targetAgentId) return undefined;
      return {
        endpointId: current.targetEndpointId,
        endpointLabel: endpoints.find((ep) => ep.id === current.targetEndpointId)?.label ?? '',
        agentId: current.targetAgentId,
        agentName: current.targetAgentName,
        repoPath: current.targetRepoPath,
      };
    },
    [endpoints],
  );

  const openEditor = React.useCallback(() => {
    setDraftTarget(buildIdeaTarget(idea));
    setEditorVisible(true);
  }, [idea, buildIdeaTarget]);

  const handleEditSave = React.useCallback(
    (value: IdeaEditorValue) => {
      if (!ideaId) return;
      const target = value.target ?? draftTarget;
      void updateIdea(ideaId, {
        title: value.title,
        body: value.body,
        attachments: value.attachments,
        targetAgentId: target?.agentId,
        targetEndpointId: target?.endpointId,
        targetRepoPath: target?.repoPath,
        targetAgentName: target?.agentName,
      });
      setEditorVisible(false);
    },
    [ideaId, draftTarget, updateIdea],
  );

  const openChat = React.useCallback(
    (conversationId: string) => {
      if (!idea) return;
      router.push(
        buildChatDetailPath({
          conversationId,
          endpointId: idea.targetEndpointId,
          agentId: idea.targetAgentId,
          agentName: idea.targetAgentName,
        }) as `/${string}`,
      );
    },
    [idea, router],
  );

  const handleStartInterview = React.useCallback(() => {
    if (!idea || isStartingInterview) return;
    const endpoint = endpoints.find((item) => item.id === idea.targetEndpointId);
    if (!endpoint) {
      setErrorMessage('Target endpoint is not configured.');
      return;
    }
    setIsStartingInterview(true);
    setErrorMessage(undefined);
    void syncSpecIdeaBeforeServerAction(endpoint, idea)
      .then(async (syncedIdea) => {
        if (syncedIdea !== idea || idea.pendingMutation) {
          await saveIdea(syncedIdea, null, null);
          await loadAssets();
        }
        return startSpecIdeaInterview(endpoint, syncedIdea.id);
      })
      .then(async (result) => {
        if (result.idea) {
          await saveIdea(result.idea, null, null);
          await loadAssets();
        }
        openChat(result.conversationId);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to start interview.';
        if (idea.pendingMutation) void saveIdea(idea, idea.pendingMutation, message);
        setErrorMessage(message);
      })
      .finally(() => setIsStartingInterview(false));
  }, [endpoints, idea, isStartingInterview, loadAssets, openChat]);

  const editorInitialValue: IdeaEditorValue | undefined = React.useMemo(() => {
    if (!idea) return undefined;
    return {
      title: idea.title,
      body: idea.body,
      attachments: idea.attachments,
      target: buildIdeaTarget(idea),
    };
  }, [idea, buildIdeaTarget]);

  return (
    <>
      <IdeaDetailScreen
        idea={idea}
        isStartingInterview={isStartingInterview}
        errorMessage={errorMessage}
        onBack={() => router.back()}
        onEdit={openEditor}
        onStartInterview={handleStartInterview}
        onOpenInterviewChat={() => {
          if (idea?.interviewConversationId) openChat(idea.interviewConversationId);
        }}
        onOpenConvertedSpec={() => {
          if (idea?.convertedSpecId)
            router.push(`/spec/${encodeURIComponent(idea.convertedSpecId)}` as `/${string}`);
        }}
        onArchive={() => {
          if (ideaId) void archiveIdea(ideaId);
        }}
        onUnarchive={() => {
          if (ideaId) void unarchiveIdea(ideaId);
        }}
      />
      <IdeaEditorSheet
        visible={editorVisible}
        initialValue={editorInitialValue}
        target={draftTarget}
        onChooseTarget={() => setTargetPickerVisible(true)}
        onClose={() => setEditorVisible(false)}
        onSave={handleEditSave}
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
