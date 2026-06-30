import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import ProjectListScreen from '../../app/(tabs)/index';
import { useEndpointStore } from '../../src/store/endpointStore';
import { type Project } from '../features/projects';

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

jest.mock('../../src/features/projects', () => {
  const actual = jest.requireActual('../../src/features/projects');
  return {
    ...actual,
    fetchAllProjects: jest.fn(),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  Link: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
}));

const mockProjects: Project[] = [
  {
    id: 'project-weather',
    name: 'Weather Project',
    project_path: '/home/user/weather',
    normalized_project_path: '/home/user/weather',
    default_resource_id: 'uuid-1',
    created_at: 0,
    updated_at: 1,
    last_activity_at: 2,
    session_counts: {
      idle: 1,
      running: 0,
      awaiting_question: 0,
      completed: 2,
      failed: 0,
    },
    resource_count: 2,
    endpoint_id: 'ep-1',
    endpoint_label: 'Local',
  },
  {
    id: 'project-broken',
    name: 'Broken Project',
    project_path: '/home/user/broken',
    normalized_project_path: '/home/user/broken',
    default_resource_id: 'uuid-2',
    created_at: 0,
    updated_at: 1,
    last_activity_at: 3,
    session_counts: {
      idle: 0,
      running: 1,
      awaiting_question: 0,
      completed: 0,
      failed: 0,
    },
    resource_count: 1,
    endpoint_id: 'ep-1',
    endpoint_label: 'Local',
  },
];

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('ProjectListScreen', () => {
  const { fetchAllProjects } = require('../../src/features/projects');

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Local',
          base_url: 'http://localhost:8765',
          token: 'tok',
          last_seen_at: null,
        },
      ],
    });
    fetchAllProjects.mockResolvedValue(mockProjects);
  });

  afterEach(() => {
    queryClient.clear();
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
    fetchAllProjects.mockReset();
  });

  it('renders projects returned by fetchAllProjects', async () => {
    render(<ProjectListScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Project')).toBeTruthy();
    });

    expect(screen.getByText('Broken Project')).toBeTruthy();
    expect(screen.getByText('3 sessions · 2 resources')).toBeTruthy();
  });

  it('keeps the Projects page visible while project data loads', () => {
    fetchAllProjects.mockImplementation(() => new Promise(() => {}));

    render(<ProjectListScreen />, { wrapper });

    expect(screen.getByText('MultiSoul')).toBeTruthy();
    expect(screen.getByText(/Your projects/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Search projects...')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Loading projects...')).toBeTruthy();
    expect(screen.getByText('Quick Workflows')).toBeTruthy();
    expect(screen.queryByText('Weather Project')).toBeNull();
  });

  it('shows empty state when no projects are available', async () => {
    fetchAllProjects.mockResolvedValue([]);

    render(<ProjectListScreen />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Connect a machine')).toBeTruthy();
    });
  });

  it('opens the add endpoint modal in QR mode from the Projects header plus', async () => {
    render(<ProjectListScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Project')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Add endpoint'));

    expect(screen.getByText('Connect a machine')).toBeTruthy();
    expect(screen.getByText('TAP TO ALLOW CAMERA')).toBeTruthy();
    expect(screen.queryByText('ADD ENDPOINT')).toBeNull();
  });
});
