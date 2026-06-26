import { getEndpointClient } from '@/api/endpointClient';
import { type Agent, type Conversation } from '@/types';
import {
  type EndpointInput,
  type Project,
  type ProjectResource,
  type ProjectSession,
} from '../types';

type RawProject = Omit<Project, 'endpoint_id' | 'endpoint_label'>;
type RawProjectSession = Omit<Conversation, 'endpoint_id' | 'agent_name'> & {
  project_id: string | null;
};
type RawProjectResource = Omit<Agent, 'endpoint_id' | 'endpoint_label'> & {
  project_id: string;
  is_default: boolean;
};

function withEndpoint<T extends object>(
  value: T,
  endpoint_id: string,
  endpoint_label: string,
): T & { endpoint_id: string; endpoint_label: string } {
  return { ...value, endpoint_id, endpoint_label };
}

export async function fetchProjectsFromEndpoint(
  base_url: string,
  token: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<Project[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<RawProject[]>('/api/v1/projects');
  return res.data.map((project) => withEndpoint(project, endpoint_id, endpoint_label));
}

export async function fetchAllProjects(endpoints: EndpointInput[]): Promise<Project[]> {
  const results = await Promise.allSettled(
    endpoints.map((ep) => fetchProjectsFromEndpoint(ep.base_url, ep.token, ep.id, ep.label)),
  );
  return results
    .filter((result): result is PromiseFulfilledResult<Project[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

export async function fetchProject(
  base_url: string,
  token: string,
  project_id: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<Project> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<RawProject>(`/api/v1/projects/${project_id}`);
  return withEndpoint(res.data, endpoint_id, endpoint_label);
}

export async function fetchProjectSessions(
  base_url: string,
  token: string,
  project_id: string,
  endpoint_id: string,
  agent_name = '',
): Promise<ProjectSession[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<RawProjectSession[]>(`/api/v1/projects/${project_id}/conversations`);
  return res.data.map((session) => ({ ...session, endpoint_id, agent_name }));
}

export async function fetchProjectResources(
  base_url: string,
  token: string,
  project_id: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<ProjectResource[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<RawProjectResource[]>(`/api/v1/projects/${project_id}/resources`);
  return res.data.map((resource) => withEndpoint(resource, endpoint_id, endpoint_label));
}

export async function createProjectConversation(
  base_url: string,
  token: string,
  project_id: string,
  endpoint_id: string,
  agent_name: string,
  title?: string,
  resource_id?: string,
): Promise<ProjectSession> {
  const client = getEndpointClient(base_url, token);
  const body: { title?: string; resource_id?: string } = {};
  if (title) body.title = title;
  if (resource_id) body.resource_id = resource_id;
  const res = await client.post<RawProjectSession>(
    `/api/v1/projects/${project_id}/conversations`,
    body,
  );
  return { ...res.data, endpoint_id, agent_name };
}
