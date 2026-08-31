import { BackgroundSyncService } from './BackgroundSyncService';
import { BackgroundSyncConfig } from './types';

function getBackgroundFetchModule(): any {
  try {
    return require('react-native-background-fetch').default;
  } catch {
    return null;
  }
}

/**
 * Headless task handler executed by OS even when app is closed / killed.
 */
export async function backgroundFetchHeadlessTask(event: { taskId: string; timeout: boolean }): Promise<void> {
  const BackgroundFetch = getBackgroundFetchModule();

  if (event.timeout) {
    if (BackgroundFetch) {
      BackgroundFetch.finish(event.taskId);
    }
    return;
  }

  try {
    const result = await BackgroundSyncService.executeSync();
    if (BackgroundFetch) {
      const fetchResult =
        result.status === 'NEW_DATA'
          ? BackgroundFetch.FETCH_RESULT_NEW_DATA
          : result.status === 'FAILED'
          ? BackgroundFetch.FETCH_RESULT_FAILED
          : BackgroundFetch.FETCH_RESULT_NO_DATA;

      BackgroundFetch.finish(event.taskId, fetchResult);
    }
  } catch {
    if (BackgroundFetch) {
      BackgroundFetch.finish(event.taskId, BackgroundFetch.FETCH_RESULT_FAILED);
    }
  }
}

/**
 * Configures and registers periodic background fetch task (every ~15 minutes).
 */
export async function registerBackgroundSync(
  config?: BackgroundSyncConfig
): Promise<boolean> {
  const BackgroundFetch = getBackgroundFetchModule();
  if (!BackgroundFetch) {
    return false;
  }

  try {
    // Register Android Headless JS Task
    BackgroundFetch.registerHeadlessTask(backgroundFetchHeadlessTask);

    // Configure Background Fetch schedule
    await BackgroundFetch.configure(
      {
        minimumFetchInterval: 15, // minutes
        stopOnTerminate: false,
        enableHeadless: true,
        startOnBoot: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async (taskId: string) => {
        await backgroundFetchHeadlessTask({ taskId, timeout: false });
      },
      (taskId: string) => {
        // Timeout callback
        backgroundFetchHeadlessTask({ taskId, timeout: true });
      }
    );

    return true;
  } catch {
    return false;
  }
}

