export interface AgentTarget {
  endpointId: string;
  endpointLabel: string;
  projectId?: string | null;
  projectName?: string | null;
  agentId: string;
  agentName: string;
  resourceId?: string | null;
  resourceName?: string | null;
  repoPath: string;
}
