import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type Project, type ProjectResource, type ProjectSession } from '../types';
import { ProjectDetail } from './ProjectDetail';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const project: Project = {
  id: 'p1',
  name: 'MultiSoul',
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
    completed: 0,
    failed: 0,
  },
  resource_count: 2,
  endpoint_id: 'ep-1',
  endpoint_label: 'Mac',
};

const resources: ProjectResource[] = [
  {
    id: 'a1',
    project_id: 'p1',
    name: 'codex-resource',
    project_path: project.project_path,
    runtime: 'codex',
    created_at: 1,
    is_default: true,
    endpoint_id: 'ep-1',
    endpoint_label: 'Mac',
  },
  {
    id: 'a2',
    project_id: 'p1',
    name: 'claude-resource',
    project_path: project.project_path,
    runtime: 'claude-code',
    created_at: 2,
    is_default: false,
    endpoint_id: 'ep-1',
    endpoint_label: 'Mac',
  },
];

const sessions: ProjectSession[] = [
  {
    id: 'c1',
    agent_id: 'a1',
    project_id: 'p1',
    title: 'Plan refactor',
    created_at: 1,
    last_message_at: 2,
    status: 'idle',
    model_id: null,
    endpoint_id: 'ep-1',
    agent_name: 'codex-resource',
    first_user_message: 'Plan the work',
    last_ai_reply: 'Plan is ready',
  },
];

describe('ProjectDetail', () => {
  it('renders project hero and sessions by default', () => {
    const { getByText, queryByText } = render(
      <ProjectDetail
        project={project}
        sessions={sessions}
        resources={resources}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewSession={() => {}}
        onOpenSession={() => {}}
        onOpenResource={() => {}}
      />,
    );

    expect(getByText('MultiSoul')).toBeTruthy();
    expect(getByText('Plan the work')).toBeTruthy();
    expect(getByText('Plan is ready')).toBeTruthy();
    expect(queryByText('claude-resource')).toBeNull();
  });

  it('opens a session with its matching resource', () => {
    const onOpenSession = jest.fn();
    const { getByText } = render(
      <ProjectDetail
        project={project}
        sessions={sessions}
        resources={resources}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewSession={() => {}}
        onOpenSession={onOpenSession}
        onOpenResource={() => {}}
      />,
    );

    fireEvent.press(getByText('Plan the work'));

    expect(onOpenSession).toHaveBeenCalledWith(sessions[0], resources[0]);
  });

  it('shows resources as a secondary segment', () => {
    const onOpenResource = jest.fn();
    const { getByText, getAllByText } = render(
      <ProjectDetail
        project={project}
        sessions={sessions}
        resources={resources}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewSession={() => {}}
        onOpenSession={() => {}}
        onOpenResource={onOpenResource}
      />,
    );

    fireEvent.press(getByText('Resources'));
    const configBtns = getAllByText('Configure');
    fireEvent.press(configBtns[1]);

    expect(getByText('codex-resource')).toBeTruthy();
    expect(getByText('Default')).toBeTruthy();
    expect(onOpenResource).toHaveBeenCalledWith(resources[1]);
  });

  it('calls new session and back callbacks', () => {
    const onNewSession = jest.fn();
    const onBack = jest.fn();
    const { getByText, getByLabelText } = render(
      <ProjectDetail
        project={project}
        sessions={sessions}
        resources={resources}
        isLoading={false}
        isError={false}
        onBack={onBack}
        onNewSession={onNewSession}
        onOpenSession={() => {}}
        onOpenResource={() => {}}
      />,
    );

    fireEvent.press(getByText('New Session'));
    fireEvent.press(getByLabelText('Back'));

    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
