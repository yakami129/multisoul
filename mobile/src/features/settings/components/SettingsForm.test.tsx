import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { SettingsForm } from './SettingsForm';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('@/store/settingsStore');
const mockUseSettingsStore = useSettingsStore as jest.MockedFunction<typeof useSettingsStore>;

const baseSettings = {
  serverUrl: 'http://localhost:8080',
  apiKey: '',
  connectionMode: 'custom' as const,
  relayToken: '',
  relayWorkerUrl: 'https://worker.example.com',
};

describe('SettingsForm', () => {
  const mockSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSettingsStore.mockReturnValue({
      settings: baseSettings,
      load: jest.fn(),
      save: mockSave,
    } as any);
  });

  it('renders server URL input with current value in custom mode', () => {
    const { getByDisplayValue } = render(<SettingsForm />);
    expect(getByDisplayValue('http://localhost:8080')).toBeTruthy();
  });

  it('calls save with updated values on Save press in custom mode', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const { getByDisplayValue, getByText } = render(<SettingsForm />);
    fireEvent.changeText(getByDisplayValue('http://localhost:8080'), 'http://prod:9090');
    fireEvent.press(getByText('Save'));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://prod:9090', connectionMode: 'custom' }),
      ),
    );
  });

  it('shows Auto Tunnel and Custom Server toggle buttons', () => {
    const { getByText } = render(<SettingsForm />);
    expect(getByText('Auto Tunnel')).toBeTruthy();
    expect(getByText('Custom Server')).toBeTruthy();
  });

  it('shows relay token input when Auto Tunnel is selected', () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(<SettingsForm />);
    fireEvent.press(getByText('Auto Tunnel'));
    expect(getByPlaceholderText('ms_v2_...')).toBeTruthy();
    expect(queryByPlaceholderText('http://localhost:8080')).toBeNull();
  });
});
