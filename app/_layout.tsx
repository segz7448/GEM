import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { ensureNotificationSetup } from '@/lib/notifications';
import { registerForPushNotificationsAsync } from '@/lib/push';
import { registerBuildPolling } from '@/lib/backgroundTask';
import { resumePendingBuilds } from '@/lib/buildPipeline';

export default function RootLayout() {
  useEffect(() => {
    ensureNotificationSetup();
    // Best-effort — silently no-ops if google-services.json isn't bundled
    // into this build yet. Settings has a manual retry button.
    registerForPushNotificationsAsync();
    registerBuildPolling();
    // The reliable recovery point — background fetch is best-effort and
    // can be delayed indefinitely by the OS, but the app reopening is
    // guaranteed to happen before the person can start a new build.
    resumePendingBuilds();

    // Routes both local build-progress notification taps and remote FCM
    // notification taps (started/success/failed, sent directly by GitHub
    // Actions) to that build's detail screen.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const buildId = response.notification.request.content.data?.buildId;
      if (typeof buildId === 'string' && buildId.length > 0) {
        router.push(`/build/${buildId}`);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0B0B12' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#0B0B12' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'GEM' }} />
        <Stack.Screen name="upload" options={{ title: 'New Build' }} />
        <Stack.Screen name="history" options={{ title: 'Build History' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="secrets" options={{ title: 'Repository Secrets' }} />
        <Stack.Screen name="build/[id]" options={{ title: 'Build' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
