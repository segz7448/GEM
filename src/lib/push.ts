import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'gem_fcm_device_token';

/**
 * There's no backend, so this device's FCM token isn't sent anywhere
 * automatically - it's meant to be copied from Settings and pasted into the
 * repo's FCM_DEVICE_TOKEN secret once. GitHub Actions itself calls FCM
 * directly (see workflowGenerator.ts) using that static token.
 *
 * Uses getDevicePushTokenAsync() (raw native FCM registration token), not
 * getExpoPushTokenAsync() - the latter requires an EAS project ID and
 * routes through Expo's push relay, neither of which this project uses.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data === 'string' && data.length > 0) {
      await SecureStore.setItemAsync(TOKEN_KEY, data);
      return data;
    }
    return null;
  } catch {
    // Most commonly: no google-services.json bundled into this build yet,
    // or Google Play Services isn't available on this device/emulator.
    return null;
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
