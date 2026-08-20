import { Platform } from 'react-native';
import { nativeStart, nativeUpdateMessage, nativeUpdateProgress, nativeStop } from '../../modules/gem-foreground-service';

/**
 * Wraps the risky window of a build (persisted upload -> confirmed
 * GitHub run) in a real Android foreground service, so the OS is much
 * less likely to kill the app process while push/dispatch network calls
 * are in flight. No-ops on iOS (module is Android-only) and in Expo Go
 * (custom native modules aren't available there — needs a dev client
 * built via `expo run:android`, which this project already uses).
 */
export function startBuildKeepAlive(appName: string | null, message: string): void {
  if (Platform.OS !== 'android') return;
  nativeStart(appName || 'GEM', message);
}

export function updateBuildKeepAliveMessage(message: string): void {
  if (Platform.OS !== 'android') return;
  nativeUpdateMessage(message);
}

/** max <= 0 shows an indeterminate spinner-style bar instead of a percentage. */
export function updateBuildKeepAliveProgress(message: string, current: number, max: number): void {
  if (Platform.OS !== 'android') return;
  nativeUpdateProgress(message, current, max);
}

export function stopBuildKeepAlive(): void {
  if (Platform.OS !== 'android') return;
  nativeStop();
}
