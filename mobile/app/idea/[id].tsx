import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { IdeaDetailScreen } from '@/features/specs/components/IdeaDetailScreen';
import { startSpecIdeaInterview } from '@/features/specs/services/specAssetService';
import { saveIdea } from '@/features/specs/services/specAssetRepository';
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
  const [isStartingInterview, setIsStartingInterview] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string>();

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
    void startSpecIdeaInterview(endpoint, idea.id)
      .then(async (result) => {
        if (result.idea) {
          await saveIdea(result.idea, null, null);
          await loadAssets();
        }
        openChat(result.conversationId);
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start interview.');
      })
      .finally(() => setIsStartingInterview(false));
  }, [endpoints, idea, isStartingInterview, loadAssets, openChat]);

  return (
    <IdeaDetailScreen
      idea={idea}
      isStartingInterview={isStartingInterview}
      errorMessage={errorMessage}
      onBack={() => router.back()}
      onStartInterview={handleStartInterview}
      onOpenInterviewChat={() => {
        if (idea?.interviewConversationId) openChat(idea.interviewConversationId);
      }}
      onOpenConvertedSpec={() => {
        if (idea?.convertedSpecId) router.push(`/spec/${encodeURIComponent(idea.convertedSpecId)}` as `/${string}`);
      }}
      onArchive={() => {
        if (ideaId) void archiveIdea(ideaId);
      }}
      onUnarchive={() => {
        if (ideaId) void unarchiveIdea(ideaId);
      }}
    />
  );
}
