import { type Agent, type Endpoint } from '@/types';
import { type AgentTarget } from './types';

export function resolveAgentTarget(
  agentId: string | undefined,
  agents: Agent[],
  endpoints: Endpoint[],
): AgentTarget | undefined {
  if (!agentId) return undefined;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  const endpoint = endpoints.find((e) => e.id === agent.endpoint_id);
  return {
    endpointId: agent.endpoint_id,
    endpointLabel: endpoint?.label ?? agent.endpoint_label,
    projectId: agent.project_id,
    projectName: agent.project_path,
    agentId: agent.id,
    agentName: agent.name,
    resourceId: agent.id,
    resourceName: agent.name,
    repoPath: agent.project_path,
  };
}
