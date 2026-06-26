import { createAudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

// RN static asset — bundler resolves this to a numeric resource ID at build time
// eslint-disable-next-line @typescript-eslint/no-require-imports
const taskCompleteSound = require('../../assets/sounds/task-complete.wav') as number;

interface NotifyTaskCompleteArgs {
  agentName: string;
  summary: string;
  agentId: string;
  convId: string;
  endpointId: string;
  projectId?: string;
  projectName?: string;
  resourceId?: string;
  resourceName?: string;
}

export async function notifyTaskComplete(args: NotifyTaskCompleteArgs): Promise<void> {
  try {
    if (AppState.currentState === 'active') {
      await playForegroundSound();
    } else {
      await scheduleBackgroundNotification(args);
    }
  } catch (e) {
    // Notification is non-critical — log but never crash the caller
    console.warn('[notificationService] notifyTaskComplete failed:', e);
  }
}

async function playForegroundSound(): Promise<void> {
  const player = createAudioPlayer(taskCompleteSound);
  const subscription = player.addListener('playbackStatusUpdate', (status) => {
    if (!status.didJustFinish) {
      return;
    }

    subscription.remove();
    player.remove();
  });
  player.play();
}

async function scheduleBackgroundNotification({
  agentName,
  summary,
  agentId,
  convId,
  endpointId,
  projectId,
  projectName,
  resourceId,
  resourceName,
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
        agent_id: agentId,
        resourceId: resourceId ?? agentId,
        resource_id: resourceId ?? agentId,
        resourceName: resourceName ?? agentName,
        resource_name: resourceName ?? agentName,
        convId,
        conversation_id: convId,
        endpointId,
        endpoint_id: endpointId,
        ...(projectId ? { projectId, project_id: projectId } : {}),
        ...(projectName ? { projectName, project_name: projectName } : {}),
      },
    },
    trigger: null,
  });
}
