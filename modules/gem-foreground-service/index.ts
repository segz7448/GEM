import { requireNativeModule } from 'expo-modules-core';

interface GemForegroundServiceNative {
  start(title: string, message: string): void;
  updateMessage(message: string): void;
  updateProgress(message: string, current: number, max: number): void;
  stop(): void;
}

let native: GemForegroundServiceNative | null | undefined;

/** Lazy + cached — only touches the native side the first time it's actually called. */
function getNative(): GemForegroundServiceNative | null {
  if (native !== undefined) return native;
  try {
    native = requireNativeModule<GemForegroundServiceNative>('GemForegroundService');
  } catch {
    // Not available — e.g. running in Expo Go, or on iOS (Android-only module).
    native = null;
  }
  return native;
}

export function nativeStart(title: string, message: string): void {
  getNative()?.start(title, message);
}

export function nativeUpdateMessage(message: string): void {
  getNative()?.updateMessage(message);
}

/** max <= 0 renders an indeterminate spinner-bar instead of a determinate percentage. */
export function nativeUpdateProgress(message: string, current: number, max: number): void {
  getNative()?.updateProgress(message, current, max);
}

export function nativeStop(): void {
  getNative()?.stop();
}
