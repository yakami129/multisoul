import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

interface NotifyTaskCompleteArgs {
  agentName: string;
  summary: string;
  agentId: string;
  convId: string;
  endpointId: string;
}

export async function notifyTaskComplete({
  agentName,
  summary,
  agentId,
  convId,
  endpointId,
}: NotifyTaskCompleteArgs): Promise<void> {
  if (AppState.currentState === 'active') {
    await playForegroundSound();
  } else {
    await scheduleBackgroundNotification({ agentName, summary, agentId, convId, endpointId });
  }
}

async function playForegroundSound(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = require('../../assets/sounds/task-complete.wav') as number;
  const { sound } = await Audio.Sound.createAsync(asset);
  await sound.playAsync();
  // Unload immediately after play to free memory
  await sound.unloadAsync();
}

async function scheduleBackgroundNotification({
  agentName,
  summary,
  agentId,
  convId,
  endpointId,
}: NotifyTaskCompleteArgs): Promise<void> {
  const body =
    summary.length === 0
      ? '点击查看详情'
      : summary.length > 100
        ? summary.slice(0, 100) + '...'
        : summary;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${agentName} 任务完成`,
      body,
      sound: 'default',
      data: {
        type: 'task_completed',
        agentId,
        convId,
        endpointId,
      },
    },
    trigger: null,
  });
}
