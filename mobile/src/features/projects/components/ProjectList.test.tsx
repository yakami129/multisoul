import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { RefreshControl, StyleSheet, TextInput } from 'react-native';
import { type Project } from '../types';
import { ProjectList } from './ProjectList';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const projects: Project[] = [
  {
    id: 'p1',
    name: 'Alpha',
    project_path: '/repo/alpha',
    normalized_project_path: '/repo/alpha',
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
    endpoint_id: 'ep-1',
    endpoint_label: 'Mac',
  },
  {
    id: 'p2',
    name: 'Beta',
    project_path: '/repo/beta',
    normalized_project_path: '/repo/beta',
    default_resource_id: 'a2',
    created_at: 1,
    updated_at: 2,
    last_activity_at: 4,
    session_counts: {
      idle: 0,
      running: 1,
      awaiting_question: 0,
      completed: 0,
      failed: 0,
    },
    resource_count: 1,
    endpoint_id: 'ep-2',
    endpoint_label: 'Workstation',
  },
];

describe('ProjectList', () => {
  it('renders the project-first home shell', () => {
    const { getByText, queryByText, UNSAFE_getByType } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    expect(getByText('MultiSoul')).toBeTruthy();
    expect(getByText(/Your projects/)).toBeTruthy();
    expect(getByText('Quick Workflows')).toBeTruthy();
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
    expect(getByText('3 sessions · 2 resources')).toBeTruthy();
    expect(UNSAFE_getByType(TextInput).props.placeholder).toBe('Search projects...');
    expect(queryByText('Agent Fleet')).toBeNull();
  });

  it('uses the cream surface tokens from the mobile design system', () => {
    const { getByTestId, UNSAFE_getByType } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    const rootStyle = StyleSheet.flatten(getByTestId('projects-root').props.style);
    const searchStyle = StyleSheet.flatten(getByTestId('projects-search-box').props.style);
    const groupStyle = StyleSheet.flatten(getByTestId('projects-group').props.style);
    const searchInput = UNSAFE_getByType(TextInput);

    expect(rootStyle.backgroundColor).toBe('#F6F3EC');
    expect(searchStyle.borderRadius).toBe(21);
    expect(searchStyle.borderColor).toBe('#E6E6E8');
    expect(searchInput.props.placeholderTextColor).toBe('#555555');
    expect(groupStyle.gap).toBe(6);
  });

  it('opens a project with project and endpoint ids', () => {
    const onProjectPress = jest.fn();
    const { getByText } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={onProjectPress}
      />,
    );

    fireEvent.press(getByText('Alpha'));

    expect(onProjectPress).toHaveBeenCalledWith('p1', 'ep-1');
  });

  it('filters projects through search', () => {
    const { UNSAFE_getByType, getByText, queryByText } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    fireEvent.changeText(UNSAFE_getByType(TextInput), 'beta');

    expect(getByText('Beta')).toBeTruthy();
    expect(queryByText('Alpha')).toBeNull();
  });

  it('filters projects by endpoint', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    fireEvent.press(getByLabelText('Filter projects by endpoint'));
    fireEvent.press(getByLabelText('Workstation, 1 project'));

    expect(getByText('Beta')).toBeTruthy();
    expect(queryByText('Alpha')).toBeNull();
    expect(getByText('Workstation · 1 project')).toBeTruthy();
  });

  it('keeps running projects before idle projects', () => {
    const { getAllByTestId } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    expect(getAllByTestId('project-row')[0].props.accessibilityLabel).toBe('Open project Beta');
  });

  it('does not show pull refresh spinner for background fetches', () => {
    const { UNSAFE_getByType } = render(
      <ProjectList
        projects={projects}
        isLoading={false}
        isError={false}
        error={null}
        isFetching
        onRefetch={() => {}}
        onProjectPress={() => {}}
      />,
    );

    expect(UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });
});
