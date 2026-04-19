/**
 * Sentra — Android Accessibility Service + Device Admin
 *
 * Framework: Android Accessibility Services + DevicePolicyManager
 * Minimum Android: API 26 (Android 8.0)
 * Requires: Accessibility permission granted by parent
 *
 * HOW TO INTEGRATE:
 * 1. Add SentraAccessibilityService to android/app/src/main/AndroidManifest.xml
 * 2. Add SentraDeviceAdmin to AndroidManifest.xml
 * 3. Register SentraAccessibilityModule with the ReactPackage
 * 4. Call from JS via NativeModules.AccessibilityModule
 *
 * AndroidManifest.xml entries needed:
 *
 * <service android:name=".SentraAccessibilityService"
 *   android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
 *   android:exported="true">
 *   <intent-filter>
 *     <action android:name="android.accessibilityservice.AccessibilityService"/>
 *   </intent-filter>
 *   <meta-data android:name="android.accessibilityservice"
 *     android:resource="@xml/accessibility_service_config"/>
 * </service>
 *
 * <receiver android:name=".SentraDeviceAdmin"
 *   android:permission="android.permission.BIND_DEVICE_ADMIN"
 *   android:exported="true">
 *   <meta-data android:name="android.app.device_admin"
 *     android:resource="@xml/device_admin"/>
 *   <intent-filter>
 *     <action android:name="android.app.action.DEVICE_ADMIN_ENABLED"/>
 *   </intent-filter>
 * </receiver>
 */

package com.sentra.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

// ── React Native bridge module ────────────────────────────────
class AccessibilityModule(private val reactContext: ReactApplicationContext)
  : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AccessibilityModule"

  @ReactMethod
  fun isAccessibilityEnabled(promise: Promise) {
    val enabled = SentraAccessibilityService.isRunning
    promise.resolve(enabled)
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      val intent = android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)
      intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SETTINGS_ERROR", e.message)
    }
  }

  @ReactMethod
  fun isDeviceAdminEnabled(promise: Promise) {
    val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val component = ComponentName(reactContext, SentraDeviceAdmin::class.java)
    promise.resolve(dpm.isAdminActive(component))
  }

  @ReactMethod
  fun requestDeviceAdmin(promise: Promise) {
    try {
      val component = ComponentName(reactContext, SentraDeviceAdmin::class.java)
      val intent = android.content.Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
        putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
        putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
          "Prevents your child from uninstalling Sentra without the parent PIN.")
        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ADMIN_ERROR", e.message)
    }
  }
}

// ── Accessibility Service ─────────────────────────────────────
class SentraAccessibilityService : AccessibilityService() {

  companion object {
    var isRunning = false
    private const val API_BASE = "http://localhost:3001" // Replace with production URL

    private val AI_PACKAGES = setOf(
      "com.openai.chatgpt",
      "ai.character.app",
      "ai.replika.app",
      "com.anthropic.claude",
      "com.google.android.apps.bard",
      "com.microsoft.copilot",
    )

    private val ROMANTIC_PATTERNS = listOf(
      "i love you", "kiss me", "be my girlfriend", "be my boyfriend",
      "fall in love", "you're my partner", "romantic", "marry me",
    )

    private val JAILBREAK_PATTERNS = listOf(
      "ignore previous", "pretend you", "act as", "you are now",
      "dan mode", "developer mode", "no restrictions",
    )

    private val HARMFUL_PATTERNS = mapOf(
      "self.harm"        to listOf("hurt myself", "cut myself", "self harm"),
      "diet_restriction" to listOf("how to stop eating", "how to fast", "how to starve"),
      "weapon"           to listOf("how to make a bomb", "how to build a weapon"),
    )
  }

  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  private val http  = OkHttpClient()
  private var lastPackage: String? = null
  private var sessionStart: Long = System.currentTimeMillis()

  override fun onServiceConnected() {
    isRunning = true
    serviceInfo = AccessibilityServiceInfo().apply {
      eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                   AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
                   AccessibilityEvent.TYPE_VIEW_CLICKED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
              AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
      notificationTimeout = 100
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    val pkg = event.packageName?.toString() ?: return

    // App switched to an AI app
    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg in AI_PACKAGES) {
      if (pkg != lastPackage) {
        lastPackage = pkg
        sessionStart = System.currentTimeMillis()
        sendSignal("app.foreground", mapOf("app" to appLabel(pkg), "platform" to "android"))
      }
    }

    // Text changed in an AI app — scan first 80 chars (Zero-Knowledge)
    if (event.eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED && pkg in AI_PACKAGES) {
      val text = event.text.joinToString(" ").take(80).lowercase()
      scanText(text, appLabel(pkg))
    }
  }

  private fun scanText(text: String, app: String) {
    // Jailbreak check
    if (JAILBREAK_PATTERNS.any { text.contains(it) }) {
      sendSignal("ai.jailbreak_attempt", mapOf(
        "app" to app, "attempts" to 1, "prompt_pattern" to "safety_bypass_detected"
      ))
    }

    // Romantic check
    if (ROMANTIC_PATTERNS.any { text.contains(it) }) {
      sendSignal("ai.romantic_roleplay", mapOf(
        "app" to app, "persona_type" to "romantic", "session_frequency" to "detected"
      ))
    }

    // Harmful content check
    for ((category, patterns) in HARMFUL_PATTERNS) {
      if (patterns.any { text.contains(it) }) {
        sendSignal("ai.harmful_advice", mapOf(
          "app" to app, "topic_category" to category, "flagged" to true
        ))
        break
      }
    }
  }

  private fun appLabel(pkg: String) = when (pkg) {
    "com.openai.chatgpt"               -> "ChatGPT"
    "ai.character.app"                 -> "Character.AI"
    "ai.replika.app"                   -> "Replika"
    "com.anthropic.claude"             -> "Claude"
    "com.google.android.apps.bard"     -> "Gemini"
    "com.microsoft.copilot"            -> "Copilot"
    else                               -> pkg
  }

  private fun sendSignal(type: String, payload: Map<String, Any>) {
    val prefs = getSharedPreferences("SentraPrefs", Context.MODE_PRIVATE)
    val token = prefs.getString("deviceToken", null) ?: return

    scope.launch {
      try {
        val body = JSONObject(mapOf("type" to type, "payload" to payload))
          .toString()
          .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
          .url("$API_BASE/api/signal")
          .addHeader("X-Device-Token", token)
          .post(body)
          .build()

        http.newCall(request).execute().close()
      } catch (e: IOException) {
        // Queue for later — OkHttp retry or local SQLite queue
      }
    }
  }

  override fun onInterrupt() { isRunning = false }
  override fun onDestroy()   { isRunning = false; scope.cancel() }
}

// ── Device Admin Receiver — prevents uninstall ────────────────
class SentraDeviceAdmin : DeviceAdminReceiver() {
  override fun onEnabled(context: Context, intent: android.content.Intent) {
    // Device admin activated — child can no longer uninstall Sentra without PIN
  }

  override fun onDisabled(context: Context, intent: android.content.Intent) {
    // Notify parent that device admin was removed
    val prefs = context.getSharedPreferences("SentraPrefs", Context.MODE_PRIVATE)
    val token = prefs.getString("deviceToken", null) ?: return

    val body = JSONObject(mapOf(
      "type"    to "app.tamper_detected",
      "payload" to mapOf("platform" to "android", "event" to "device_admin_removed")
    )).toString()

    // Fire synchronously in receiver — short window
    try {
      val client = OkHttpClient()
      val req = Request.Builder()
        .url("http://localhost:3001/api/signal")
        .addHeader("X-Device-Token", token)
        .post(body.toRequestBody("application/json".toMediaType()))
        .build()
      client.newCall(req).execute().close()
    } catch (_: Exception) {}
  }
}
