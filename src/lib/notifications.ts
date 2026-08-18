import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { LocalBuildStatus } from './db';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const CHANNEL_ID = 'gem-build-progress';

export async function ensureNotificationSetup(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Build progress',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: null,
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  preparing: 'Preparing project',
  scanning: 'Scanning project',
  generating_workflow: 'Setting up build config',
  uploading: 'Uploading',
  starting_runner: 'Starting build runner',
  building: 'Building',
  downloading: 'Downloading result',
  completed: 'Build complete',
  failed: 'Build failed',
  cancelled: 'Build cancelled',
};

/**
 * Re-uses the same notification identifier (`gem-build-{id}`) on every
 * call, so Android/iOS update the existing notification in place rather
 * than stacking a new one per stage change — this is what gives the
 * "live" feel without a true foreground-service notification.
 */
export async function upsertBuildNotification(buildId: string, appName: string | null, status: LocalBuildStatus): Promise<void> {
  const label = STAGE_LABELS[status] ?? status;
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';

  await Notifications.scheduleNotificationAsync({
    identifier: `gem-build-${buildId}`,
    content: {
      title: appName ? `${appName} — ${label}` : `GEM build — ${label}`,
      body: isTerminal ? tapToOpenMessage(status) : 'Tap to view progress.',
      data: { buildId },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      sticky: !isTerminal,
      autoDismiss: isTerminal,
    },
    trigger: null,
  });
}

function tapToOpenMessage(status: LocalBuildStatus): string {
  if (status === 'completed') return 'Your APK is ready to download.';
  if (status === 'failed') return 'Tap to see what went wrong.';
  return 'Build was cancelled.';
}

export async function clearBuildNotification(buildId: string): Promise<void> {
  await Notifications.dismissNotificationAsync(`gem-build-${buildId}`).catch(() => undefined);
}
