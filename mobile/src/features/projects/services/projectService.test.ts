import {
  createProjectConversation,
  fetchAllProjects,
  fetchProject,
  fetchProjectResources,
  fetchProjectSessions,
  fetchProjectsFromEndpoint,
} from './projectService';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet, post: mockPost })),
}));

const BASE_URL = 'http://localhost:9000';
const TOKEN = 'test-token';
const ENDPOINT_ID = 'ep-1';
const ENDPOINT_LABEL = 'Local';

const rawProject = {
  id: 'p1',
  name: 'multiSoul',
  project_path: '/Users/me/code/multisoul',
  normalized_project_path: '/users/me/code/multisoul',
  default_resource_id: 'a1',
  created_at: 1,
  updated_at: 2,
  last_activity_at: 3,
  session_counts: {
    idle: 1,
    running: 0,
    awaiting_question: 0,
    completed: 2,
    failed: 0,
  },
  resource_count: 2,
};

describe('projectService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('fetchProjectsFromEndpoint injects endpoint metadata', async () => {
    mockGet.mockResolvedValueOnce({ data: [rawProject] });

    const projects = await fetchProjectsFromEndpoint(BASE_URL, TOKEN, ENDPOINT_ID, ENDPOINT_LABEL);

    expect(projects).toEqual([
      { ...rawProject, endpoint_id: ENDPOINT_ID, endpoint_label: ENDPOINT_LABEL },
    ]);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/projects');
  });

  it('fetchAllProjects keeps successful endpoints when another endpoint fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    mockGet.mockResolvedValueOnce({ data: [rawProject] });

    const projects = await fetchAllProjects([
      { id: 'ep-offline', label: 'Offline', base_url: 'http://offline', token: 'bad' },
      { id: ENDPOINT_ID, label: ENDPOINT_LABEL, base_url: BASE_URL, token: TOKEN },
    ]);

    expect(projects).toEqual([
      { ...rawProject, endpoint_id: ENDPOINT_ID, endpoint_label: ENDPOINT_LABEL },
    ]);
  });

  it('fetchProject returns one project by id', async () => {
    mockGet.mockResolvedValueOnce({ data: rawProject });

    const project = await fetchProject(BASE_URL, TOKEN, 'p1', ENDPOINT_ID, ENDPOINT_LABEL);

    expect(project.id).toBe('p1');
    expect(project.endpoint_id).toBe(ENDPOINT_ID);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/projects/p1');
  });

  it('fetchProjectSessions injects endpoint metadata', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'c1',
          agent_id: 'a1',
          project_id: 'p1',
          title: 'Plan',
          created_at: 1,
          last_message_at: 2,
          status: 'idle',
          model_id: null,
        },
      ],
    });

    const sessions = await fetchProjectSessions(BASE_URL, TOKEN, 'p1', ENDPOINT_ID, 'Codex');

    expect(sessions[0]).toMatchObject({ id: 'c1', endpoint_id: ENDPOINT_ID, agent_name: 'Codex' });
    expect(mockGet).toHaveBeenCalledWith('/api/v1/projects/p1/conversations');
  });

  it('fetchProjectResources injects endpoint metadata', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          project_id: 'p1',
          name: 'codex',
          project_path: '/repo',
          runtime: 'codex',
          created_at: 1,
          is_default: true,
        },
      ],
    });

    const resources = await fetchProjectResources(
      BASE_URL,
      TOKEN,
      'p1',
      ENDPOINT_ID,
      ENDPOINT_LABEL,
    );

    expect(resources[0]).toMatchObject({
      id: 'a1',
      endpoint_id: ENDPOINT_ID,
      endpoint_label: ENDPOINT_LABEL,
    });
    expect(mockGet).toHaveBeenCalledWith('/api/v1/projects/p1/resources');
  });

  it('createProjectConversation posts optional title and resource id', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 'c1',
        agent_id: 'a1',
        project_id: 'p1',
        title: 'New Session',
        created_at: 1,
        last_message_at: 1,
        status: 'idle',
        model_id: null,
      },
    });

    const session = await createProjectConversation(
      BASE_URL,
      TOKEN,
      'p1',
      ENDPOINT_ID,
      'Codex',
      'New Session',
      'a1',
    );

    expect(session).toMatchObject({ id: 'c1', endpoint_id: ENDPOINT_ID, agent_name: 'Codex' });
    expect(mockPost).toHaveBeenCalledWith('/api/v1/projects/p1/conversations', {
      title: 'New Session',
      resource_id: 'a1',
    });
  });
});
