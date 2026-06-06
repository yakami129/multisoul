import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import {
  deleteIdea,
  loadIdeas,
  loadSpecs as loadSpecArtifacts,
  replaceIdeasForEndpoint,
  replaceSpecsForEndpoint,
  saveIdea,
} from '@/features/specs/services/specAssetRepository';
import { dispatchSpecToAgent } from '@/features/specs/services/specDispatchService';
import {
  getFirstOpenQuestionId,
  SPEC_INTERVIEW_QUESTIONS,
} from '@/features/specs/services/specInterview';
import { buildSpecMarkdown, buildSpecSlug } from '@/features/specs/services/specMarkdown';
import {
  deleteSpec as deleteStoredSpec,
  loadSpecs,
  saveSpec,
} from '@/features/specs/services/specRepository';
import {
  type CreateSpecIdeaInput,
  type CreateSpecInput,
  type DispatchSpecResult,
  type SpecArtifact,
  type SpecAnswer,
  type SpecDraft,
  type SpecIdea,
} from '@/features/specs/types';
import { type Endpoint } from '@/types';

interface EditIdeaInput {
  title: string;
  body: string;
  attachments: import('@/features/specs/types').SpecIdeaAttachment[];
  targetAgentId?: string;
  targetEndpointId?: string;
  targetRepoPath?: string;
  targetAgentName?: string;
}

interface SpecState {
  specs: SpecDraft[];
  ideas: SpecIdea[];
  specArtifacts: SpecArtifact[];
  load: () => Promise<void>;
  loadAssets: () => Promise<void>;
  refreshAssets: (endpoints: Endpoint[]) => Promise<void>;
  createIdea: (input: CreateSpecIdeaInput) => Promise<SpecIdea>;
  updateIdea: (ideaId: string, input: EditIdeaInput) => Promise<void>;
  archiveIdea: (ideaId: string) => Promise<void>;
  unarchiveIdea: (ideaId: string) => Promise<void>;
  deleteArchivedIdea: (ideaId: string, endpoint?: Endpoint) => Promise<void>;
  createSpec: (input: CreateSpecInput) => Promise<SpecDraft>;
  answerQuestion: (specId: string, answer: SpecAnswer) => Promise<void>;
  generatePreview: (specId: string) => Promise<void>;
  approveSpec: (specId: string) => Promise<void>;
  askMore: (specId: string) => Promise<void>;
  markDispatching: (specId: string) => Promise<void>;
  dispatchSpec: (specId: string, endpoint: Endpoint) => Promise<DispatchSpecResult>;
  markDispatched: (specId: string, result: DispatchSpecResult) => Promise<void>;
  markFailed: (specId: string, errorMessage: string) => Promise<void>;
  deleteSpec: (specId: string) => Promise<void>;
}

function upsertAnswer(answers: SpecAnswer[], answer: SpecAnswer): SpecAnswer[] {
  return [...answers.filter((item) => item.questionId !== answer.questionId), answer].sort(
    (a, b) => a.answeredAt - b.answeredAt,
  );
}

async function updateSpec(
  specs: SpecDraft[],
  specId: string,
  mutate: (spec: SpecDraft) => SpecDraft,
): Promise<SpecDraft[]> {
  let updatedSpec: SpecDraft | undefined;
  const next = specs.map((spec) => {
    if (spec.id !== specId) return spec;
    updatedSpec = mutate(spec);
    return updatedSpec;
  });
  if (updatedSpec) {
    await saveSpec(updatedSpec);
  }
  return next;
}

function errorMessageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Spec dispatch failed';
}

export const useSpecStore = create<SpecState>((set, get) => ({
  specs: [],
  ideas: [],
  specArtifacts: [],

  load: async () => {
    const specs = await loadSpecs();
    set({ specs });
  },

  loadAssets: async () => {
    const [ideas, specArtifacts] = await Promise.all([loadIdeas(), loadSpecArtifacts()]);
    set({ ideas, specArtifacts });
  },

  refreshAssets: async (endpoints) => {
    const { fetchSpecArtifacts, fetchSpecIdeas } =
      await import('@/features/specs/services/specAssetService');
    const [ideaResults, specResults] = await Promise.all([
      Promise.allSettled(endpoints.map(fetchSpecIdeas)),
      Promise.allSettled(endpoints.map(fetchSpecArtifacts)),
    ]);
    await Promise.all(
      endpoints.map(async (endpoint, index) => {
        const ideas = ideaResults[index];
        if (ideas?.status === 'fulfilled') {
          await replaceIdeasForEndpoint(endpoint.id, ideas.value);
        }
        const specs = specResults[index];
        if (specs?.status === 'fulfilled') {
          await replaceSpecsForEndpoint(endpoint.id, specs.value);
        }
      }),
    );
    await get().loadAssets();
  },

  createIdea: async (input) => {
    const now = Date.now();
    const targetAgent = input.targetAgent;
    const title =
      input.title?.trim() ||
      input.body
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)
        ?.slice(0, 80) ||
      'Untitled idea';
    const idea: SpecIdea = {
      id: uuidv4(),
      title,
      status: 'open',
      targetAgentId: input.targetAgentId ?? targetAgent?.id ?? '',
      targetEndpointId: input.targetEndpointId ?? targetAgent?.endpoint_id ?? '',
      targetRepoPath: input.targetRepoPath ?? targetAgent?.project_path ?? '',
      targetAgentName: input.targetAgentName ?? targetAgent?.name ?? '',
      body: input.body,
      notes: input.notes ?? [],
      attachments: input.attachments ?? [],
      createdAt: now,
      updatedAt: now,
      pendingMutation: 'create',
    };
    await saveIdea(idea, 'create', null);
    set((state) => ({ ideas: [idea, ...state.ideas.filter((item) => item.id !== idea.id)] }));
    return idea;
  },

  updateIdea: async (ideaId, input) => {
    const now = Date.now();
    const ideas = get().ideas.map((idea) => {
      if (idea.id !== ideaId) return idea;
      return {
        ...idea,
        title: input.title || idea.title,
        body: input.body,
        attachments: input.attachments,
        targetAgentId: input.targetAgentId ?? idea.targetAgentId,
        targetEndpointId: input.targetEndpointId ?? idea.targetEndpointId,
        targetRepoPath: input.targetRepoPath ?? idea.targetRepoPath,
        targetAgentName: input.targetAgentName ?? idea.targetAgentName,
        updatedAt: now,
      };
    });
    const idea = ideas.find((item) => item.id === ideaId);
    if (idea) await saveIdea(idea, 'update', null);
    set({ ideas });
  },

  archiveIdea: async (ideaId) => {
    const now = Date.now();
    const ideas = get().ideas.map((idea) =>
      idea.id === ideaId
        ? { ...idea, status: 'archived' as const, archivedAt: now, updatedAt: now }
        : idea,
    );
    const idea = ideas.find((item) => item.id === ideaId);
    if (idea) await saveIdea(idea, 'archive', null);
    set({ ideas });
  },

  unarchiveIdea: async (ideaId) => {
    const now = Date.now();
    const ideas = get().ideas.map((idea) =>
      idea.id === ideaId
        ? { ...idea, status: 'open' as const, archivedAt: undefined, updatedAt: now }
        : idea,
    );
    const idea = ideas.find((item) => item.id === ideaId);
    if (idea) await saveIdea(idea, 'update', null);
    set({ ideas });
  },

  deleteArchivedIdea: async (ideaId, endpoint?) => {
    const idea = get().ideas.find((item) => item.id === ideaId);
    if (!idea || idea.status !== 'archived') return;
    set((state) => ({ ideas: state.ideas.filter((item) => item.id !== ideaId) }));
    await deleteIdea(ideaId);
    if (endpoint) {
      const { deleteSpecIdea } = await import('@/features/specs/services/specAssetService');
      try {
        await deleteSpecIdea(endpoint, ideaId);
      } catch (_) {
        // best-effort; local already deleted
      }
    }
  },

  createSpec: async ({ title, targetAgent }) => {
    const now = Date.now();
    const spec: SpecDraft = {
      id: uuidv4(),
      title,
      slug: buildSpecSlug(title),
      status: 'draft',
      targetAgentId: targetAgent.id,
      targetEndpointId: targetAgent.endpoint_id,
      targetRepoPath: targetAgent.project_path,
      targetAgentName: targetAgent.name,
      targetRuntime: targetAgent.runtime,
      questions: [{ id: 'default', questions: SPEC_INTERVIEW_QUESTIONS, createdAt: now }],
      answers: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveSpec(spec);
    set((state) => ({ specs: [spec, ...state.specs.filter((item) => item.id !== spec.id)] }));
    return spec;
  },

  answerQuestion: async (specId, answer) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      answers: upsertAnswer(spec.answers, answer),
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  generatePreview: async (specId) => {
    const specs = await updateSpec(get().specs, specId, (spec) => {
      const missingQuestionId = getFirstOpenQuestionId(spec.answers);
      if (missingQuestionId) {
        throw new Error(`Spec interview is missing answer for ${missingQuestionId}`);
      }
      return {
        ...spec,
        status: 'review',
        markdownPreview: buildSpecMarkdown(spec),
        errorMessage: undefined,
        updatedAt: Date.now(),
      };
    });
    set({ specs });
  },

  approveSpec: async (specId) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      status: 'approved',
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  askMore: async (specId) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      status: 'draft',
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  markDispatching: async (specId) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      status: 'dispatching',
      errorMessage: undefined,
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  dispatchSpec: async (specId, endpoint) => {
    const spec = get().specs.find((item) => item.id === specId);
    if (!spec) {
      throw new Error('Spec not found');
    }
    if (!spec.markdownPreview) {
      const message = 'Spec markdown preview is missing';
      await get().markFailed(specId, message);
      throw new Error(message);
    }

    await get().markDispatching(specId);
    try {
      const result = await dispatchSpecToAgent(
        endpoint.base_url,
        endpoint.token,
        spec.targetAgentId,
        {
          title: spec.title,
          slug: spec.slug,
          markdown: spec.markdownPreview,
        },
      );
      await get().markDispatched(specId, result);
      return result;
    } catch (error) {
      await get().markFailed(specId, errorMessageFrom(error));
      throw error;
    }
  },

  markDispatched: async (specId, result) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      status: 'dispatched',
      repoSpecPath: result.repo_spec_path,
      linkedConversationId: result.conversation_id,
      errorMessage: undefined,
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  markFailed: async (specId, errorMessage) => {
    const specs = await updateSpec(get().specs, specId, (spec) => ({
      ...spec,
      status: 'failed',
      errorMessage,
      updatedAt: Date.now(),
    }));
    set({ specs });
  },

  deleteSpec: async (specId) => {
    await deleteStoredSpec(specId);
    set((state) => ({ specs: state.specs.filter((spec) => spec.id !== specId) }));
  },
}));
