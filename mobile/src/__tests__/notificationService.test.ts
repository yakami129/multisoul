import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

// Mock expo-av using factory-only pattern to avoid jest hoisting issues
jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(),
    },
  },
}));

// Mock expo-notifications
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
}));

// Mock the sound asset require
jest.mock('../../assets/sounds/task-complete.wav', () => 1, { virtual: true });

import { Audio } from 'expo-av';
import { notifyTaskComplete } from '@/services/notificationService';

// Typed references to the mocked functions
const mockCreateAsync = Audio.Sound.createAsync as jest.Mock;

const mockPlayAsync = jest.fn().mockResolvedValue(undefined);
const mockUnloadAsync = jest.fn().mockResolvedValue(undefined);

const baseArgs = {
  agentName: 'Deploy Bot',
  summary: 'Deployment finished successfully',
  agentId: 'agent-1',
  convId: 'conv-1',
  endpointId: 'ep-1',
};

// Helper: set AppState.currentState as a configurable property (plain value in RN mock)
function setAppState(state: string) {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

describe('notifyTaskComplete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset createAsync to return fresh sound mock each test
    mockCreateAsync.mockResolvedValue({
      sound: { playAsync: mockPlayAsync, unloadAsync: mockUnloadAsync },
    });
  });

  it('plays sound and does NOT schedule notification when app is active', async () => {
    setAppState('active');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
    expect(mockPlayAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules notification and does NOT play sound when app is background', async () => {
    setAppState('background');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.title).toBe('Deploy Bot 任务完成');
    expect(call.content.body).toBe('Deployment finished successfully');
    expect(call.content.data).toMatchObject({
      type: 'task_completed',
      agentId: 'agent-1',
      convId: 'conv-1',
      endpointId: 'ep-1',
    });
    expect(call.trigger).toBeNull();
  });

  it('truncates summary to 100 chars in notification body', async () => {
    setAppState('background');
    const longSummary = 'A'.repeat(120);

    await notifyTaskComplete({ ...baseArgs, summary: longSummary });

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.body.length).toBeLessThanOrEqual(103); // 100 + '...'
    expect(call.content.body).toMatch(/\.\.\.$/);
  });

  it('uses fallback body when summary is empty', async () => {
    setAppState('background');

    await notifyTaskComplete({ ...baseArgs, summary: '' });

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.body).toBe('点击查看详情');
  });

  it('unloads sound after playing to free memory', async () => {
    setAppState('active');

    await notifyTaskComplete(baseArgs);

    expect(mockUnloadAsync).toHaveBeenCalledTimes(1);
  });
});
