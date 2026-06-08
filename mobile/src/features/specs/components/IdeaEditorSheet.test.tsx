import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { IdeaEditorSheet } from './IdeaEditorSheet';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

const target = {
  endpointId: 'ep-1',
  endpointLabel: 'Office Mac',
  agentId: 'agent-1',
  agentName: 'Codex Runner',
  repoPath: '/repo/multisoul',
};

test('derives title from first body line and trims body when saving', () => {
  const onSave = jest.fn();
  const { getByLabelText, getByText } = render(
    <IdeaEditorSheet
      visible
      target={target}
      onChooseTarget={() => {}}
      onClose={() => {}}
      onSave={onSave}
    />,
  );

  fireEvent.changeText(getByLabelText('Idea body'), '  First useful line\nMore detail  ');
  fireEvent.press(getByText('Done'));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'First useful line',
      body: 'First useful line\nMore detail',
      target,
    }),
  );
});

test('adds attachment from preset when opening via share or deep link', () => {
  const onSave = jest.fn();
  const { getByText } = render(
    <IdeaEditorSheet
      visible
      attachmentPreset="link"
      onChooseTarget={() => {}}
      onClose={() => {}}
      onSave={onSave}
    />,
  );

  // preset link attachment adds a new attachment with title "New attachment"
  expect(getByText('New attachment')).toBeTruthy();
  fireEvent.press(getByText('Done'));

  const attachments = onSave.mock.calls[0][0].attachments;
  expect(attachments.map((item: { kind: string }) => item.kind)).toEqual(['link']);
});

test('asks before closing a dirty draft and supports save from the alert', () => {
  const onClose = jest.fn();
  const onSave = jest.fn();
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { getByLabelText, getByText } = render(
    <IdeaEditorSheet visible onChooseTarget={() => {}} onClose={onClose} onSave={onSave} />,
  );

  fireEvent.changeText(getByLabelText('Idea title'), 'Draft title');
  fireEvent.press(getByText('Cancel'));

  expect(onClose).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith(
    'Close Idea',
    'Save this draft before closing?',
    expect.arrayContaining([
      expect.objectContaining({ text: 'Discard' }),
      expect.objectContaining({ text: 'Save Draft' }),
    ]),
  );

  const saveAction = alertSpy.mock.calls[0][2]?.find((action) => action.text === 'Save Draft');
  saveAction?.onPress?.();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Draft title' }));
  alertSpy.mockRestore();
});

test('closes clean drafts without confirmation', () => {
  const onClose = jest.fn();
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { getByText } = render(
    <IdeaEditorSheet
      visible
      initialValue={{ title: 'Existing', body: 'Body', attachments: [] }}
      onChooseTarget={() => {}}
      onClose={onClose}
      onSave={() => {}}
    />,
  );

  fireEvent.press(getByText('Cancel'));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(alertSpy).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});

test('remove button calls onSave without the removed attachment', () => {
  const onSave = jest.fn();
  const { getAllByLabelText, getByText } = render(
    <IdeaEditorSheet
      visible
      initialValue={{
        title: 'T',
        body: 'B',
        attachments: [
          { id: 'link-1', kind: 'link', uri: 'https://example.com', createdAt: 0 },
          { id: 'img-1', kind: 'image', uri: 'file:///image.jpg', createdAt: 0 },
        ],
      }}
      onChooseTarget={() => {}}
      onClose={() => {}}
      onSave={onSave}
    />,
  );

  const removeButtons = getAllByLabelText('Remove attachment');
  expect(removeButtons).toHaveLength(2);
  fireEvent.press(removeButtons[0]);
  fireEvent.press(getByText('Done'));

  const saved = onSave.mock.calls[0][0];
  expect(saved.attachments).toHaveLength(1);
  expect(saved.attachments[0].id).toBe('img-1');
});
