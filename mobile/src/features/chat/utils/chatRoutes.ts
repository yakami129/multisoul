export function buildChatDetailPath(params: {
  conversationId: string;
  endpointId: string;
  agentId?: string;
  agentName?: string;
  projectId?: string;
  focusAskId?: string;
}) {
  const query = [`endpoint_id=${encodeURIComponent(params.endpointId)}`];
  if (params.agentId) query.push(`agent_id=${encodeURIComponent(params.agentId)}`);
  if (params.agentName) query.push(`agent_name=${encodeURIComponent(params.agentName)}`);
  if (params.projectId) query.push(`project_id=${encodeURIComponent(params.projectId)}`);
  if (params.focusAskId) query.push(`focus_ask_id=${encodeURIComponent(params.focusAskId)}`);
  // Return chat detail path with query parameters
  return `/chat/${encodeURIComponent(params.conversationId)}?${query.join('&')}`;
}
