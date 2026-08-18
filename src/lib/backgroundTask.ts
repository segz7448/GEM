import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { resumePendingBuilds } from './buildPipeline';

export const BUILD_POLL_TASK = 'GEM_BUILD_POLL_TASK';

// Delegates to the same resume logic used on app launch (buildPipeline.ts
// resumePendingBuilds) — one recovery path, not two divergent ones. Every
// step it takes is idempotent/checkpointed, so calling it repeatedly
// (background tick after background tick) is always safe.
TaskManager.defineTask(BUILD_POLL_TASK, async () => {
  try {
    await resumePendingBuilds();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** Registers the periodic poll. Safe to call repeatedly — BackgroundFetch dedupes by task name. */
export async function registerBuildPolling(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BUILD_POLL_TASK);
  if (isRegistered) return;
  await BackgroundFetch.registerTaskAsync(BUILD_POLL_TASK, {
    // The OS treats this as a floor, not a guarantee.
    minimumInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBuildPolling(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BUILD_POLL_TASK);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(BUILD_POLL_TASK);
}
