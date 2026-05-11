export function buildChatDetailPath(params: {
  conversationId: string;
  endpointId: string;
  agentId?: string;
  agentName?: string;
}) {
  const query = [`endpoint_id=${encodeURIComponent(params.endpointId)}`];
  if (params.agentId) query.push(`agent_id=${encodeURIComponent(params.agentId)}`);
  if (params.agentName) query.push(`agent_name=${encodeURIComponent(params.agentName)}`);
  // Return chat detail path with query parameters
  return `/chat/${encodeURIComponent(params.conversationId)}?${query.join('&')}`;
}
