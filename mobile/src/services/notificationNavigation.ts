import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';

export function getNotificationNavTarget(data: Record<string, string | undefined>): string | null {
  if (data?.type !== 'task_completed' && data?.type !== 'task_failed') return null;
  const { agentId, agentName, convId, endpointId } = data;
  if (!agentId || !convId || !endpointId) return null;
  return buildChatDetailPath({
    conversationId: convId,
    endpointId,
    agentId,
    agentName,
  });
}
