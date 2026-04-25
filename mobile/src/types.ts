export type AgentStatus = 'active' | 'inactive' | 'error';

export interface Agent {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApiError {
  error: string;
  code: string;
}
