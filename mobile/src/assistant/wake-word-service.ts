import * as Haptics from "expo-haptics";
import { requireOptionalNativeModule } from "expo";
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { WakeSensitivity } from "@/preferences/app-preferences";

type NativeSpeechModule =
  typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;

/**
 * Safely resolves the native speech recognition module without crashing if the running
 * app binary lacks the native module (e.g. running in Expo Go or an older dev build APK).
 */
const NativeSpeechRecognition: NativeSpeechModule | null =
  Platform.OS !== "web"
    ? (requireOptionalNativeModule(
        "ExpoSpeechRecognition",
      ) as NativeSpeechModule | null)
    : null;

/**
 * Hook to listen to native speech recognition events safely.
 * Gracefully no-ops when the native module is not present in the current build.
 */
function useSafeSpeechRecognitionEvent(
  eventName: string,
  listener: (event: any) => void,
) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (
      !NativeSpeechRecognition ||
      typeof NativeSpeechRecognition.addListener !== "function"
    ) {
      return;
    }
    const callback = (event: any) => {
      listenerRef.current(event);
    };
    const subscription = NativeSpeechRecognition.addListener(
      eventName as any,
      callback,
    );
    return () => {
      subscription?.remove?.();
    };
  }, [eventName]);
}

export type WakeWordMatchResult = {
  matched: boolean;
  phraseMatched: string;
  trailingTranscript: string;
};

/**
 * Escapes regex special characters in user-provided wake phrase strings.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes speech text by lowercasing, stripping punctuation, and trimming extra whitespace.
 */
export function normalizeSpeechText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Robust wake-phrase matcher supporting configurable sensitivity levels.
 *
 * @param rawTranscript Current transcript from speech recognizer
 * @param wakePhrase The target activation phrase (e.g., "hey assistant")
 * @param sensitivity Sensitivity tier: "low" (strict whole phrase), "medium" (standard variations), "high" (flexible)
 */
export function matchWakePhrase(
  rawTranscript: string,
  wakePhrase: string = "hey assistant",
  sensitivity: WakeSensitivity = "medium",
): WakeWordMatchResult {
  const normalized = normalizeSpeechText(rawTranscript);
  const target = normalizeSpeechText(wakePhrase) || "hey assistant";

  if (!normalized) {
    return { matched: false, phraseMatched: "", trailingTranscript: "" };
  }

  // Build candidate activation phrases based on sensitivity
  const candidates: string[] = [target];

  if (sensitivity === "medium" || sensitivity === "high") {
    // Also accept "assistant" if target was "hey assistant"
    if (target.includes(" ")) {
      const parts = target.split(" ");
      const keyword = parts[parts.length - 1];
      if (keyword.length >= 4 && !candidates.includes(keyword)) {
        candidates.push(keyword);
      }
    }
    // Accept "ok assistant" / "okay assistant" as standard variations
    candidates.push(`ok ${target.replace(/^hey\s+/, "")}`);
    candidates.push(`okay ${target.replace(/^hey\s+/, "")}`);
  }

  if (sensitivity === "high") {
    // High sensitivity matches common speech recognition phonetics
    candidates.push("hi assistant");
    candidates.push("assistant");
  }

  for (const phrase of candidates) {
    const escaped = escapeRegExp(phrase);
    const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
    const match = normalized.match(regex);

    if (match && typeof match.index === "number") {
      // Find where the wake phrase ends in the normalized text
      const matchStart = match.index + (match[1] ? match[1].length : 0);
      const matchEnd = matchStart + phrase.length;
      const trailing = normalized.slice(matchEnd).trim();

      return {
        matched: true,
        phraseMatched: phrase,
        trailingTranscript: trailing,
      };
    }
  }

  return { matched: false, phraseMatched: "", trailingTranscript: "" };
}

/**
 * Detects whether an utterance is a conversation-closing phrase.
 */
export function isClosingPhrase(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return false;
  const closings = [
    "done",
    "that's all",
    "thats all",
    "that is all",
    "thank you",
    "thanks",
    "all good",
    "goodbye",
    "bye",
    "cancel",
    "stop",
    "close",
    "nothing else",
    "no that's all",
    "no thats all",
    "no that is all",
    "no thanks",
    "no thank you",
    "im done",
    "i'm done",
    "i am done",
    "we are done",
    "finished",
    "all set",
    "exit",
  ];
  return (
    closings.includes(normalized) ||
    closings.some(
      (c) =>
        normalized === c ||
        normalized.startsWith(c + " ") ||
        normalized.endsWith(" " + c),
    )
  );
}

/**
 * Checks whether an utterance consists strictly of the wake-phrase.
 */
export function isOnlyWakePhrase(
  rawTranscript: string,
  wakePhrase: string = "hey assistant",
): boolean {
  const normalized = normalizeSpeechText(rawTranscript);
  if (!normalized) return false;
  const target = normalizeSpeechText(wakePhrase) || "hey assistant";
  const variants = [
    target,
    "hey assistant",
    "assistant",
    "ok assistant",
    "okay assistant",
    "hi assistant",
    "hey",
    "hello assistant",
  ];
  return variants.includes(normalized);
}

/**
 * Strips leading wake words (e.g. "hey assistant gym at 7am" -> "gym at 7am").
 */
export function stripLeadingWakePhrase(
  rawTranscript: string,
  wakePhrase: string = "hey assistant",
): string {
  const normalized = normalizeSpeechText(rawTranscript);
  if (!normalized) return "";
  const target = normalizeSpeechText(wakePhrase) || "hey assistant";
  const variants = [
    target,
    "hey assistant",
    "ok assistant",
    "okay assistant",
    "hi assistant",
    "hello assistant",
    "assistant",
  ];

  for (const variant of variants) {
    if (normalized === variant) {
      return "";
    }
    if (normalized.startsWith(variant + " ")) {
      return normalized.slice(variant.length).trim();
    }
  }
  return normalized;
}

/**
 * Checks whether microphone and speech recognition permissions are granted.
 */
export async function checkWakeWordPermissions(): Promise<boolean> {
  if (Platform.OS === "web" || !NativeSpeechRecognition) return false;
  try {
    const status = await NativeSpeechRecognition.getPermissionsAsync();
    return Boolean(status.granted);
  } catch (err) {
    console.warn("[WakeWord] checkPermissions failed:", err);
    return false;
  }
}

/**
 * Requests speech recognition and microphone permissions from the operating system.
 */
export async function requestWakeWordPermissions(): Promise<boolean> {
  if (Platform.OS === "web" || !NativeSpeechRecognition) return false;
  try {
    const res = await NativeSpeechRecognition.requestPermissionsAsync();
    return Boolean(res.granted);
  } catch (err) {
    console.warn("[WakeWord] requestPermissions failed:", err);
    return false;
  }
}

export type UseWakeWordOptions = {
  /** Master switch to keep wake-word listening active */
  enabled: boolean;
  /** Activation keyword (default: "hey assistant") */
  wakePhrase?: string;
  /** Detection sensitivity */
  sensitivity?: WakeSensitivity;
  /** Whether the user is currently speaking/editing in another sheet (pauses background wake loop) */
  paused?: boolean;
  /** Mode: "wake" scans for wake-phrase; "conversation" streams continuous speech for multi-turn session */
  mode?: "wake" | "conversation";
  /** Callback fired when wake phrase is detected (in "wake" mode) */
  onWake?: (result: { phrase: string; trailingTranscript: string }) => void;
  /** Callback fired when wake phrase is detected during active conversation / follow-up mode */
  onFollowUpWake?: (phrase: string) => void;
  /** Callback fired as live speech words stream in */
  onTranscript?: (transcript: string) => void;
  /** Callback fired when speech pauses and utterance is ready to process (in "conversation" mode) */
  onUtteranceComplete?: (transcript: string) => void;
  /** Optional callback for logging or UI errors */
  onError?: (error: Error) => void;
};

export type WakeWordState = {
  isListening: boolean;
  isSupported: boolean;
  isNativeAvailable: boolean;
  hasPermission: boolean | null;
  lastTranscript: string;
  wakeCount: number;
  clearTranscript: () => void;
  requestPermission: () => Promise<boolean>;
  restart: () => void;
};

/**
 * Custom React hook managing hands-free wake word listening via on-device speech recognition.
 */
export function useWakeWord({
  enabled,
  wakePhrase = "hey assistant",
  sensitivity = "medium",
  paused = false,
  mode = "wake",
  onWake,
  onFollowUpWake,
  onTranscript,
  onUtteranceComplete,
  onError,
}: UseWakeWordOptions): WakeWordState {
  const isNativeAvailable = Boolean(NativeSpeechRecognition);
  const isSupported = Platform.OS !== "web" && isNativeAvailable;

  const [isListening, setIsListening] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [wakeCount, setWakeCount] = useState(0);

  const lastTranscriptRef = useRef<string>("");
  // Prevent multiple wake triggers within cooldown window (e.g., 2.5 seconds)
  const lastWakeTimeRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef<boolean>(enabled && !paused);
  enabledRef.current = enabled && !paused;

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const onFollowUpWakeRef = useRef(onFollowUpWake);
  onFollowUpWakeRef.current = onFollowUpWake;

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const onUtteranceCompleteRef = useRef(onUtteranceComplete);
  onUtteranceCompleteRef.current = onUtteranceComplete;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const wakePhraseRef = useRef(wakePhrase);
  wakePhraseRef.current = wakePhrase;

  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setLastTranscript("");
    lastTranscriptRef.current = "";
    if (silenceDebounceRef.current) {
      clearTimeout(silenceDebounceRef.current);
      silenceDebounceRef.current = null;
    }
  }, []);

  const safeStart = useCallback(async () => {
    if (
      !NativeSpeechRecognition ||
      !isSupported ||
      !enabledRef.current ||
      isStartingRef.current
    ) {
      return;
    }

    try {
      const state = await NativeSpeechRecognition.getStateAsync().catch(
        () => "inactive",
      );
      if (state !== "inactive") {
        // Already active or starting - ensure listening state remains true
        setIsListening(true);
        isStartingRef.current = false;
        return;
      }

      isStartingRef.current = true;
      clearRestartTimer();

      const phrase = wakePhraseRef.current || "hey assistant";

      NativeSpeechRecognition.start({
        lang: "en-US",
        interimResults: true,
        // On iOS, continuous: true works natively via Apple Speech Framework.
        // On Android, continuous: true forces EXTRA_AUDIO_SOURCE pipe which fails on non-Pixel devices.
        // Omitting continuous on Android binds directly to the physical microphone hardware.
        continuous: Platform.OS === "ios",
        addsPunctuation: false,
        contextualStrings: [phrase, "hey assistant", "assistant"],
      });
    } catch (err) {
      isStartingRef.current = false;
      console.warn("[WakeWord] safeStart error:", err);
      // Retry after backoff if still enabled
      if (enabledRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          void safeStart();
        }, 1500);
      }
    }
  }, [clearRestartTimer, isSupported]);

  const safeStop = useCallback(() => {
    clearRestartTimer();
    isStartingRef.current = false;
    try {
      NativeSpeechRecognition?.abort();
    } catch {
      // Ignore if already stopped
    }
    setIsListening(false);
  }, [clearRestartTimer]);

  const safeStartRef = useRef(safeStart);
  safeStartRef.current = safeStart;

  const safeStopRef = useRef(safeStop);
  safeStopRef.current = safeStop;

  // Request permission helper
  const handleRequestPermission = useCallback(async () => {
    const granted = await requestWakeWordPermissions();
    setHasPermission(granted);
    if (granted && enabledRef.current) {
      void safeStartRef.current();
    }
    return granted;
  }, []);

  // Handle start event
  useSafeSpeechRecognitionEvent("start", () => {
    isStartingRef.current = false;
    setIsListening(true);
  });

  // Handle end event (restart if continuous listening is desired)
  useSafeSpeechRecognitionEvent("end", () => {
    isStartingRef.current = false;

    // In conversation mode, if the user finished speaking and recognizer ended,
    // only commit if the text contains actual instructions beyond the wake word.
    if (modeRef.current === "conversation" && silenceDebounceRef.current) {
      clearTimeout(silenceDebounceRef.current);
      silenceDebounceRef.current = null;
      const finalRaw = lastTranscriptRef.current.trim();
      if (
        finalRaw.length > 0 &&
        !isOnlyWakePhrase(finalRaw, wakePhraseRef.current)
      ) {
        const cleanUtterance = stripLeadingWakePhrase(
          finalRaw,
          wakePhraseRef.current,
        );
        if (cleanUtterance.length > 0) {
          onUtteranceCompleteRef.current?.(cleanUtterance);
        }
      }
    }

    if (enabledRef.current) {
      clearRestartTimer();
      // Seamless restart so microphone starts listening again immediately
      restartTimerRef.current = setTimeout(() => {
        if (enabledRef.current) {
          void safeStartRef.current();
        } else {
          setIsListening(false);
        }
      }, 150);
    } else {
      setIsListening(false);
    }
  });

  // Handle live recognition results
  useSafeSpeechRecognitionEvent(
    "result",
    (event: ExpoSpeechRecognitionResultEvent) => {
      const candidates = event?.results || [];
      if (candidates.length === 0) return;

      const firstText = candidates[0]?.transcript || "";
      if (firstText) {
        setLastTranscript(firstText);
        lastTranscriptRef.current = firstText;
      }

      // If we are in active conversation mode, stream transcript directly to UI
      // and debounce silence to commit utterance hands-free.
      if (modeRef.current === "conversation") {
        if (firstText) {
          const trimmed = firstText.trim();

          // Check if any candidate matches the wake phrase (e.g. "hey assistant", "assistant", etc.)
          let wakeMatch: ReturnType<typeof matchWakePhrase> | null = null;
          for (const res of candidates) {
            const text = res?.transcript;
            if (!text) continue;
            const test = matchWakePhrase(
              text,
              wakePhraseRef.current,
              sensitivityRef.current,
            );
            if (test.matched) {
              wakeMatch = test;
              break;
            }
          }

          // Case A: User spoke ONLY the wake phrase (e.g. "Hey Assistant" during follow-up):
          // Acknowledge the wake-word, give haptics, notify UI immediately, and keep listening for instruction!
          const isWakeOnly =
            isOnlyWakePhrase(trimmed, wakePhraseRef.current) ||
            (wakeMatch && !wakeMatch.trailingTranscript);

          if (isWakeOnly) {
            if (silenceDebounceRef.current) {
              clearTimeout(silenceDebounceRef.current);
              silenceDebounceRef.current = null;
            }
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
              () => {},
            );
            onTranscriptRef.current?.("");
            onFollowUpWakeRef.current?.(wakeMatch?.phraseMatched || trimmed);
            return;
          }

          // Case B: User spoke the wake phrase AND instruction together: "Hey Assistant gym at 7am"
          if (wakeMatch && wakeMatch.trailingTranscript) {
            onFollowUpWakeRef.current?.(wakeMatch.phraseMatched);
          }

          // Strip any leading wake phrase (e.g. "hey assistant gym at 7am" -> "gym at 7am")
          const cleanUtterance = stripLeadingWakePhrase(
            trimmed,
            wakePhraseRef.current,
          );
          if (!cleanUtterance) {
            return;
          }

          onTranscriptRef.current?.(cleanUtterance);

          if (silenceDebounceRef.current) {
            clearTimeout(silenceDebounceRef.current);
            silenceDebounceRef.current = null;
          }

          // Allow a comfortable pause (2000ms regular, 1600ms on final) so the user
          // has ample time to speak their full sentence without being rushed.
          const isFinal = Boolean((event as any)?.isFinal);
          const debounceMs = isFinal ? 1600 : 2000;
          silenceDebounceRef.current = setTimeout(() => {
            silenceDebounceRef.current = null;
            onUtteranceCompleteRef.current?.(cleanUtterance);
          }, debounceMs);
        }
        return;
      }

      // If in wake-word detection mode:
      // Check all alternative candidates from the recognizer
      let bestMatch: ReturnType<typeof matchWakePhrase> | null = null;
      for (const res of candidates) {
        const text = res?.transcript;
        if (!text) continue;
        const testMatch = matchWakePhrase(
          text,
          wakePhraseRef.current,
          sensitivityRef.current,
        );
        if (testMatch.matched) {
          bestMatch = testMatch;
          break;
        }
      }

      if (bestMatch && bestMatch.matched) {
        const now = Date.now();
        // Cooldown of 2.5 seconds to avoid repeated triggers
        if (now - lastWakeTimeRef.current > 2500) {
          lastWakeTimeRef.current = now;
          setWakeCount((c) => c + 1);

          // Trigger medium haptic pulse to confirm detection
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
            () => {},
          );

          onWakeRef.current?.({
            phrase: bestMatch.phraseMatched,
            trailingTranscript: bestMatch.trailingTranscript,
          });
        }
      }
    },
  );

  // Handle recognition errors gracefully
  useSafeSpeechRecognitionEvent(
    "error",
    (event: ExpoSpeechRecognitionErrorEvent) => {
      isStartingRef.current = false;

      // Transient events that occur normally during continuous listening
      const isTransient =
        event?.error === "no-speech" ||
        event?.error === "speech-timeout" ||
        event?.error === "busy" ||
        event?.error === "client" ||
        event?.error === "aborted";

      if (!isTransient) {
        setIsListening(false);
        if (onErrorRef.current) {
          onErrorRef.current(
            new Error(`[SpeechRecognition] ${event?.error}: ${event?.message}`),
          );
        }
      }

      if (enabledRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(
          () => {
            if (enabledRef.current) {
              void safeStartRef.current();
            } else {
              setIsListening(false);
            }
          },
          isTransient ? 400 : 2500,
        );
      } else {
        setIsListening(false);
      }
    },
  );

  // Main lifecycle effect
  useEffect(() => {
    if (!isSupported) return;

    let mounted = true;

    void (async () => {
      const granted = await checkWakeWordPermissions();
      if (!mounted) return;
      setHasPermission(granted);

      if (enabled && !paused) {
        if (granted) {
          void safeStartRef.current();
        }
      } else {
        safeStopRef.current();
      }
    })();

    return () => {
      mounted = false;
      safeStopRef.current();
    };
  }, [enabled, paused, isSupported]);

  const restart = useCallback(() => {
    safeStop();
    if (enabledRef.current) {
      setTimeout(() => {
        void safeStart();
      }, 300);
    }
  }, [safeStart, safeStop]);

  return {
    isListening,
    isSupported,
    isNativeAvailable,
    hasPermission,
    lastTranscript,
    wakeCount,
    clearTranscript,
    requestPermission: handleRequestPermission,
    restart,
  };
}
