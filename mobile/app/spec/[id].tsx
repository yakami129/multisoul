import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { SpecDetailScreen } from '@/features/specs/components/SpecDetailScreen';
import { useEndpointStore } from '@/store/endpointStore';
import { useSpecStore } from '../../src/store/specStore';

function resolveSpecId(rawId: string | string[] | undefined): string | undefined {
  if (typeof rawId === 'string') {
    return rawId;
  }
  if (Array.isArray(rawId) && typeof rawId[0] === 'string') {
    return rawId[0];
  }
  return undefined;
}

export default function SpecDetailRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const specId = resolveSpecId(id);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const spec = useSpecStore((s) => s.specs.find((item) => item.id === specId));
  const answerQuestion = useSpecStore((s) => s.answerQuestion);
  const generatePreview = useSpecStore((s) => s.generatePreview);
  const approveSpec = useSpecStore((s) => s.approveSpec);
  const askMore = useSpecStore((s) => s.askMore);
  const dispatchSpec = useSpecStore((s) => s.dispatchSpec);
  const markFailed = useSpecStore((s) => s.markFailed);

  return (
    <SpecDetailScreen
      spec={spec}
      onBack={() => router.back()}
      onAnswer={(answer) => {
        if (!specId) return;
        void answerQuestion(specId, answer);
      }}
      onGenerate={() => {
        if (!specId) return;
        void generatePreview(specId);
      }}
      onApprove={() => {
        if (!specId) return;
        void approveSpec(specId);
      }}
      onAskMore={() => {
        if (!specId) return;
        void askMore(specId);
      }}
      onDispatch={() => {
        if (!specId || !spec) return;
        const endpoint = endpoints.find((item) => item.id === spec.targetEndpointId);
        if (!endpoint) {
          void markFailed(specId, 'Target endpoint is not configured');
          return;
        }
        void dispatchSpec(specId, endpoint)
          .then((result) => {
            router.replace(
              buildChatDetailPath({
                conversationId: result.conversation_id,
                endpointId: spec.targetEndpointId,
                agentId: spec.targetAgentId,
                agentName: spec.targetAgentName,
              }),
            );
          })
          .catch(() => undefined);
      }}
    />
  );
}
