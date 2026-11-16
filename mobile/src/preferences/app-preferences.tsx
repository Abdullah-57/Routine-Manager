import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "routine-manager.app-preferences.v1";

export type WakeSensitivity = "low" | "medium" | "high";

export type AppPreferences = {
  /** App-level gate for using the mic (still needs OS permission). */
  microphoneEnabled: boolean;
  /** App-level gate for push-related actions. */
  pushNotificationsEnabled: boolean;
  /** Prefer 24-hour clock in reminder time labels. */
  use24HourClock: boolean;
  /** Whether hands-free voice assistant listening is active. */
  assistantEnabled: boolean;
  /** Keyword/phrase that activates the assistant. */
  wakePhrase: string;
  /** Detection sensitivity for the wake word engine. */
  wakeSensitivity: WakeSensitivity;
  /** Whether the assistant reads its confirmation / reply aloud using native TTS. */
  spokenFeedbackEnabled: boolean;
};

const DEFAULTS: AppPreferences = {
  microphoneEnabled: true,
  pushNotificationsEnabled: true,
  use24HourClock: false,
  assistantEnabled: true,
  wakePhrase: "hey assistant",
  wakeSensitivity: "medium",
  spokenFeedbackEnabled: true,
};

type AppPreferencesContextValue = AppPreferences & {
  isReady: boolean;
  setMicrophoneEnabled: (value: boolean) => Promise<void>;
  setPushNotificationsEnabled: (value: boolean) => Promise<void>;
  setUse24HourClock: (value: boolean) => Promise<void>;
  setAssistantEnabled: (value: boolean) => Promise<void>;
  setWakePhrase: (value: string) => Promise<void>;
  setWakeSensitivity: (value: WakeSensitivity) => Promise<void>;
  setSpokenFeedbackEnabled: (value: boolean) => Promise<void>;
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(
  null,
);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULTS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw) as Partial<AppPreferences>;
          setPrefs({ ...DEFAULTS, ...parsed });
        }
      } catch {
        // Keep defaults if storage is unavailable.
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: AppPreferences) => {
    setPrefs(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preference still applies in-memory for this session.
    }
  }, []);

  const setMicrophoneEnabled = useCallback(
    async (value: boolean) => {
      await persist({ ...prefs, microphoneEnabled: value });
    },
    [persist, prefs],
  );

  const setPushNotificationsEnabled = useCallback(
    async (value: boolean) => {
      await persist({ ...prefs, pushNotificationsEnabled: value });
    },
    [persist, prefs],
  );

  const setUse24HourClock = useCallback(
    async (value: boolean) => {
      await persist({ ...prefs, use24HourClock: value });
    },
    [persist, prefs],
  );

  const setAssistantEnabled = useCallback(
    async (value: boolean) => {
      await persist({ ...prefs, assistantEnabled: value });
    },
    [persist, prefs],
  );

  const setWakePhrase = useCallback(
    async (value: string) => {
      await persist({ ...prefs, wakePhrase: value.trim().toLowerCase() || "hey assistant" });
    },
    [persist, prefs],
  );

  const setWakeSensitivity = useCallback(
    async (value: WakeSensitivity) => {
      await persist({ ...prefs, wakeSensitivity: value });
    },
    [persist, prefs],
  );

  const setSpokenFeedbackEnabled = useCallback(
    async (value: boolean) => {
      await persist({ ...prefs, spokenFeedbackEnabled: value });
    },
    [persist, prefs],
  );

  const value = useMemo(
    () => ({
      ...prefs,
      isReady,
      setMicrophoneEnabled,
      setPushNotificationsEnabled,
      setUse24HourClock,
      setAssistantEnabled,
      setWakePhrase,
      setWakeSensitivity,
      setSpokenFeedbackEnabled,
    }),
    [
      prefs,
      isReady,
      setMicrophoneEnabled,
      setPushNotificationsEnabled,
      setUse24HourClock,
      setAssistantEnabled,
      setWakePhrase,
      setWakeSensitivity,
      setSpokenFeedbackEnabled,
    ],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const ctx = useContext(AppPreferencesContext);
  if (!ctx) {
    throw new Error(
      "useAppPreferences must be used within AppPreferencesProvider",
    );
  }
  return ctx;
}
