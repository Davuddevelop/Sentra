/**
 * Sentra — iOS Screen Time Native Module
 *
 * Framework: FamilyControls + DeviceActivity + ManagedSettings
 * Minimum iOS: 16.0
 * Requires: Xcode 15+, Apple Developer account, "Family Controls" entitlement
 *
 * HOW TO INTEGRATE:
 * 1. In Xcode, add the "Family Controls" capability to the app target
 * 2. Add this file to your ios/ Xcode project
 * 3. Expose the methods via a RCT_EXPORT_MODULE() bridge (see ScreenTimeBridge.m)
 * 4. Call from JS via NativeModules.ScreenTimeModule
 */

import Foundation
import FamilyControls
import DeviceActivity
import ManagedSettings
import React

@objc(ScreenTimeModule)
class ScreenTimeModule: NSObject, RCTBridgeModule {

  static func moduleName() -> String! { return "ScreenTimeModule" }
  static func requiresMainQueueSetup() -> Bool { return false }

  private let center = AuthorizationCenter.shared
  private let store  = ManagedSettingsStore()

  // ── Request parental authorization ───────────────────────────
  // Call this once on first launch — presents the iOS Family Controls consent dialog
  @objc func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        try await center.requestAuthorization(for: .individual)
        resolve(["granted": true])
      } catch {
        reject("AUTH_FAILED", error.localizedDescription, error)
      }
    }
  }

  // ── Start monitoring a DeviceActivity schedule ────────────────
  // Records which app categories are used and for how long
  @objc func startActivityMonitoring(_ resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: 0, minute: 0),
      intervalEnd:   DateComponents(hour: 23, minute: 59),
      repeats:       true
    )

    let monitor = DeviceActivityCenter()
    do {
      try monitor.startMonitoring(.daily, during: schedule)
      resolve(["monitoring": true])
    } catch {
      reject("MONITOR_FAILED", error.localizedDescription, error)
    }
  }

  // ── Block a specific app category ────────────────────────────
  // e.g. block "Social Networking" category apps
  @objc func blockCategory(_ categoryToken: String,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject:  @escaping RCTPromiseRejectBlock) {
    // In production: decode categoryToken from a FamilyActivitySelection
    // stored by the parent app's ActivityPickerView
    store.shield.applicationCategories = .all()
    resolve(["blocked": true])
  }

  // ── Remove all blocks ─────────────────────────────────────────
  @objc func removeAllBlocks(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    store.shield.applicationCategories = nil
    store.shield.applications = nil
    resolve(["cleared": true])
  }
}

// ── DeviceActivity Monitor Extension ─────────────────────────
// This runs in a separate App Extension target (DeviceActivityMonitorExtension)
// Add a new "Device Activity Monitor Extension" target in Xcode

class SentraActivityMonitor: DeviceActivityMonitor {

  let API_BASE = "http://localhost:3001" // Replace with production URL

  override func intervalDidStart(for activity: DeviceActivityName) {
    // Called at the start of each monitoring interval (e.g. midnight)
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    // Called at end of each interval — compute daily totals here
    reportDailyUsage()
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name,
                                        activity: DeviceActivityName) {
    // Called when a usage threshold is crossed (e.g. 2h on social apps)
    sendSignal(type: "screen.excessive", payload: [
      "platform": "ios",
      "total_hours": 2,
      "day": dayString(),
    ])
  }

  private func reportDailyUsage() {
    // DeviceActivityReport is rendered via SwiftUI — use DeviceActivityReportExtension
    // to collect per-app usage totals and send them as signals
    sendSignal(type: "screen.excessive", payload: [
      "platform": "ios",
      "total_hours": 0, // populate from DeviceActivityResults
      "day": dayString(),
    ])
  }

  private func dayString() -> String {
    let f = DateFormatter(); f.dateFormat = "EEE"; return f.string(from: Date())
  }

  private func sendSignal(type: String, payload: [String: Any]) {
    guard let token = UserDefaults(suiteName: "group.com.sentra.app")?.string(forKey: "deviceToken"),
          let url   = URL(string: "\(API_BASE)/api/signal"),
          let body  = try? JSONSerialization.data(withJSONObject: ["type": type, "payload": payload])
    else { return }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(token, forHTTPHeaderField: "X-Device-Token")
    req.httpBody = body

    URLSession.shared.dataTask(with: req).resume()
  }
}
