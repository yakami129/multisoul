import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type Agent, type Endpoint } from '@/types';
import { SpecsHomeScreen } from './SpecsHomeScreen';
import { type SpecArtifact, type SpecIdea } from './specUiModels';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-gesture-handler', () => ({
  Swipeable: ({ children, renderRightActions }: any) => (
    <>
      {children}
      {renderRightActions?.()}
    </>
  ),
}));

const endpoint: Endpoint = {
  id: 'ep-1',
  label: 'Office Mac',
  base_url: 'http://office.local:8765',
  token: 'tok-office',
  last_seen_at: 123,
};

const agent: Agent = {
  id: 'agent-1',
  name: 'Codex Runner',
  project_path: '/repo/multisoul',
  runtime: 'codex',
  created_at: 1,
  endpoint_id: 'ep-1',
  endpoint_label: 'Office Mac',
};

const idea: SpecIdea = {
  id: 'idea-1',
  title: 'Improve onboarding',
  status: 'open',
  targetAgentId: 'agent-1',
  targetEndpointId: 'ep-1',
  targetRepoPath: '/repo/multisoul',
  targetAgentName: 'Codex Runner',
  body: 'Make first-run setup clearer.',
  notes: [{ id: 'note-1', body: 'Keep setup local.', createdAt: 1, updatedAt: 1 }],
  attachments: [{ id: 'att-1', kind: 'link', title: 'Issue', createdAt: 1 }],
  createdAt: 1,
  updatedAt: Date.now(),
};

const spec: SpecArtifact = {
  id: 'spec-1',
  title: 'Onboarding SPEC',
  slug: 'onboarding',
  status: 'ready',
  targetAgentId: 'agent-1',
  targetEndpointId: 'ep-1',
  targetRepoPath: '/repo/multisoul',
  repoSpecPath: 'docs/product-specs/2026-06-06-SPEC-onboarding.md',
  latestVersionId: 'ver-1',
  latestVersion: {
    id: 'ver-1',
    specId: 'spec-1',
    revision: 2,
    repoSpecPath: 'docs/product-specs/2026-06-06-SPEC-onboarding.md',
    markdown: '# Onboarding SPEC',
    markdownSha256: 'abcdef1234567890',
    sourceConversationId: 'conv-1',
    createdAt: 2,
  },
  interviewConversationId: 'conv-1',
  createdAt: 1,
  updatedAt: 2,
};

test('renders Ideas segment by default with open idea metadata', () => {
  const { getByText, queryByText } = render(
    <SpecsHomeScreen
      ideas={[idea]}
      specs={[spec]}
      endpoints={[endpoint]}
      agents={[agent]}
      onOpenIdea={() => {}}
      onOpenSpec={() => {}}
    />,
  );

  expect(getByText('Ideas')).toBeTruthy();
  expect(getByText('Open Ideas')).toBeTruthy();
  expect(getByText('Improve onboarding')).toBeTruthy();
  expect(getByText('/repo/multisoul · Codex Runner')).toBeTruthy();
  expect(getByText(/1 notes · 1 attachments/)).toBeTruthy();
  expect(queryByText('Ready')).toBeNull();
});

test('switches to Specs segment and opens ready spec rows', () => {
  const onOpenSpec = jest.fn();
  const { getAllByText, getByText } = render(
    <SpecsHomeScreen
      ideas={[idea]}
      specs={[spec]}
      endpoints={[endpoint]}
      agents={[agent]}
      onOpenIdea={() => {}}
      onOpenSpec={onOpenSpec}
    />,
  );

  fireEvent.press(getAllByText('Specs')[1]);
  expect(getAllByText('Ready').length).toBeGreaterThanOrEqual(1);
  expect(getByText('Onboarding SPEC')).toBeTruthy();
  expect(getByText(/rev 2 · sha abcdef12/)).toBeTruthy();

  fireEvent.press(getByText('Onboarding SPEC'));
  expect(onOpenSpec).toHaveBeenCalledWith('spec-1');
});

test('archives an idea without opening the row', () => {
  const onArchiveIdea = jest.fn();
  const onOpenIdea = jest.fn();
  const { getByText, queryByText } = render(
    <SpecsHomeScreen
      ideas={[idea]}
      specs={[]}
      endpoints={[endpoint]}
      agents={[agent]}
      onOpenIdea={onOpenIdea}
      onOpenSpec={() => {}}
      onArchiveIdea={onArchiveIdea}
    />,
  );

  fireEvent.press(getByText('Archive'));
  expect(onArchiveIdea).toHaveBeenCalledWith('idea-1');
  expect(onOpenIdea).not.toHaveBeenCalled();
  expect(queryByText('Archived Improve onboarding')).toBeNull();
});

const archivedIdea: SpecIdea = {
  ...idea,
  id: 'idea-1',
  status: 'archived',
  archivedAt: Date.now(),
};

test('archived idea shows both Unarchive and Delete actions', () => {
  const onUnarchiveIdea = jest.fn();
  const onDeleteArchivedIdea = jest.fn();
  const { getByText } = render(
    <SpecsHomeScreen
      ideas={[archivedIdea]}
      specs={[]}
      endpoints={[endpoint]}
      agents={[agent]}
      onOpenIdea={() => {}}
      onOpenSpec={() => {}}
      onUnarchiveIdea={onUnarchiveIdea}
      onDeleteArchivedIdea={onDeleteArchivedIdea}
    />,
  );

  fireEvent.press(getByText('Archived'));
  expect(getByText('Unarchive')).toBeTruthy();
  expect(getByText('DELETE')).toBeTruthy();
});

test('clicking DELETE directly calls onDeleteArchivedIdea', () => {
  const onDeleteArchivedIdea = jest.fn();
  const { getByText } = render(
    <SpecsHomeScreen
      ideas={[archivedIdea]}
      specs={[]}
      endpoints={[endpoint]}
      agents={[agent]}
      onOpenIdea={() => {}}
      onOpenSpec={() => {}}
      onUnarchiveIdea={() => {}}
      onDeleteArchivedIdea={onDeleteArchivedIdea}
    />,
  );

  fireEvent.press(getByText('Archived'));
  fireEvent.press(getByText('DELETE'));
  expect(onDeleteArchivedIdea).toHaveBeenCalledWith('idea-1');
});

test('saves a new idea with a selected target from the picker', () => {
  const onCreateIdea = jest.fn();
  const { getAllByText, getByLabelText, getByText } = render(
    <SpecsHomeScreen
      ideas={[]}
      specs={[]}
      endpoints={[endpoint]}
      agents={[agent]}
      onCreateIdea={onCreateIdea}
      onOpenIdea={() => {}}
      onOpenSpec={() => {}}
    />,
  );

  fireEvent.press(getByLabelText('New Idea'));
  fireEvent.changeText(getByLabelText('Idea body'), 'Polish empty states');
  fireEvent.press(getByText('Project & Agent'));
  expect(getByText('Choose Target')).toBeTruthy();
  fireEvent.press(getByText('Codex Runner'));
  fireEvent.press(getAllByText('Done')[1]);
  fireEvent.press(getAllByText('Done')[0]);

  expect(onCreateIdea).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Polish empty states',
      body: 'Polish empty states',
      target: expect.objectContaining({
        endpointId: 'ep-1',
        agentId: 'agent-1',
        repoPath: '/repo/multisoul',
      }),
    }),
  );
});
