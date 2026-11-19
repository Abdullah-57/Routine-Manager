package com.routinemanager.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

class AssistantBackgroundModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AssistantBackgroundModule"
        const val EVENT_ON_WAKE_WORD = "onWakeWordTriggered"

        private var reactContextRef: WeakReference<ReactApplicationContext>? = null

        fun emitWakeWord(context: Context, wakePhrase: String, transcript: String) {
            try {
                val ctx = reactContextRef?.get()
                if (ctx != null && ctx.hasActiveReactInstance()) {
                    val map = Arguments.createMap().apply {
                        putString("wakePhrase", wakePhrase)
                        putString("transcript", transcript)
                        putDouble("timestamp", System.currentTimeMillis().toDouble())
                    }
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(EVENT_ON_WAKE_WORD, map)
                }
            } catch (e: Exception) {
                Log.w(NAME, "Error emitting wake-word event to React Native: ${e.message}")
            }
        }
    }

    init {
        reactContextRef = WeakReference(reactContext)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun startBackgroundListener(wakePhrase: String?, promise: Promise) {
        try {
            // Validate RECORD_AUDIO runtime permission
            val audioPermission = ContextCompat.checkSelfPermission(
                reactContext,
                Manifest.permission.RECORD_AUDIO
            )
            if (audioPermission != PackageManager.PERMISSION_GRANTED) {
                promise.reject(
                    "E_PERMISSION_DENIED",
                    "RECORD_AUDIO permission is required to start the background wake-word service"
                )
                return
            }

            // Android 13+ POST_NOTIFICATIONS check
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val notifPermission = ContextCompat.checkSelfPermission(
                    reactContext,
                    Manifest.permission.POST_NOTIFICATIONS
                )
                if (notifPermission != PackageManager.PERMISSION_GRANTED) {
                    Log.w(NAME, "POST_NOTIFICATIONS not yet granted on Android 13+")
                }
            }

            val intent = Intent(reactContext, AssistantForegroundService::class.java).apply {
                action = AssistantForegroundService.ACTION_START
                if (!wakePhrase.isNullOrBlank()) {
                    putExtra(AssistantForegroundService.EXTRA_WAKE_PHRASE, wakePhrase)
                }
            }

            ContextCompat.startForegroundService(reactContext, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "startBackgroundListener error: ${e.message}", e)
            promise.reject("E_START_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopBackgroundListener(promise: Promise) {
        try {
            val intent = Intent(reactContext, AssistantForegroundService::class.java).apply {
                action = AssistantForegroundService.ACTION_STOP
            }
            reactContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "stopBackgroundListener error: ${e.message}", e)
            promise.reject("E_STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isListening(promise: Promise) {
        try {
            val map = Arguments.createMap().apply {
                putBoolean("isRunning", AssistantForegroundService.isRunning)
                putBoolean("isListening", AssistantForegroundService.isListening)
                putString("activeWakePhrase", AssistantForegroundService.activeWakePhrase)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("E_QUERY_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun setWakePhrase(wakePhrase: String, promise: Promise) {
        try {
            AssistantForegroundService.activeWakePhrase = wakePhrase
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_SET_PHRASE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required for React Native NativeEventEmitter
    }
}
