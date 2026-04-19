import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import { flushSignals } from './api'

const TASK_NAME = 'sentra-signal-flush'

// Register the task handler — must be called at the top level of the app (before any await)
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await flushSignals()
    return BackgroundFetch.BackgroundFetchResult.NewData
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed
  }
})

export async function registerBackgroundFlush() {
  const status = await BackgroundFetch.getStatusAsync()

  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied) {
    console.warn('[sentra] Background fetch not available on this device')
    return false
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME)
  if (isRegistered) return true

  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 60,        // fire at most every 60s (OS may throttle)
    stopOnTerminate: false,     // Android: keep running after app killed
    startOnBoot: true,          // Android: restart after device reboot
  })

  return true
}

export async function unregisterBackgroundFlush() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME)
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME)
}
