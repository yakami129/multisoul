import {
  deleteSpecArtifact,
  loadIdeas,
  loadPendingIdeas,
  loadSpecDetail,
  loadSpecs,
  replaceIdeasForEndpoint,
  replaceSpecsForEndpoint,
  saveIdea,
  saveSpecArtifactDetail,
} from './specAssetRepository';

const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();

jest.mock('@/db', () => ({
  getDb: () => ({ runAsync: mockRunAsync, getAllAsync: mockGetAllAsync }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllAsync.mockResolvedValue([]);
});

test('saves ideas with serialized notes, attachments, and pending mutation state', async () => {
  await saveIdea(
    {
      id: 'idea-1',
      title: 'Idea',
      status: 'open',
      targetAgentId: 'agent-1',
      targetEndpointId: 'ep-1',
      targetRepoPath: '/repo/multisoul',
      targetAgentName: 'Codex Runner',
      body: 'Body',
      notes: [{ id: 'note-1', body: 'Note', createdAt: 1, updatedAt: 2 }],
      attachments: [{ id: 'att-1', kind: 'link', title: 'Issue', createdAt: 3 }],
      createdAt: 4,
      updatedAt: 5,
    },
    'create',
    'offline',
  );

  expect(mockRunAsync).toHaveBeenCalledWith(
    expect.stringContaining('INSERT OR REPLACE INTO spec_ideas'),
    [
      'idea-1',
      'Idea',
      'open',
      'agent-1',
      'ep-1',
      '/repo/multisoul',
      'Codex Runner',
      'Body',
      JSON.stringify([{ id: 'note-1', body: 'Note', createdAt: 1, updatedAt: 2 }]),
      JSON.stringify([{ id: 'att-1', kind: 'link', title: 'Issue', createdAt: 3 }]),
      null,
      null,
      null,
      'create',
      'offline',
      4,
      5,
      null,
    ],
  );
});

test('loads cached ideas and pending endpoint mutations', async () => {
  mockGetAllAsync
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'idea-1',
        title: 'Idea',
        status: 'open',
        target_agent_id: 'agent-1',
        target_endpoint_id: 'ep-1',
        target_repo_path: '/repo/multisoul',
        target_agent_name: 'Codex Runner',
        body: 'Body',
        notes_json: '[{"id":"note-1","body":"Note","createdAt":1,"updatedAt":1}]',
        attachments_json: 'bad json',
        interview_conversation_id: null,
        converted_spec_id: null,
        error_message: null,
        pending_mutation: 'update',
        last_sync_error: 'offline',
        created_at: 1,
        updated_at: 2,
        archived_at: null,
      },
    ]);

  const ideas = await loadIdeas();
  expect(ideas[0]).toMatchObject({
    id: 'idea-1',
    notes: [{ id: 'note-1', body: 'Note', createdAt: 1, updatedAt: 1 }],
    attachments: [],
    pendingMutation: 'update',
    lastSyncError: 'offline',
  });

  mockGetAllAsync.mockResolvedValueOnce([]);
  await loadPendingIdeas('ep-1');
  expect(mockGetAllAsync).toHaveBeenLastCalledWith(
    expect.stringContaining('pending_mutation IS NOT NULL'),
    ['ep-1'],
  );
});

test('replaces endpoint ideas without deleting pending local edits', async () => {
  mockGetAllAsync.mockResolvedValueOnce([
    {
      id: 'idea-local',
      title: 'Local pending',
      status: 'archived',
      target_agent_id: 'agent-1',
      target_endpoint_id: 'ep-1',
      target_repo_path: '/repo/multisoul',
      target_agent_name: 'Codex Runner',
      body: 'Local body',
      notes_json: '[]',
      attachments_json: '[]',
      interview_conversation_id: null,
      converted_spec_id: null,
      error_message: null,
      pending_mutation: 'delete',
      last_sync_error: null,
      created_at: 1,
      updated_at: 9,
      archived_at: 9,
    },
  ]);
  await replaceIdeasForEndpoint('ep-1', [
    {
      id: 'idea-2',
      title: 'Remote',
      status: 'interviewing',
      targetAgentId: 'agent-1',
      targetEndpointId: 'wrong-endpoint',
      targetRepoPath: '/repo/multisoul',
      targetAgentName: 'Codex Runner',
      body: 'Remote body',
      notes: [],
      attachments: [],
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'idea-local',
      title: 'Remote stale',
      status: 'archived',
      targetAgentId: 'agent-1',
      targetEndpointId: 'wrong-endpoint',
      targetRepoPath: '/repo/multisoul',
      targetAgentName: 'Codex Runner',
      body: 'Remote stale body',
      notes: [],
      attachments: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ]);

  expect(mockGetAllAsync).toHaveBeenCalledWith(
    'SELECT * FROM spec_ideas WHERE target_endpoint_id = ?',
    ['ep-1'],
  );
  const insertCalls = mockRunAsync.mock.calls.filter((call) =>
    String(call[0]).includes('INSERT OR REPLACE INTO spec_ideas'),
  );
  expect(insertCalls).toHaveLength(1);
  expect(insertCalls[0][1][0]).toBe('idea-2');
  expect(insertCalls[0][1][4]).toBe('ep-1');
});

test('loadIdeas hides archived delete tombstones from the UI list', async () => {
  mockGetAllAsync
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'idea-del',
        title: 'Delete me',
        status: 'archived',
        target_agent_id: 'agent-1',
        target_endpoint_id: 'ep-1',
        target_repo_path: '/repo/multisoul',
        target_agent_name: 'Codex Runner',
        body: 'Body',
        notes_json: '[]',
        attachments_json: '[]',
        interview_conversation_id: null,
        converted_spec_id: null,
        error_message: null,
        pending_mutation: 'delete',
        last_sync_error: null,
        created_at: 1,
        updated_at: 2,
        archived_at: 2,
      },
      {
        id: 'idea-keep',
        title: 'Keep me',
        status: 'open',
        target_agent_id: 'agent-1',
        target_endpoint_id: 'ep-1',
        target_repo_path: '/repo/multisoul',
        target_agent_name: 'Codex Runner',
        body: 'Body',
        notes_json: '[]',
        attachments_json: '[]',
        interview_conversation_id: null,
        converted_spec_id: null,
        error_message: null,
        pending_mutation: null,
        last_sync_error: null,
        created_at: 1,
        updated_at: 3,
        archived_at: null,
      },
    ]);

  const ideas = await loadIdeas();
  expect(ideas.map((idea) => idea.id)).toEqual(['idea-keep']);
});

test('saves and loads spec artifact detail with latest version ordering', async () => {
  await saveSpecArtifactDetail({
    spec: {
      id: 'spec-1',
      title: 'Spec',
      slug: 'spec',
      status: 'ready',
      targetAgentId: 'agent-1',
      targetEndpointId: 'ep-1',
      targetRepoPath: '/repo/multisoul',
      repoSpecPath: 'docs/product-specs/spec.md',
      latestVersionId: 'ver-2',
      interviewConversationId: 'conv-1',
      createdAt: 1,
      updatedAt: 2,
    },
    versions: [
      {
        id: 'ver-2',
        specId: 'spec-1',
        revision: 2,
        repoSpecPath: 'docs/product-specs/spec.md',
        markdown: '# Spec',
        markdownSha256: 'abcdef',
        sourceConversationId: 'conv-1',
        createdAt: 3,
      },
    ],
  });

  expect(mockRunAsync).toHaveBeenCalledWith(
    expect.stringContaining('INSERT OR REPLACE INTO spec_artifacts'),
    expect.any(Array),
  );
  expect(mockRunAsync).toHaveBeenCalledWith(
    expect.stringContaining('INSERT OR REPLACE INTO spec_artifact_versions'),
    expect.any(Array),
  );

  mockGetAllAsync
    .mockResolvedValueOnce([
      {
        id: 'spec-1',
        title: 'Spec',
        slug: 'spec',
        status: 'ready',
        target_agent_id: 'agent-1',
        target_endpoint_id: 'ep-1',
        target_repo_path: '/repo/multisoul',
        repo_spec_path: 'docs/product-specs/spec.md',
        latest_version_id: 'ver-2',
        source_idea_id: null,
        interview_conversation_id: 'conv-1',
        latest_implementation_conversation_id: null,
        linked_activity_item_id: null,
        created_at: 1,
        updated_at: 2,
      },
    ])
    .mockResolvedValueOnce([
      {
        id: 'ver-1',
        spec_id: 'spec-1',
        revision: 1,
        repo_spec_path: 'docs/product-specs/spec.md',
        markdown: '# Old',
        markdown_sha256: 'oldhash',
        source_conversation_id: 'conv-1',
        created_at: 2,
      },
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
    ]);

  const detail = await loadSpecDetail('spec-1');
  expect(detail?.latestVersion).toMatchObject({ id: 'ver-2', revision: 2 });
});

test('loads and replaces specs for one endpoint', async () => {
  mockGetAllAsync
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'spec-1',
        title: 'Spec',
        slug: 'spec',
        status: 'ready',
        target_agent_id: 'agent-1',
        target_endpoint_id: 'ep-1',
        target_repo_path: '/repo/multisoul',
        repo_spec_path: 'docs/product-specs/spec.md',
        latest_version_id: 'ver-1',
        source_idea_id: null,
        interview_conversation_id: 'conv-1',
        latest_implementation_conversation_id: null,
        linked_activity_item_id: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);

  const specs = await loadSpecs();
  expect(specs[0]).toMatchObject({ id: 'spec-1', repoSpecPath: 'docs/product-specs/spec.md' });

  await replaceSpecsForEndpoint('ep-1', []);
  expect(mockRunAsync).toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM spec_artifact_versions'),
    ['ep-1'],
  );
  expect(mockRunAsync).toHaveBeenCalledWith(
    'DELETE FROM spec_artifacts WHERE target_endpoint_id = ?',
    ['ep-1'],
  );
});

test('deleteSpecArtifact removes versions and artifact rows locally', async () => {
  await deleteSpecArtifact('spec-1');

  expect(mockRunAsync).toHaveBeenCalledWith(
    'DELETE FROM spec_artifact_versions WHERE spec_id = ?',
    ['spec-1'],
  );
  expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM spec_artifacts WHERE id = ?', ['spec-1']);
});
