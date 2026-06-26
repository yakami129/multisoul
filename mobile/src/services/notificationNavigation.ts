import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';

export function getNotificationNavTarget(data: Record<string, string | undefined>): string | null {
  if (
    data?.type !== 'task_completed' &&
    data?.type !== 'task_failed' &&
    data?.type !== 'ask_question'
  ) {
    return null;
  }
  const agentId = data.agentId ?? data.agent_id ?? data.resourceId ?? data.resource_id;
  const agentName = data.agentName ?? data.agent_name ?? data.resourceName ?? data.resource_name;
  const convId = data.convId ?? data.conversation_id;
  const endpointId = data.endpointId ?? data.endpoint_id;
  const projectId = data.projectId ?? data.project_id;
  const focusAskId = data.inbox_id;
  if (!agentId || !convId || !endpointId) return null;
  return buildChatDetailPath({
    conversationId: convId,
    endpointId,
    agentId,
    agentName,
    projectId,
    focusAskId,
  });
}
