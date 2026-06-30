import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import ProjectListScreen from './index';

const mockPush = jest.fn();
const mockFetchAllProjects = jest.fn();

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));

jest.mock('../../src/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    get: jest.fn(),
  })),
  clearEndpointClients: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => (() => void) | void) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }, [cb]);
  },
}));

jest.mock('../../src/store/endpointStore', () => ({
  useEndpointStore: (selector: any) =>
    selector({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Mac',
          base_url: 'http://localhost:8080',
          token: 'token-1',
        },
      ],
      addEndpoint: jest.fn(),
    }),
}));

jest.mock('../../src/features/projects', () => {
  const actual = jest.requireActual('../../src/features/projects');
  return {
    ...actual,
    fetchAllProjects: (...args: unknown[]) => mockFetchAllProjects(...args),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: any) => children,
}));

describe('ProjectListScreen', () => {
  function renderScreen() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <ProjectListScreen />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockFetchAllProjects.mockReset();
  });

  it('opens project detail when a project card is pressed', async () => {
    mockFetchAllProjects.mockResolvedValue([
      {
        id: 'p1',
        name: 'Alpha Project',
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
          completed: 0,
          failed: 0,
        },
        resource_count: 2,
        endpoint_id: 'ep-1',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Alpha Project')).toBeTruthy());
    fireEvent.press(getByText('Alpha Project'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/project/p1?endpoint_id=ep-1'));
  });

  it('URL-encodes project and endpoint ids when opening detail from a card', async () => {
    mockFetchAllProjects.mockResolvedValue([
      {
        id: 'project/二',
        name: '修复项目/QA',
        project_path: '/repo/beta',
        normalized_project_path: '/repo/beta',
        default_resource_id: 'a2',
        created_at: 2,
        updated_at: 3,
        last_activity_at: 4,
        session_counts: {
          idle: 0,
          running: 1,
          awaiting_question: 0,
          completed: 0,
          failed: 0,
        },
        resource_count: 1,
        endpoint_id: 'ep/二',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('修复项目/QA')).toBeTruthy());
    fireEvent.press(getByText('修复项目/QA'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/project/${encodeURIComponent('project/二')}?endpoint_id=${encodeURIComponent('ep/二')}`,
      ),
    );
  });
});
