import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { SpecDetailScreen } from '@/features/specs/components/SpecDetailScreen';
import {
  loadSpecDetail,
  saveSpecArtifact,
  saveSpecArtifactDetail,
} from '@/features/specs/services/specAssetRepository';
import {
  fetchSpecArtifactDetail,
  startSpecImplementation,
} from '@/features/specs/services/specAssetService';
import { type SpecArtifactDetail } from '@/features/specs/types';
import { useEndpointStore } from '@/store/endpointStore';
import { useSpecStore } from '../../src/store/specStore';

function resolveSpecId(rawId: string | string[] | undefined): string | undefined {
  if (typeof rawId === 'string') return rawId;
  if (Array.isArray(rawId) && typeof rawId[0] === 'string') return rawId[0];
  return undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Spec action failed.';
}

export default function SpecDetailRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const specId = resolveSpecId(id);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const artifacts = useSpecStore((s) => s.specArtifacts);
  const legacySpec = useSpecStore((s) => s.specs.find((item) => item.id === specId));
  const ideas = useSpecStore((s) => s.ideas);
  const loadAssets = useSpecStore((s) => s.loadAssets);
  const fallbackSpec = artifacts.find((item) => item.id === specId);
  const [detail, setDetail] = React.useState<SpecArtifactDetail>();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isStartingImplementation, setIsStartingImplementation] = React.useState(false);
  const [showFullMarkdown, setShowFullMarkdown] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string>();

  const spec = detail?.spec ?? fallbackSpec;
  const sourceIdea = ideas.find((item) => item.id === spec?.sourceIdeaId);
  const endpoint = endpoints.find((item) => item.id === spec?.targetEndpointId);

  React.useEffect(() => {
    let cancelled = false;
    if (!specId) return undefined;
    setIsLoading(true);
    setErrorMessage(undefined);
    void loadSpecDetail(specId)
      .then((cached) => {
        if (!cancelled && cached) setDetail(cached);
        const currentSpec = cached?.spec ?? fallbackSpec;
        const currentEndpoint = endpoints.find((item) => item.id === currentSpec?.targetEndpointId);
        if (!currentEndpoint) return undefined;
        return fetchSpecArtifactDetail(currentEndpoint, specId);
      })
      .then(async (remote) => {
        if (!remote) return;
        await saveSpecArtifactDetail(remote);
        if (!cancelled) {
          setDetail(remote);
          await loadAssets();
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoints, fallbackSpec, loadAssets, specId]);

  const openChat = React.useCallback(
    (conversationId: string | undefined) => {
      if (!conversationId || !spec) return;
      router.push(
        buildChatDetailPath({
          conversationId,
          endpointId: spec.targetEndpointId,
          agentId: spec.targetAgentId,
        }) as `/${string}`,
      );
    },
    [router, spec],
  );

  const handleStartImplementation = React.useCallback(() => {
    if (!spec || !endpoint || isStartingImplementation) {
      if (!endpoint) setErrorMessage('Target endpoint is not configured.');
      return;
    }
    setIsStartingImplementation(true);
    setErrorMessage(undefined);
    void startSpecImplementation(endpoint, spec.id)
      .then(async (result) => {
        if (result.spec) {
          await saveSpecArtifact(result.spec);
          await loadAssets();
        }
        openChat(result.conversationId);
      })
      .catch((error: unknown) => setErrorMessage(errorText(error)))
      .finally(() => setIsStartingImplementation(false));
  }, [endpoint, isStartingImplementation, loadAssets, openChat, spec]);

  return (
    <SpecDetailScreen
      detail={detail}
      fallbackSpec={fallbackSpec}
      legacySpec={legacySpec}
      sourceIdeaTitle={sourceIdea?.title}
      isLoading={isLoading}
      isStartingImplementation={isStartingImplementation}
      showFullMarkdown={showFullMarkdown}
      errorMessage={errorMessage}
      onBack={() => router.back()}
      onStartImplementation={handleStartImplementation}
      onOpenInterviewChat={() => openChat(spec?.interviewConversationId)}
      onOpenImplementationChat={() => openChat(spec?.latestImplementationConversationId)}
      onOpenSourceIdea={() => {
        if (spec?.sourceIdeaId)
          router.push(`/idea/${encodeURIComponent(spec.sourceIdeaId)}` as `/${string}`);
      }}
      onReadFull={() => setShowFullMarkdown((value) => !value)}
    />
  );
}
