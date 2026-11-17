import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import type { SpeechOptions } from "expo-speech";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { getBaseUrl } from "@/api/client";

type NativeSpeechModule = typeof import("expo-speech");

let ExpoSpeechModule: NativeSpeechModule | null = null;
const isNativeModulePresent =
  Platform.OS !== "web"
    ? Boolean(requireOptionalNativeModule("ExpoSpeech"))
    : false;

if (isNativeModulePresent) {
  try {
    ExpoSpeechModule = require("expo-speech");
  } catch (err) {
    console.warn("[SpeechService] Failed to load expo-speech:", err);
    ExpoSpeechModule = null;
  }
}

/**
 * Checks whether native Text-To-Speech is available in this binary.
 */
export function isTtsAvailable(): boolean {
  return Boolean(ExpoSpeechModule && typeof ExpoSpeechModule.speak === "function");
}

/**
 * Proactively initializes the native Text-To-Speech engine in the background
 * to eliminate cold-start latency when speech is requested.
 */
export function warmupSpeech(): void {
  if (isTtsAvailable() && ExpoSpeechModule) {
    try {
      void ExpoSpeechModule.isSpeakingAsync().catch(() => {});
    } catch {
      // ignore
    }
  }
}

export type SpeakTextOptions = {
  rate?: number;
  pitch?: number;
  language?: string;
  token?: string | null;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

let activeAudioPlayer: AudioPlayer | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let finalWordTimer: ReturnType<typeof setTimeout> | null = null;
let audioFlushTimer: ReturnType<typeof setTimeout> | null = null;
let activePollInterval: ReturnType<typeof setInterval> | null = null;
let activeStartFailsafeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Accurately estimates speech duration in milliseconds based on word count,
 * time formats (e.g. "7:00 PM"), and natural punctuation pauses.
 */
export function estimateSpeechDurationMs(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  // Replace links with short token so URLs don't skew word counts
  const words = clean.replace(/https?:\/\/\S+/g, "link").split(/\s+/).filter(Boolean);
  let spokenCount = words.length;
  // Times like "7:00" or "12:30" add extra spoken syllables
  const times = clean.match(/\b\d{1,2}:\d{2}\b/g);
  if (times) spokenCount += times.length * 2;
  // Punctuation introduces brief breathing pauses
  const punctuation = (clean.match(/[,;:.!?]/g) || []).length;
  const durationMs = spokenCount * 330 + punctuation * 160 + 500;
  return Math.max(1600, Math.min(16000, durationMs));
}

/**
 * Speaks text out loud using:
 * 1) 100% free native operating system TTS engine (expo-speech) if compiled in the APK.
 * 2) Zero-setup streaming audio fallback (expo-audio) via backend TTS if expo-speech
 *    native code is not yet compiled into the current development build APK.
 */
export async function speakText(
  text: string,
  options: SpeakTextOptions = {},
): Promise<void> {
  const clean = text.trim();
  if (!clean) {
    options.onDone?.();
    return;
  }

  // Stop any active playback first
  await stopSpeaking();

  let finished = false;
  let hasStarted = false;
  let speechStartTime = 0;

  const estimatedDurationMs = estimateSpeechDurationMs(clean);
  // Ensure polling NEVER fires before at least 70% of the speech duration has elapsed
  const minRequiredDurationMs = Math.max(1400, Math.round(estimatedDurationMs * 0.70));

  const notifyStart = () => {
    if (finished || hasStarted) return;
    hasStarted = true;
    speechStartTime = Date.now();

    if (activeStartFailsafeTimer) {
      clearTimeout(activeStartFailsafeTimer);
      activeStartFailsafeTimer = null;
    }

    // Safety fallback timer: starts counting STRICTLY from when audio actually begins playing
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
    }
    fallbackTimer = setTimeout(() => {
      cleanupAndDone(false);
    }, Math.max(5000, estimatedDurationMs + 2500));

    options.onStart?.();
  };

  const cleanupAndDone = (wasStopped = false) => {
    if (finished) return;
    finished = true;

    if (activeStartFailsafeTimer) {
      clearTimeout(activeStartFailsafeTimer);
      activeStartFailsafeTimer = null;
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (finalWordTimer) {
      clearTimeout(finalWordTimer);
      finalWordTimer = null;
    }
    if (audioFlushTimer) {
      clearTimeout(audioFlushTimer);
      audioFlushTimer = null;
    }
    if (activePollInterval) {
      clearInterval(activePollInterval);
      activePollInterval = null;
    }

    if (ExpoSpeechModule) {
      try {
        ExpoSpeechModule.stop();
      } catch {
        // ignore
      }
    }

    if (activeAudioPlayer) {
      try {
        activeAudioPlayer.pause();
        activeAudioPlayer.remove();
      } catch {
        // ignore
      }
      activeAudioPlayer = null;
    }

    if (wasStopped) {
      options.onStopped?.();
    } else {
      options.onDone?.();
    }
  };

  // 1. Primary: 100% free offline native TTS engine (AVSpeechSynthesizer / Android TextToSpeech)
  if (isTtsAvailable() && ExpoSpeechModule) {
    try {
      let consecutiveFalseCount = 0;

      const speechOpts: SpeechOptions = {
        rate: options.rate ?? (Platform.OS === "ios" ? 0.95 : 1.0),
        pitch: options.pitch ?? 1.0,
        language: options.language ?? "en-US",
        onStart: () => {
          notifyStart();
        },
        onDone: () => {
          cleanupAndDone(false);
        },
        onStopped: () => {
          cleanupAndDone(true);
        },
        onError: (err) => {
          console.warn("[SpeechService] Native speech error:", err);
          cleanupAndDone(false);
        },
      };

      // Failsafe: if the device's native TTS engine doesn't emit onStart (rare on custom ROMs),
      // trigger notifyStart after 900ms so UI and timers proceed smoothly
      activeStartFailsafeTimer = setTimeout(() => {
        notifyStart();
      }, 900);

      ExpoSpeechModule.speak(clean, speechOpts);

      // Reliable polling: checks every 80ms strictly AFTER speech has actually started
      // and min threshold has elapsed. Requires 4 consecutive false checks (320ms sustained silence)
      // so natural pauses between words or sentences are never cut off.
      activePollInterval = setInterval(async () => {
        if (finished) {
          if (activePollInterval) {
            clearInterval(activePollInterval);
            activePollInterval = null;
          }
          return;
        }

        // Never evaluate completion before speech has actually started
        if (!hasStarted || speechStartTime === 0) {
          return;
        }

        const elapsed = Date.now() - speechStartTime;
        if (elapsed < minRequiredDurationMs) {
          return;
        }

        if (ExpoSpeechModule) {
          try {
            const speaking = await ExpoSpeechModule.isSpeakingAsync();
            if (!speaking) {
              consecutiveFalseCount++;
              if (consecutiveFalseCount >= 4) {
                cleanupAndDone(false);
              }
            } else {
              consecutiveFalseCount = 0;
            }
          } catch {
            // ignore
          }
        }
      }, 80);

      return;
    } catch (err) {
      console.warn(
        "[SpeechService] Native speech call failed, trying audio fallback:",
        err,
      );
      if (activePollInterval) {
        clearInterval(activePollInterval);
        activePollInterval = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (finalWordTimer) {
        clearTimeout(finalWordTimer);
        finalWordTimer = null;
      }
      if (audioFlushTimer) {
        clearTimeout(audioFlushTimer);
        audioFlushTimer = null;
      }
    }
  }

  // 2. Fallback: Backend TTS endpoint played via expo-audio (already present in the current dev APK)
  try {
    const baseUrl = getBaseUrl();
    const tokenParam = options.token
      ? `&token=${encodeURIComponent(options.token)}`
      : "";
    const ttsUrl = `${baseUrl}/routines/tts?text=${encodeURIComponent(clean)}${tokenParam}`;

    const player = createAudioPlayer(ttsUrl, { downloadFirst: true });
    activeAudioPlayer = player;
    let hasStartedPlaying = false;
    let scheduledAudioEnd = false;

    player.addListener("playbackStatusUpdate", (status) => {
      if (status.playing) {
        hasStartedPlaying = true;
        notifyStart();
      }

      if (status.duration && status.duration > 0 && !scheduledAudioEnd) {
        scheduledAudioEnd = true;
        const remainingMs = Math.max(
          100,
          Math.round(
            (status.duration - (status.currentTime || 0)) * 1000,
          ) + 60,
        );
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
        }
        fallbackTimer = setTimeout(() => {
          cleanupAndDone(false);
        }, remainingMs);
      }

      // Check if finished via didJustFinish, playbackState "ended", or stopped playing
      const isEnded =
        status.didJustFinish ||
        status.playbackState === "ended" ||
        (hasStartedPlaying && !status.playing) ||
        (status.duration > 0 &&
          status.currentTime >= status.duration - 0.2);

      if (isEnded) {
        cleanupAndDone(false);
      }
    });

    // Failsafe for network audio in case playback status is delayed
    activeStartFailsafeTimer = setTimeout(() => {
      notifyStart();
    }, 4000);

    player.play();

    // Responsive 60ms polling on player position, playing flag, and playbackState
    activePollInterval = setInterval(() => {
      if (finished || !activeAudioPlayer) {
        if (activePollInterval) {
          clearInterval(activePollInterval);
          activePollInterval = null;
        }
        return;
      }
      try {
        const cur = activeAudioPlayer.currentTime;
        const dur = activeAudioPlayer.duration;
        const isPlaying = activeAudioPlayer.playing;
        const status = activeAudioPlayer.currentStatus;

        if (isPlaying) {
          hasStartedPlaying = true;
        }

        if (
          status?.didJustFinish ||
          status?.playbackState === "ended" ||
          (hasStartedPlaying && !isPlaying) ||
          (dur > 0 && cur >= dur - 0.2)
        ) {
          cleanupAndDone(false);
        }
      } catch {
        // ignore
      }
    }, 60);

    return;
  } catch (err) {
    console.warn("[SpeechService] Audio player fallback failed:", err);
  }

  // 3. Visual duration fallback: Ensure equalizer soundwave animates even if all audio output fails
  notifyStart();
  fallbackTimer = setTimeout(() => {
    cleanupAndDone(false);
  }, estimatedDurationMs);
}

/**
 * Interrupts current speech immediately.
 */
export async function stopSpeaking(): Promise<void> {
  if (activeStartFailsafeTimer) {
    clearTimeout(activeStartFailsafeTimer);
    activeStartFailsafeTimer = null;
  }

  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  if (finalWordTimer) {
    clearTimeout(finalWordTimer);
    finalWordTimer = null;
  }

  if (audioFlushTimer) {
    clearTimeout(audioFlushTimer);
    audioFlushTimer = null;
  }

  if (activePollInterval) {
    clearInterval(activePollInterval);
    activePollInterval = null;
  }

  if (activeAudioPlayer) {
    try {
      activeAudioPlayer.pause();
      activeAudioPlayer.remove();
    } catch {
      // Ignore if already disposed
    }
    activeAudioPlayer = null;
  }

  if (isTtsAvailable() && ExpoSpeechModule) {
    try {
      await ExpoSpeechModule.stop();
    } catch {
      // Ignore if not speaking
    }
  }
}

/**
 * Checks whether the synthesizer or audio player is currently speaking aloud.
 */
export async function isSpeaking(): Promise<boolean> {
  if (activeAudioPlayer?.playing) return true;
  if (!isTtsAvailable() || !ExpoSpeechModule) return false;
  try {
    return await ExpoSpeechModule.isSpeakingAsync();
  } catch {
    return false;
  }
}
