import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type SpecArtifact, type SpecArtifactDetail, type SpecDraft } from '../types';
import { SpecDetailScreen } from './SpecDetailScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const spec: SpecArtifact = {
  id: 'spec-1',
  title: 'Offline First Spec Manager',
  slug: 'offline-first-spec-manager',
  status: 'ready',
  targetAgentId: 'agent-1',
  targetEndpointId: 'endpoint-1',
  targetRepoPath: '/repo/multisoul',
  repoSpecPath: 'docs/product-specs/2026-06-06-SPEC-offline-first.md',
  latestVersionId: 'version-3',
  sourceIdeaId: 'idea-1',
  interviewConversationId: 'interview-1',
  createdAt: 1,
  updatedAt: Date.now(),
};

const detail: SpecArtifactDetail = {
  spec,
  latestVersion: {
    id: 'version-3',
    specId: 'spec-1',
    revision: 3,
    repoSpecPath: 'docs/product-specs/2026-06-06-SPEC-offline-first.md',
    markdown:
      '# Offline First SPEC\n\nPersist the asset snapshot.\n\n## Acceptance\n\n- Shows latest revision\n- Starts implementation chat',
    markdownSha256: 'abcdef1234567890',
    sourceConversationId: 'interview-1',
    createdAt: 2,
  },
  versions: [],
};

test('artifact detail shows latest snapshot metadata and related records', () => {
  const { getAllByText, getByText } = render(
    <SpecDetailScreen
      detail={detail}
      sourceIdeaTitle="Captured idea"
      onBack={() => {}}
      onStartImplementation={() => {}}
      onOpenInterviewChat={() => {}}
      onOpenImplementationChat={() => {}}
      onOpenSourceIdea={() => {}}
      onReadFull={() => {}}
    />,
  );

  expect(getByText('Offline First Spec Manager')).toBeTruthy();
  expect(getAllByText('docs/product-specs/2026-06-06-SPEC-offline-first.md').length).toBeGreaterThan(0);
  expect(getByText('v3')).toBeTruthy();
  expect(getByText('abcdef12')).toBeTruthy();
  expect(getByText('Persist the asset snapshot.')).toBeTruthy();
  expect(getByText('Captured idea')).toBeTruthy();
  expect(getByText('interview-1')).toBeTruthy();
});

test('ready artifact exposes start implementation action', () => {
  const onStartImplementation = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      detail={detail}
      onBack={() => {}}
      onStartImplementation={onStartImplementation}
      onOpenInterviewChat={() => {}}
      onOpenImplementationChat={() => {}}
      onOpenSourceIdea={() => {}}
      onReadFull={() => {}}
    />,
  );

  fireEvent.press(getByText('Start Implementation'));

  expect(onStartImplementation).toHaveBeenCalledTimes(1);
});

test('artifact with implementation chat opens the existing chat instead of starting another one', () => {
  const onOpenImplementationChat = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      detail={{
        ...detail,
        spec: {
          ...spec,
          status: 'planning',
          latestImplementationConversationId: 'impl-1',
        },
      }}
      onBack={() => {}}
      onStartImplementation={() => {}}
      onOpenInterviewChat={() => {}}
      onOpenImplementationChat={onOpenImplementationChat}
      onOpenSourceIdea={() => {}}
      onReadFull={() => {}}
    />,
  );

  fireEvent.press(getByText('Open Implementation'));

  expect(onOpenImplementationChat).toHaveBeenCalledTimes(1);
});

test('snapshot read full control delegates expansion to the route', () => {
  const onReadFull = jest.fn();
  const { getByText } = render(
    <SpecDetailScreen
      detail={detail}
      showFullMarkdown={false}
      onBack={() => {}}
      onStartImplementation={() => {}}
      onOpenInterviewChat={() => {}}
      onOpenImplementationChat={() => {}}
      onOpenSourceIdea={() => {}}
      onReadFull={onReadFull}
    />,
  );

  fireEvent.press(getByText('Read full snapshot'));

  expect(onReadFull).toHaveBeenCalledTimes(1);
});

test('legacy local draft renders as a migration fallback, not the old fixed-question flow', () => {
  const legacySpec: SpecDraft = {
    id: 'legacy-1',
    title: 'Legacy draft',
    slug: 'legacy-draft',
    status: 'draft',
    targetAgentId: 'agent-1',
    targetEndpointId: 'endpoint-1',
    targetRepoPath: '/repo/multisoul',
    targetAgentName: 'Agent One',
    targetRuntime: 'codex',
    questions: [],
    answers: [],
    markdownPreview: '# Legacy draft\n\nSaved before artifacts.',
    createdAt: 1,
    updatedAt: 2,
  };

  const { queryByText, getByText } = render(
    <SpecDetailScreen detail={undefined} legacySpec={legacySpec} onBack={() => {}} />,
  );

  expect(getByText('Legacy Draft')).toBeTruthy();
  expect(getByText('Saved before artifacts.')).toBeTruthy();
  expect(queryByText('这次需求最直接要达成什么结果？')).toBeNull();
});
