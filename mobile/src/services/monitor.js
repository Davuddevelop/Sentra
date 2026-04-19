/**
 * Cross-platform monitoring service.
 *
 * What this file does WITHOUT native modules (works on any device via JS):
 *   - Late-night usage detection (23:00–06:00)
 *   - Excessive screen time (session > 90 min)
 *   - App foreground/background transitions
 *   - Periodic signal flush
 *
 * What requires native modules (see native/ folder):
 *   - iOS: Reading which third-party apps are open → ScreenTimeModule.swift
 *   - Android: Reading DM text from other apps → AccessibilityModule.kt
 *   - Android: Preventing uninstall → DeviceAdminReceiver.kt
 */

import { AppState } from 'react-native'
import { enqueueSignal, flushSignals } from './api'

let sessionStartMs  = null
let flushInterval   = null
let appStateSub     = null

const LATE_NIGHT_START = 23 // 11pm
const LATE_NIGHT_END   = 6  // 6am
const EXCESSIVE_MS     = 90 * 60 * 1000 // 90 minutes

function isLateNight() {
  const h = new Date().getHours()
  return h >= LATE_NIGHT_START || h < LATE_NIGHT_END
}

export function startMonitor(platform) {
  sessionStartMs = Date.now()

  // Late-night check on session start
  if (isLateNight()) {
    enqueueSignal('screen.late_night', {
      platform,
      start_time: new Date().toISOString().slice(11, 16),
    })
  }

  // AppState: detect when app comes back to foreground after being backgrounded
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      sessionStartMs = Date.now()
      if (isLateNight()) {
        enqueueSignal('screen.late_night', {
          platform,
          start_time: new Date().toISOString().slice(11, 16),
        })
      }
    }
    if (state === 'background') {
      checkExcessive(platform)
    }
  })

  // Flush signals every 60s
  flushInterval = setInterval(() => {
    checkExcessive(platform)
    flushSignals()
  }, 60_000)
}

export function stopMonitor() {
  appStateSub?.remove()
  clearInterval(flushInterval)
  flushSignals()
}

function checkExcessive(platform) {
  if (!sessionStartMs) return
  const mins = (Date.now() - sessionStartMs) / 60_000
  if (mins >= 90) {
    enqueueSignal('screen.excessive', {
      platform,
      total_hours: +(mins / 60).toFixed(1),
      day: new Date().toLocaleDateString('en-US', { weekday: 'short' }),
    })
    sessionStartMs = Date.now() // reset so we don't re-fire every minute
  }
}
