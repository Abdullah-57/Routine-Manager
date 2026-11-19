package com.routinemanager.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class AssistantForegroundService : Service() {

    companion object {
        private const val TAG = "AssistantForeground"
        private const val CHANNEL_ID = "assistant_foreground_channel"
        private const val NOTIFICATION_ID = 9021

        const val ACTION_START = "com.routinemanager.app.action.START_FOREGROUND"
        const val ACTION_STOP = "com.routinemanager.app.action.STOP_FOREGROUND"
        const val ACTION_PAUSE = "com.routinemanager.app.action.PAUSE_LISTENING"
        const val ACTION_RESUME = "com.routinemanager.app.action.RESUME_LISTENING"
        const val EXTRA_WAKE_PHRASE = "com.routinemanager.app.extra.WAKE_PHRASE"

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var isListening: Boolean = false
            private set

        @Volatile
        var activeWakePhrase: String = "hey assistant"
            set(value) {
                field = if (value.isNotBlank()) value.trim().lowercase() else "hey assistant"
            }
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var isPaused: Boolean = false
    private var lastActiveAudioTimestamp: Long = System.currentTimeMillis()
    private var lastWakeTriggerTimestamp: Long = 0L

    private val restartRunnable = Runnable {
        if (isRunning && !isPaused) {
            startListeningInternal()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "AssistantForegroundService onCreate()")
        createNotificationChannel()

        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "RoutineManager:AssistantWakeLock"
            )?.apply {
                setReferenceCounted(false)
                acquire(10 * 60 * 1000L /* 10 minutes auto-release safeguard */)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not acquire WakeLock: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        Log.i(TAG, "onStartCommand action=$action")

        val newWakePhrase = intent?.getStringExtra(EXTRA_WAKE_PHRASE)
        if (!newWakePhrase.isNullOrBlank()) {
            activeWakePhrase = newWakePhrase
        }

        when (action) {
            ACTION_STOP -> {
                stopForegroundInternal()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                isPaused = true
                stopListeningInternal()
                updateNotification()
            }
            ACTION_RESUME -> {
                isPaused = false
                updateNotification()
                scheduleRestart(100)
            }
            ACTION_START -> {
                isPaused = false
                isRunning = true
                startForegroundWithNotification()
                scheduleRestart(200)
            }
        }

        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Routine Assistant Background Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Hands-free continuous wake-word listening for 'Hey Assistant'"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("FROM_ASSISTANT_NOTIFICATION", true)
            putExtra("WAKE_TRIGGERED", true)
        }

        val contentPendingIntent = PendingIntent.getActivity(
            this,
            101,
            launchIntent ?: Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val pauseResumeIntent = Intent(this, AssistantForegroundService::class.java).apply {
            action = if (isPaused) ACTION_RESUME else ACTION_PAUSE
        }
        val pauseResumePendingIntent = PendingIntent.getService(
            this,
            102,
            pauseResumeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (isPaused) "Routine Assistant (Paused)" else "Routine Assistant Active"
        val text = if (isPaused) {
            "Background listening is paused. Tap Resume to listen."
        } else {
            "Listening hands-free for \"$activeWakePhrase\"..."
        }
        val toggleActionTitle = if (isPaused) "Resume" else "Pause"

        val smallIconRes = try {
            val resId = resources.getIdentifier("ic_assistant_notification", "drawable", packageName)
            if (resId != 0) resId else R.mipmap.ic_launcher
        } catch (_: Exception) {
            R.mipmap.ic_launcher
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(smallIconRes)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(contentPendingIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                toggleActionTitle,
                pauseResumePendingIntent
            )
            .addAction(
                android.R.drawable.ic_btn_speak_now,
                "Open Assistant",
                contentPendingIntent
            )

        return builder.build()
    }

    private fun startForegroundWithNotification() {
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error starting foreground service: ${e.message}", e)
        }
    }

    private fun updateNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun startListeningInternal() {
        if (!isRunning || isPaused) return

        mainHandler.post {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                    Log.w(TAG, "SpeechRecognizer not available on this device")
                    scheduleRestart(3000)
                    return@post
                }

                destroyRecognizerSafe()

                val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
                speechRecognizer = recognizer

                recognizer.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        isListening = true
                        Log.d(TAG, "SpeechRecognizer ready for speech")
                    }

                    override fun onBeginningOfSpeech() {
                        Log.d(TAG, "SpeechRecognizer: user began speaking")
                        lastActiveAudioTimestamp = System.currentTimeMillis()
                    }

                    override fun onRmsChanged(rmsdB: Float) {
                        if (rmsdB > 2.0f) {
                            lastActiveAudioTimestamp = System.currentTimeMillis()
                        }
                    }

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        isListening = false
                        Log.d(TAG, "SpeechRecognizer: end of speech")
                    }

                    override fun onError(error: Int) {
                        isListening = false
                        Log.d(TAG, "SpeechRecognizer error: $error")
                        val delay = when (error) {
                            SpeechRecognizer.ERROR_NO_MATCH,
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> calculateRestartDebounce(200L)
                            SpeechRecognizer.ERROR_AUDIO,
                            SpeechRecognizer.ERROR_SERVER,
                            SpeechRecognizer.ERROR_NETWORK -> 1000L
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 500L
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                                Log.e(TAG, "Insufficient RECORD_AUDIO permission for background service")
                                stopForegroundInternal()
                                return
                            }
                            else -> calculateRestartDebounce(300L)
                        }
                        scheduleRestart(delay)
                    }

                    override fun onResults(results: Bundle?) {
                        isListening = false
                        checkRecognitionMatches(results)
                        scheduleRestart(calculateRestartDebounce(200L))
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        checkRecognitionMatches(partialResults)
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })

                val recognizerIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    )
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
                    putExtra("android.speech.extra.DICTATION_MODE", true)
                }

                recognizer.startListening(recognizerIntent)
            } catch (e: Exception) {
                Log.e(TAG, "Exception starting SpeechRecognizer: ${e.message}", e)
                scheduleRestart(1000)
            }
        }
    }

    private fun checkRecognitionMatches(bundle: Bundle?) {
        val matches = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
        for (phrase in matches) {
            if (matchesWakePhrase(phrase, activeWakePhrase)) {
                handleWakeWordDetected(phrase)
                break
            }
        }
    }

    private fun matchesWakePhrase(heardText: String?, configuredPhrase: String): Boolean {
        if (heardText.isNullOrBlank()) return false
        val clean = heardText.lowercase().replace(Regex("[^a-z0-9 ]"), " ").trim()
        val target = configuredPhrase.lowercase().replace(Regex("[^a-z0-9 ]"), " ").trim()

        // 1. Exact or substring match of configured phrase
        if (clean.contains(target)) return true

        // 2. Default recognized variants ("hey assistant", "ok assistant", "okay assistant")
        if (clean.contains("hey assistant") || clean.contains("ok assistant") || clean.contains("okay assistant")) {
            return true
        }

        // 3. Single-word token match if standalone "assistant"
        val tokens = clean.split("\\s+".toRegex())
        if (tokens.contains("assistant")) {
            return true
        }

        return false
    }

    private fun handleWakeWordDetected(transcript: String) {
        val now = System.currentTimeMillis()
        if (now - lastWakeTriggerTimestamp < 2000L) {
            // Debounce multiple detections of same utterance
            return
        }
        lastWakeTriggerTimestamp = now
        Log.i(TAG, "Wake word detected in background! transcript=\"$transcript\"")

        // 1. Trigger haptic feedback
        performHapticChime()

        // 2. Notify React Native module
        AssistantBackgroundModule.emitWakeWord(applicationContext, activeWakePhrase, transcript)

        // 3. Bring MainActivity to foreground
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                putExtra("WAKE_TRIGGERED", true)
                putExtra("WAKE_TRANSCRIPT", transcript)
            }
            if (launchIntent != null) {
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch activity from background service: ${e.message}")
        }

        // 4. Pause listening temporarily so speech recognition in foreground can take over
        stopListeningInternal()
        scheduleRestart(2500L)
    }

    private fun performHapticChime() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(
                        VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(150)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Haptic feedback unavailable: ${e.message}")
        }
    }

    private fun calculateRestartDebounce(baseDelay: Long): Long {
        // Battery Conservation (VAD): If quiet for >30 seconds, reduce duty cycle
        val quietDuration = System.currentTimeMillis() - lastActiveAudioTimestamp
        return if (quietDuration > 30_000L) {
            baseDelay + 500L // Drop duty cycle to preserve battery
        } else {
            baseDelay
        }
    }

    private fun scheduleRestart(delayMillis: Long) {
        mainHandler.removeCallbacks(restartRunnable)
        if (isRunning && !isPaused) {
            mainHandler.postDelayed(restartRunnable, delayMillis)
        }
    }

    private fun stopListeningInternal() {
        isListening = false
        mainHandler.removeCallbacks(restartRunnable)
        destroyRecognizerSafe()
    }

    private fun destroyRecognizerSafe() {
        try {
            speechRecognizer?.let {
                it.stopListening()
                it.cancel()
                it.destroy()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error destroying speech recognizer: ${e.message}")
        } finally {
            speechRecognizer = null
            isListening = false
        }
    }

    private fun stopForegroundInternal() {
        isRunning = false
        isListening = false
        stopListeningInternal()
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        Log.i(TAG, "AssistantForegroundService onDestroy()")
        stopForegroundInternal()
        super.onDestroy()
    }
}
