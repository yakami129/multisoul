import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SplashScreen } from '../src/components/SplashScreen';
import { initDb } from '../src/db';
import { buildNotificationInboxItem } from '../src/features/inbox/utils/buildNotificationInboxItem';
import { pingAllEndpoints } from '../src/features/settings/services/endpointService';
import i18n from '../src/i18n';
import { getNotificationNavTarget } from '../src/services/notificationNavigation';
import { registerPushTokenForEndpoints } from '../src/services/pushTokenService';
import { useEndpointStore } from '../src/store/endpointStore';
import { useInboxStore } from '../src/store/inboxStore';
import { useLanguageStore } from '../src/store/languageStore';
import { useSpecStore } from '../src/store/specStore';
import { brandColors } from '../src/theme/brandRefresh';

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
  const endpoints = useEndpointStore((s) => s.endpoints);
  const loadInbox = useInboxStore((s) => s.load);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const loadSpecs = useSpecStore((s) => s.load);
  const loadLanguage = useLanguageStore((s) => s.loadLanguage);

  useEffect(() => {
    void (async () => {
      await initDb();
      await loadLanguage();
      await loadEndpoints();
      void pingAllEndpoints();
      await loadInbox();
      await loadSpecs();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pingAllEndpoints();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (endpoints.length === 0) return;
    void registerPushTokenForEndpoints(endpoints);
  }, [endpoints]);

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
    <I18nextProvider i18n={i18n}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <StatusBar style="dark" backgroundColor={brandColors.cream} />
              {!splashDone ? (
                <SplashScreen onComplete={() => setSplashDone(true)} />
              ) : (
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="agent/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="spec/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="idea/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="workflow/[id]" options={{ headerShown: false }} />
                </Stack>
              )}
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </I18nextProvider>
  );
}
