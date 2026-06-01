import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
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
  type CreateSpecInput,
  type DispatchSpecResult,
  type SpecAnswer,
  type SpecDraft,
} from '@/features/specs/types';
import { type Endpoint } from '@/types';

interface SpecState {
  specs: SpecDraft[];
  load: () => Promise<void>;
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

  load: async () => {
    const specs = await loadSpecs();
    set({ specs });
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
