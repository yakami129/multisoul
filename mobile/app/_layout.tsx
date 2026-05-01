import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SplashScreen } from '../src/components/SplashScreen';
import { initDb } from '../src/db';
import { buildNotificationInboxItem } from '../src/features/inbox/utils/buildNotificationInboxItem';
import { useEndpointStore } from '../src/store/endpointStore';
import { useInboxStore } from '../src/store/inboxStore';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 10_000 } },
});

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isForeground = AppState.currentState === 'active';
    return {
      shouldShowAlert: !isForeground,
      shouldPlaySound: !isForeground,
      shouldSetBadge: true,
      shouldShowBanner: !isForeground,
      shouldShowList: true,
    };
  },
});

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const loadEndpoints = useEndpointStore((s) => s.load);
  const loadInbox = useInboxStore((s) => s.load);
  const addInboxItem = useInboxStore((s) => s.addItem);

  useEffect(() => {
    void (async () => {
      await initDb();
      await loadEndpoints();
      await loadInbox();
      await registerPushToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const item = buildNotificationInboxItem({
        data: notification.request.content.data ?? {},
        title: notification.request.content.title ?? '',
        body: notification.request.content.body ?? '',
      });
      if (item) {
        void addInboxItem(item);
      }
    });
    return () => {
      sub.remove();
    };
  }, [addInboxItem]);

  const router = useRouter();

  // Handle notification tap while app is running
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      const target = getNotificationNavTarget(data);
      if (target) router.push(target as `/${string}`);
    });
    return () => sub.remove();
  }, [router]);

  // Handle cold-start: app was killed, user tapped notification to open it
  useEffect(() => {
    if (!splashDone) return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      const target = getNotificationNavTarget(data);
      if (target) router.push(target as `/${string}`);
    });
  }, [splashDone, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="light" backgroundColor="#040D04" />
            {!splashDone ? (
              <SplashScreen onComplete={() => setSplashDone(true)} />
            ) : (
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="agent/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
              </Stack>
            )}
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

async function registerPushToken(): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const token = (
      await Notifications.getExpoPushTokenAsync({
        projectId: 'multisoul-local-dev',
      })
    ).data;
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('expo_push_token', token);
  } catch (e) {
    // Push token registration is optional — silently skip in dev/simulator
    console.warn('[push] registerPushToken skipped:', e);
  }
}

function getNotificationNavTarget(data: Record<string, string | undefined>): string | null {
  if (data?.type !== 'task_completed') return null;
  const { agentId, convId, endpointId } = data;
  if (!agentId || !convId || !endpointId) return null;
  return `/agent/${agentId}/chat?conv_id=${convId}&endpoint_id=${endpointId}`;
}
