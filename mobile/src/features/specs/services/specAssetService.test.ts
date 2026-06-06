import { getEndpointClient } from '@/api/endpointClient';
import { type Endpoint } from '@/types';
import {
  createSpecIdea,
  fetchSpecArtifactDetail,
  fetchSpecArtifacts,
  fetchSpecIdeas,
  startSpecIdeaInterview,
  startSpecImplementation,
  updateSpecIdea,
} from './specAssetService';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({ get: mockGet, post: mockPost, patch: mockPatch })),
}));

const endpoint: Endpoint = {
  id: 'ep-1',
  label: 'Office Mac',
  base_url: 'http://office.local:8765',
  token: 'tok-office',
  last_seen_at: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('fetches and normalizes spec ideas from CLI snake_case responses', async () => {
  mockGet.mockResolvedValueOnce({
    data: {
      ideas: [
        {
          id: 'idea-1',
          title: 'Idea',
          status: 'unexpected',
          target_agent_id: 'agent-1',
          target_repo_path: '/repo/multisoul',
          target_agent_name: 'Codex Runner',
          body: 'Body',
          notes: [{ id: 'note-1', body: 'Note', created_at: 1, updated_at: 2 }],
          attachments: [{ id: 'att-1', kind: 'bad-kind', title: 'Log', created_at: 3 }],
          interview_conversation_id: 'conv-1',
          created_at: 4,
          updated_at: 5,
        },
      ],
    },
  });

  const ideas = await fetchSpecIdeas(endpoint);

  expect(getEndpointClient).toHaveBeenCalledWith('http://office.local:8765', 'tok-office');
  expect(mockGet).toHaveBeenCalledWith('/api/v1/spec-ideas');
  expect(ideas[0]).toMatchObject({
    id: 'idea-1',
    status: 'open',
    targetEndpointId: 'ep-1',
    notes: [{ id: 'note-1', body: 'Note', createdAt: 1, updatedAt: 2 }],
    attachments: [{ id: 'att-1', kind: 'log', title: 'Log', createdAt: 3 }],
  });
});

test('creates and updates ideas with asset payload fields', async () => {
  mockPost.mockResolvedValueOnce({
    data: { idea: { id: 'idea-1', title: 'Saved', body: 'Body', created_at: 1, updated_at: 1 } },
  });
  mockPatch.mockResolvedValueOnce({
    data: { idea: { id: 'idea-1', title: 'Archived', status: 'archived', created_at: 1, updated_at: 2 } },
  });

  await createSpecIdea(endpoint, {
    id: 'idea-1',
    body: 'Body',
    title: 'Saved',
    targetAgent: {
      id: 'agent-1',
      name: 'Codex Runner',
      project_path: '/repo/multisoul',
      runtime: 'codex',
      created_at: 1,
      endpoint_id: 'ep-1',
      endpoint_label: 'Office Mac',
    },
  });
  const updated = await updateSpecIdea(endpoint, 'idea-1', {
    status: 'archived',
    archivedAt: 42,
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/spec-ideas',
    expect.objectContaining({
      id: 'idea-1',
      title: 'Saved',
      body: 'Body',
      target_agent_id: 'agent-1',
      target_endpoint_id: 'ep-1',
      target_repo_path: '/repo/multisoul',
      target_agent_name: 'Codex Runner',
    }),
  );
  expect(mockPatch).toHaveBeenCalledWith(
    '/api/v1/spec-ideas/idea-1',
    expect.objectContaining({ status: 'archived', archived_at: 42 }),
  );
  expect(updated.status).toBe('archived');
});

test('starts idea interview and spec implementation through the new endpoints', async () => {
  mockPost
    .mockResolvedValueOnce({ data: { conversation_id: 'interview-conv' } })
    .mockResolvedValueOnce({ data: { conversationId: 'implementation-conv' } });

  const interview = await startSpecIdeaInterview(endpoint, 'idea/slash');
  const implementation = await startSpecImplementation(endpoint, 'spec/slash');

  expect(mockPost).toHaveBeenNthCalledWith(
    1,
    '/api/v1/spec-ideas/idea%2Fslash/interview',
    {},
  );
  expect(mockPost).toHaveBeenNthCalledWith(2, '/api/v1/specs/spec%2Fslash/implement', {});
  expect(interview.conversationId).toBe('interview-conv');
  expect(implementation.conversationId).toBe('implementation-conv');
});

test('fetches specs and detail with latest version fallback', async () => {
  mockGet
    .mockResolvedValueOnce({
      data: [
        {
          id: 'spec-1',
          title: 'Spec',
          slug: 'spec',
          status: 'implementing',
          target_agent_id: 'agent-1',
          target_repo_path: '/repo/multisoul',
          repo_spec_path: 'docs/product-specs/spec.md',
          latest_version_id: 'ver-2',
          interview_conversation_id: 'conv-1',
          created_at: 1,
          updated_at: 2,
        },
      ],
    })
    .mockResolvedValueOnce({
      data: {
        spec: {
          id: 'spec-1',
          title: 'Spec',
          slug: 'spec',
          status: 'ready',
          repo_spec_path: 'docs/product-specs/spec.md',
          latest_version_id: 'ver-2',
          interview_conversation_id: 'conv-1',
          created_at: 1,
          updated_at: 2,
        },
        versions: [
          {
            id: 'ver-2',
            spec_id: 'spec-1',
            revision: 2,
            repo_spec_path: 'docs/product-specs/spec.md',
            markdown: '# Spec',
            markdown_sha256: 'abcdef',
            source_conversation_id: 'conv-1',
            created_at: 3,
          },
        ],
      },
    });

  const specs = await fetchSpecArtifacts(endpoint);
  const detail = await fetchSpecArtifactDetail(endpoint, 'spec-1');

  expect(specs[0]).toMatchObject({ id: 'spec-1', status: 'implementing', targetEndpointId: 'ep-1' });
  expect(mockGet).toHaveBeenNthCalledWith(2, '/api/v1/specs/spec-1');
  expect(detail.latestVersion).toMatchObject({
    id: 'ver-2',
    specId: 'spec-1',
    revision: 2,
    markdownSha256: 'abcdef',
  });
});
