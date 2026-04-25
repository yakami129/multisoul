import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import SettingsScreen from '../../app/(tabs)/settings';
import { useSettingsStore } from '../../src/store/settingsStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('../../src/store/settingsStore');
const mockUseSettingsStore = useSettingsStore as jest.MockedFunction<typeof useSettingsStore>;

/// Settings screen: fills inputs and calls save on Save press
///
/// Execution:
///   1. Render SettingsScreen (thin wrapper around SettingsForm)
///   2. Fill Server URL input with 'http://prod:8080'
///   3. Press Save button
///
/// Expected:
///   - save() called with updated serverUrl
describe('SettingsScreen', () => {
  const mockSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSettingsStore.mockReturnValue({
      settings: { serverUrl: 'http://localhost:8080', apiKey: '' },
      load: jest.fn(),
      save: mockSave,
    } as any);
  });

  it('saves settings via store on Save press', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const { getByPlaceholderText, getByText } = render(<SettingsScreen />);

    fireEvent.changeText(getByPlaceholderText('http://localhost:8080'), 'http://prod:8080');
    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({ serverUrl: 'http://prod:8080', apiKey: '' }),
    );
  });
});
