import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { ensureNotificationSetup } from '@/lib/notifications';
import { registerBuildPolling } from '@/lib/backgroundTask';
import { resumePendingBuilds } from '@/lib/buildPipeline';

export default function RootLayout() {
  useEffect(() => {
    ensureNotificationSetup();
    registerBuildPolling();
    // The reliable recovery point — background fetch is best-effort and
    // can be delayed indefinitely by the OS, but the app reopening is
    // guaranteed to happen before the person can start a new build.
    resumePendingBuilds();
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
        <Stack.Screen name="build/[id]" options={{ title: 'Build' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
