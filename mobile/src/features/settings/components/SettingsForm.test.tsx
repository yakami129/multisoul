import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SettingsForm } from './SettingsForm';
import { useSettingsStore } from '@/store/settingsStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('@/store/settingsStore');
const mockUseSettingsStore = useSettingsStore as jest.MockedFunction<typeof useSettingsStore>;

describe('SettingsForm', () => {
  const mockSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSettingsStore.mockReturnValue({
      settings: { serverUrl: 'http://localhost:8080', apiKey: '' },
      load: jest.fn(),
      save: mockSave,
    } as any);
  });

  it('renders server URL input with current value', () => {
    const { getByDisplayValue } = render(<SettingsForm />);
    expect(getByDisplayValue('http://localhost:8080')).toBeTruthy();
  });

  it('calls save with updated values on Save press', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const { getByDisplayValue, getByText } = render(<SettingsForm />);
    fireEvent.changeText(getByDisplayValue('http://localhost:8080'), 'http://prod:9090');
    fireEvent.press(getByText('Save'));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({ serverUrl: 'http://prod:9090', apiKey: '' }),
    );
  });
});
