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

/**
 * Accurately estimates speech duration in milliseconds based on word count,
 * time formats (e.g. "7:00 PM"), and natural punctuation pauses.
 */
export function estimateSpeechDurationMs(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const words = clean.split(/\s+/).filter(Boolean);
  let spokenCount = words.length;
  // Times like "7:00" or "12:30" are spoken as multiple words ("seven o'clock" / "twelve thirty")
  const times = clean.match(/\b\d{1,2}:\d{2}\b/g);
  if (times) spokenCount += times.length * 2;
  // Punctuation introduces natural breathing pauses
  const punctuation = (clean.match(/[,;:.!?]/g) || []).length;
  const durationMs = spokenCount * 380 + punctuation * 180 + 350;
  return Math.max(1600, Math.min(15000, durationMs));
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

  const cleanupAndDone = (wasStopped = false) => {
    if (finished) return;
    finished = true;

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

  const startTime = Date.now();
  const estimatedDurationMs = estimateSpeechDurationMs(clean);
  const wordsCount = clean.split(/\s+/).filter(Boolean).length;
  // Guaranteed minimum duration: speech cannot legitimately finish faster than ~240ms/word
  const minRequiredDurationMs = Math.max(1200, wordsCount * 240);

  // 1. Primary: 100% free offline native TTS engine (AVSpeechSynthesizer / Android TextToSpeech)
  if (isTtsAvailable() && ExpoSpeechModule) {
    try {
      let consecutiveFalseCount = 0;

      const speechOpts: SpeechOptions = {
        rate: options.rate ?? (Platform.OS === "ios" ? 0.95 : 1.0),
        pitch: options.pitch ?? 1.0,
        language: options.language ?? "en-US",
        onStart: () => {
          options.onStart?.();
        },
        onBoundary: (event: any) => {
          const charIndex =
            typeof event?.charIndex === "number" ? event.charIndex : 0;
          const charLength =
            typeof event?.charLength === "number" ? event.charLength : 0;
          const remainingText = clean.slice(charIndex + charLength).trim();
          const remainingWords = remainingText
            ? remainingText.split(/\s+/).filter(Boolean).length
            : 0;

          // When the native engine reaches the final word:
          // Give 1200ms for the full pronunciation of the final word/time.
          // This ensures that if Android drops onDone, completion still fires cleanly without hanging.
          if (remainingWords === 0) {
            if (finalWordTimer) {
              clearTimeout(finalWordTimer);
            }
            finalWordTimer = setTimeout(() => {
              cleanupAndDone(false);
            }, 1200);
          }
        },
        onDone: () => {
          if (finalWordTimer) {
            clearTimeout(finalWordTimer);
            finalWordTimer = null;
          }
          // Buffer 160ms so Android's AudioTrack finishes physical speaker playback before mic unpauses
          if (audioFlushTimer) {
            clearTimeout(audioFlushTimer);
          }
          audioFlushTimer = setTimeout(() => {
            cleanupAndDone(false);
          }, 160);
        },
        onStopped: () => {
          cleanupAndDone(true);
        },
        onError: (err) => {
          console.warn("[SpeechService] Native speech error:", err);
          cleanupAndDone(false);
        },
      };

      options.onStart?.();
      ExpoSpeechModule.speak(clean, speechOpts);

      // Safe, state-gated polling:
      // Never checks until minRequiredDurationMs has elapsed, and requires 2 consecutive false
      // checks (300ms apart) to prevent mid-speech pause false-positives.
      activePollInterval = setInterval(async () => {
        if (finished) {
          if (activePollInterval) {
            clearInterval(activePollInterval);
            activePollInterval = null;
          }
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < minRequiredDurationMs) {
          return;
        }

        if (ExpoSpeechModule) {
          try {
            const speaking = await ExpoSpeechModule.isSpeakingAsync();
            if (!speaking) {
              consecutiveFalseCount++;
              if (consecutiveFalseCount >= 2) {
                // Speech is fully complete
                if (audioFlushTimer) {
                  clearTimeout(audioFlushTimer);
                }
                audioFlushTimer = setTimeout(() => {
                  cleanupAndDone(false);
                }, 100);
              }
            } else {
              consecutiveFalseCount = 0;
            }
          } catch {
            // ignore
          }
        }
      }, 150);

      // Absolute safety timeout: generous upper bound to prevent hanging indefinitely
      fallbackTimer = setTimeout(() => {
        cleanupAndDone(false);
      }, Math.max(6500, estimatedDurationMs * 1.5 + 2500));

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
    let scheduledAudioEnd = false;

    player.addListener("playbackStatusUpdate", (status) => {
      if (status.playing) {
        options.onStart?.();
      }

      if (status.duration && status.duration > 0 && !scheduledAudioEnd) {
        scheduledAudioEnd = true;
        const remainingMs = Math.max(
          100,
          Math.round(
            (status.duration - (status.currentTime || 0)) * 1000,
          ) + 80,
        );
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
        }
        fallbackTimer = setTimeout(() => {
          cleanupAndDone(false);
        }, remainingMs);
      }

      // Check if finished via didJustFinish or playbackState "ended"
      const isEnded =
        status.didJustFinish ||
        status.playbackState === "ended" ||
        (status.duration > 0 &&
          status.currentTime >= status.duration - 0.08);

      if (isEnded) {
        cleanupAndDone(false);
      }
    });

    options.onStart?.();
    player.play();

    // Polling on player.currentTime and player.duration for instant completion
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
        if (dur > 0 && cur >= dur - 0.08) {
          cleanupAndDone(false);
        }
      } catch {
        // ignore
      }
    }, 100);

    fallbackTimer = setTimeout(() => {
      cleanupAndDone(false);
    }, Math.max(6500, estimatedDurationMs * 1.5 + 2500));
    return;
  } catch (err) {
    console.warn("[SpeechService] Audio player fallback failed:", err);
  }

  // 3. Visual duration fallback: Ensure equalizer soundwave animates even if all audio output fails
  options.onStart?.();
  fallbackTimer = setTimeout(() => {
    cleanupAndDone(false);
  }, estimatedDurationMs);
}

/**
 * Interrupts current speech immediately.
 */
export async function stopSpeaking(): Promise<void> {
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
