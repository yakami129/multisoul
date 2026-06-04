import type { Agent } from '@/types';

export type EndpointFilterOption = {
  id: string;
  label: string;
  count: number;
};

function endpointLabel(agent: Agent) {
  return agent.endpoint_label.trim() || 'Unnamed machine';
}

export function getEndpointFilterOptions(agents: Agent[]): EndpointFilterOption[] {
  const endpoints = new Map<string, EndpointFilterOption>();
  for (const agent of agents) {
    const current = endpoints.get(agent.endpoint_id);
    if (current) {
      current.count += 1;
      continue;
    }
    endpoints.set(agent.endpoint_id, {
      id: agent.endpoint_id,
      label: endpointLabel(agent),
      count: 1,
    });
  }
  return [{ id: 'all', label: 'All Machines', count: agents.length }, ...endpoints.values()];
}
