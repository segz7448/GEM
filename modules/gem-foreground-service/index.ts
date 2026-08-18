import { requireNativeModule } from 'expo-modules-core';

interface GemForegroundServiceNative {
  start(title: string, message: string): void;
  updateMessage(message: string): void;
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

export function nativeStop(): void {
  getNative()?.stop();
}
