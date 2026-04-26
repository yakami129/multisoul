import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SplashScreen } from '../src/components/SplashScreen';
import { initDb } from '../src/db';
import { useEndpointStore } from '../src/store/endpointStore';
import { useInboxStore } from '../src/store/inboxStore';
import { type InboxItem } from '../src/types';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 10_000 } },
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
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
      const data = notification.request.content.data as Record<string, string | undefined>;
      if (data?.inbox_id) {
        const item: InboxItem = {
          id: data.inbox_id,
          endpoint_id: data.endpoint_id ?? '',
          agent_id: data.agent_id ?? '',
          conversation_id: data.conversation_id ?? '',
          kind: data.kind ?? 'complex_done',
          title: notification.request.content.title ?? '',
          body: notification.request.content.body ?? '',
          payload: null,
          received_at: Date.now(),
          read_at: null,
        };
        addInboxItem(item);
      }
    });
    return () => {
      sub.remove();
    };
  }, [addInboxItem]);

  return (
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
