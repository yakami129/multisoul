import * as Notifications from 'expo-notifications';
// eslint-disable-next-line import/order
import { AppState } from 'react-native';

// Mock expo-audio using factory-only pattern to avoid jest hoisting issues
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
}));

// Mock expo-notifications
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
}));

// Mock the sound asset require
jest.mock('../../assets/sounds/task-complete.wav', () => 1, { virtual: true });

// eslint-disable-next-line import/order
import { createAudioPlayer } from 'expo-audio';
import { notifyTaskComplete } from '@/services/notificationService';

// Typed references to the mocked functions
const mockCreateAudioPlayer = createAudioPlayer as jest.Mock;

const mockPlay = jest.fn();
const mockRemovePlayer = jest.fn();
const mockRemoveSubscription = jest.fn();
const mockAddListener = jest.fn();

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
    mockAddListener.mockReturnValue({ remove: mockRemoveSubscription });
    mockCreateAudioPlayer.mockReturnValue({
      addListener: mockAddListener,
      play: mockPlay,
      remove: mockRemovePlayer,
    });
  });

  it('plays sound and does NOT schedule notification when app is active', async () => {
    setAppState('active');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules notification and does NOT play sound when app is background', async () => {
    setAppState('background');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.title).toBe('Deploy Bot 任务完成');
    expect(call.content.body).toBe('Deployment finished successfully');
    expect(call.content.data).toMatchObject({
      type: 'task_completed',
      agentId: 'agent-1',
      agent_id: 'agent-1',
      resourceId: 'agent-1',
      resource_id: 'agent-1',
      convId: 'conv-1',
      conversation_id: 'conv-1',
      endpointId: 'ep-1',
      endpoint_id: 'ep-1',
    });
    expect(call.trigger).toBeNull();
  });

  it('includes project context when scheduling notification data', async () => {
    setAppState('background');

    await notifyTaskComplete({
      ...baseArgs,
      projectId: 'project-1',
      projectName: 'MultiSoul',
      resourceName: 'Codex Runtime',
    });

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.data).toMatchObject({
      projectId: 'project-1',
      project_id: 'project-1',
      projectName: 'MultiSoul',
      project_name: 'MultiSoul',
      resourceName: 'Codex Runtime',
      resource_name: 'Codex Runtime',
    });
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

  it('removes sound player after playback finishes', async () => {
    setAppState('active');

    await notifyTaskComplete(baseArgs);

    const statusListener = mockAddListener.mock.calls[0][1];
    statusListener({ didJustFinish: false });
    expect(mockRemovePlayer).not.toHaveBeenCalled();

    statusListener({ didJustFinish: true });
    expect(mockRemoveSubscription).toHaveBeenCalledTimes(1);
    expect(mockRemovePlayer).toHaveBeenCalledTimes(1);
  });
});
