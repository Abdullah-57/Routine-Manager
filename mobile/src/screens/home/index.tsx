import { AudioModule } from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiFetch, pingHealth } from "@/api/client";
import { sendTestPush } from "@/api/notifications";
import {
  listReminders,
  parseRoutine,
  transcribeRoutineAudio,
  type ReminderSummary,
} from "@/api/routines";
import { useAuth } from "@/auth/AuthContext";
import { AiPlanComposer } from "@/components/ai-plan-composer";
import { AssistantResponseCard } from "@/components/assistant-response-card";
import { HomeSidebar } from "@/components/home-sidebar";
import { StatusBadge } from "@/components/status-badge";
import { AppButton } from "@/components/ui/app-button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { VoiceRecordSheet } from "@/components/voice-record-sheet";
import { FloatingAssistantBubble } from "@/components/floating-assistant-bubble";
import {
  cancelReminderLocalNotification,
  requestNotificationPermission,
  rescheduleReminderLocalNotification,
  scheduleReminderLocalNotification,
  syncLocalNotificationsForReminders,
} from "@/notifications/local-reminders";
import { useAppPreferences } from "@/preferences/app-preferences";
import * as Haptics from "expo-haptics";
import {
  AssistantOverlay,
  type AssistantPhase,
} from "@/components/assistant-overlay";
import {
  estimateSpeechDurationMs,
  speakText,
  stopSpeaking,
  warmupSpeech,
} from "@/assistant/speech-service";
import {
  isClosingPhrase,
  isOnlyWakePhrase,
  stripLeadingWakePhrase,
  useWakeWord,
} from "@/assistant/wake-word-service";
import { radius, shadows, spacing } from "@/theme";

type PingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type TestPushState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const RECENT_PREVIEW_COUNT = 5;

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatReminderTime(
  iso: string,
  timezone: string,
  use24HourClock: boolean,
) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: !use24HourClock,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: !use24HourClock,
    }).format(new Date(iso));
  }
}

function sortNewestFirst(items: ReminderSummary[]) {
  return [...items].sort((a, b) => {
    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return new Date(b.startAt).getTime() - new Date(a.startAt).getTime();
  });
}

function welcomeName(user: {
  displayName?: string;
  email?: string;
} | null) {
  const display = user?.displayName?.trim();
  if (display) return display;
  const email = user?.email?.trim();
  if (email) return email.split("@")[0] || email;
  return "there";
}

function avatarLetter(user: {
  displayName?: string;
  email?: string;
} | null) {
  const name = welcomeName(user);
  return name.charAt(0).toUpperCase() || "R";
}

function ReminderRow({
  id,
  title,
  timeLabel,
  status,
  kind,
  meetLink,
  isNew,
  onPress,
}: {
  id?: string;
  title: string;
  timeLabel: string;
  status: string;
  kind?: string;
  meetLink?: string | null;
  isNew?: boolean;
  onPress?: () => void;
}) {
  const isMeeting = kind === "meeting" || Boolean(meetLink);
  const isCall = kind === "call";

  const content = (
    <View style={[styles.reminderRow, isNew ? styles.reminderRowNew : null]}>
      <View style={styles.reminderHeader}>
        <View style={styles.reminderTitleRow}>
          {isMeeting ? <Text style={styles.kindIcon}>🎥</Text> : null}
          {isCall ? <Text style={styles.kindIcon}>📞</Text> : null}
          <Text style={styles.reminderTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.badgeGroup}>
          {isMeeting ? (
            <View style={styles.meetPill}>
              <Text style={styles.meetPillText}>Meet</Text>
            </View>
          ) : null}
          {isNew ? <Text style={styles.newBadge}>New</Text> : null}
        </View>
      </View>
      <View style={styles.reminderMetaRow}>
        <StatusBadge status={status} />
        <Text style={styles.reminderTime}>{timeLabel}</Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View details for ${title}`}
        onPress={onPress}
        style={({ pressed }) => [pressed ? styles.pressed : null]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

export function HomeScreen() {
  const router = useRouter();
  const { user, token, logout } = useAuth();
  const prefs = useAppPreferences();
  const insets = useSafeAreaInsets();

  const [planText, setPlanText] = useState("");
  const [plan, setPlan] = useState<PlanState>({ status: "idle" });
  const [allReminders, setAllReminders] = useState<ReminderSummary[]>([]);
  const [justCreatedIds, setJustCreatedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showAllReminders, setShowAllReminders] = useState(false);
  const [isLoadingReminders, setIsLoadingReminders] = useState(false);
  const [remindersError, setRemindersError] = useState<string | null>(null);
  const [ping, setPing] = useState<PingState>({ status: "idle" });
  const [testPush, setTestPush] = useState<TestPushState>({ status: "idle" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isVoiceBusy, setIsVoiceBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [wakeFeedback, setWakeFeedback] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Feature 1.2: Post-Wake Conversation Session & Spoken Confirmation State
  const [assistantOverlayOpen, setAssistantOverlayOpen] = useState(false);
  const [assistantPhase, setAssistantPhase] =
    useState<AssistantPhase>("listening");
  const [assistantLiveTranscript, setAssistantLiveTranscript] = useState("");
  const [assistantSpokenMessage, setAssistantSpokenMessage] = useState("");
  const [assistantCreatedReminders, setAssistantCreatedReminders] = useState<
    ReminderSummary[]
  >([]);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);

  const assistantIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const assistantOverlayOpenRef = useRef(assistantOverlayOpen);
  assistantOverlayOpenRef.current = assistantOverlayOpen;
  const assistantPhaseRef = useRef(assistantPhase);
  assistantPhaseRef.current = assistantPhase;
  const isTtsSpeakingRef = useRef(isTtsSpeaking);
  isTtsSpeakingRef.current = isTtsSpeaking;
  const assistantSessionIdRef = useRef<string | null>(null);

  const [followUpWakeDetected, setFollowUpWakeDetected] = useState(false);

  const clearAssistantIdleTimer = useCallback(() => {
    if (assistantIdleTimerRef.current) {
      clearTimeout(assistantIdleTimerRef.current);
      assistantIdleTimerRef.current = null;
    }
  }, []);

  const handleCloseAssistant = useCallback(() => {
    clearAssistantIdleTimer();
    void stopSpeaking();
    setIsTtsSpeaking(false);
    setFollowUpWakeDetected(false);
    setAssistantOverlayOpen(false);
    setAssistantPhase("listening");
    setAssistantLiveTranscript("");
    assistantSessionIdRef.current = null;
    wakeWordRef.current?.clearTranscript();
  }, [clearAssistantIdleTimer]);

  const startAssistantIdleTimer = useCallback(() => {
    clearAssistantIdleTimer();
    // 15 seconds idle timeout hands-free auto-close
    assistantIdleTimerRef.current = setTimeout(() => {
      handleCloseAssistant();
    }, 15000);
  }, [clearAssistantIdleTimer, handleCloseAssistant]);

  const timezone = useMemo(() => {
    const devTz = getDeviceTimezone();
    if (devTz && devTz !== "UTC") return devTz;
    if (user?.timezone && user.timezone !== "UTC") return user.timezone;
    return devTz || "UTC";
  }, [user?.timezone]);

  // Keep user profile timezone updated with actual device timezone
  useEffect(() => {
    if (
      token &&
      user &&
      timezone &&
      timezone !== "UTC" &&
      user.timezone !== timezone
    ) {
      apiFetch("/auth/me", {
        method: "PATCH",
        token,
        body: { timezone },
      }).catch(() => {});
    }
  }, [token, user, timezone]);

  // Proactively warm up native speech engine on app load so assistant speech starts with zero delay
  useEffect(() => {
    warmupSpeech();
  }, []);

  const sortedReminders = useMemo(
    () => sortNewestFirst(allReminders),
    [allReminders],
  );

  const visibleReminders = showAllReminders
    ? sortedReminders
    : sortedReminders.slice(0, RECENT_PREVIEW_COUNT);

  const canShowMore = sortedReminders.length > RECENT_PREVIEW_COUNT;
  const busy = plan.status === "loading" || isVoiceBusy;

  const refreshReminders = useCallback(async (authToken: string) => {
    setIsLoadingReminders(true);
    setRemindersError(null);
    try {
      const { reminders } = await listReminders(authToken);
      setAllReminders(reminders);
      void syncLocalNotificationsForReminders(reminders);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load reminders.";
      setRemindersError(message);
    } finally {
      setIsLoadingReminders(false);
    }
  }, []);

  const notifiedPermissionRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      void (async () => {
        if (!prefs.pushNotificationsEnabled) return;
        const allowed = await requestNotificationPermission();
        if (!allowed && !notifiedPermissionRef.current) {
          notifiedPermissionRef.current = true;
          Alert.alert(
            "Notifications are off",
            Platform.OS === "ios"
              ? "Open Settings → Notifications → Routine Manager and turn Allow Notifications ON."
              : "Open Android Settings → Apps → Routine Manager → Notifications, turn them ON, then also allow Alarms & reminders if you see that option.",
          );
        }
      })();
      void refreshReminders(token);
    }, [token, refreshReminders, prefs.pushNotificationsEnabled]),
  );

  async function applyParseSuccess(result: {
    transcript?: string;
    assistantMessage: string;
    created: ReminderSummary[];
    updated?: ReminderSummary[];
    deleted?: Array<{ id: string }>;
  }) {
    const created = result.created ?? [];
    const updated = result.updated ?? [];
    const deleted = result.deleted ?? [];

    setJustCreatedIds(new Set(created.map((item) => item.id)));

    // Sync native local push notifications in background so speech starts with zero delay
    void Promise.all([
      ...created.map((item) => scheduleReminderLocalNotification(item)),
      ...updated.map(async (item) => {
        if (item.status === "scheduled") {
          await rescheduleReminderLocalNotification(item);
        } else {
          await cancelReminderLocalNotification(item.id);
        }
      }),
      ...deleted.map((item) => cancelReminderLocalNotification(item.id)),
    ]).catch((err) => {
      console.warn("[LocalReminders] Sync error:", err);
    });

    const changedCount = created.length + updated.length + deleted.length;
    const baseMessage = result.assistantMessage || "Reminders processed.";
    const transcriptLine = result.transcript
      ? `Heard: “${result.transcript}”\n\n`
      : "";

    let successMessage = `${transcriptLine}${baseMessage}`;
    if (changedCount === 0) {
      successMessage = `${transcriptLine}${baseMessage}\n\nNo reminders were created, updated, or deleted.`;
    }

    setPlan({
      status: "success",
      message: successMessage,
    });
    setPlanText("");
    setShowAllReminders(false);

    // Feature 1.3: If assistant session is active, read the confirmation aloud via native TTS
    // and keep listening for follow-up multi-utterance additions or edits hands-free
    if (assistantOverlayOpenRef.current) {
      setAssistantCreatedReminders((prev) => {
        let next = [...prev];
        // Add newly created reminders
        for (const item of created) {
          if (!next.some((r) => r.id === item.id)) {
            next.push(item);
          }
        }
        // Update modified reminders
        for (const item of updated) {
          const index = next.findIndex((r) => r.id === item.id);
          if (index >= 0) {
            next[index] = item;
          } else {
            next.push(item);
          }
        }
        // Remove deleted reminders
        if (deleted.length > 0) {
          const deletedIds = new Set(deleted.map((d) => d.id));
          next = next.filter((r) => !deletedIds.has(r.id));
        }
        return next;
      });
      setAssistantSpokenMessage(baseMessage);
      setAssistantPhase("responding");
      setIsTtsSpeaking(false);

      if (prefs.spokenFeedbackEnabled) {
        // Step 2 ("Routine scheduled, preparing spoken confirmation...") is clearly shown for 1s
        // before transitioning into Step 3 ("Assistant speaking...")
        setTimeout(() => {
          if (!assistantOverlayOpenRef.current) return;

          let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
          const clearWatchdog = () => {
            if (watchdogTimer) {
              clearTimeout(watchdogTimer);
              watchdogTimer = null;
            }
          };

          void speakText(baseMessage, {
            token,
            onStart: () => {
              if (assistantPhaseRef.current === "responding") {
                setIsTtsSpeaking(true);
                clearWatchdog();
                // Safety watchdog: measured strictly from when audio actually starts playing
                const maxAudioWaitMs = Math.max(
                  6000,
                  estimateSpeechDurationMs(baseMessage) + 3000,
                );
                watchdogTimer = setTimeout(() => {
                  void stopSpeaking();
                  setIsTtsSpeaking(false);
                  setFollowUpWakeDetected(false);
                  setAssistantPhase("listening");
                  setAssistantLiveTranscript("");
                  wakeWordRef.current?.clearTranscript();
                  startAssistantIdleTimer();
                }, maxAudioWaitMs);
              }
            },
            onDone: () => {
              clearWatchdog();
              setIsTtsSpeaking(false);
              setFollowUpWakeDetected(false);
              setAssistantPhase("listening");
              setAssistantLiveTranscript("");
              wakeWordRef.current?.clearTranscript();
              startAssistantIdleTimer();
            },
            onStopped: () => {
              clearWatchdog();
              setIsTtsSpeaking(false);
              setFollowUpWakeDetected(false);
              setAssistantPhase("listening");
              setAssistantLiveTranscript("");
              wakeWordRef.current?.clearTranscript();
              startAssistantIdleTimer();
            },
            onError: () => {
              clearWatchdog();
              setIsTtsSpeaking(false);
              setFollowUpWakeDetected(false);
              setAssistantPhase("listening");
              startAssistantIdleTimer();
            },
          });
        }, 1000);
      } else {
        setTimeout(() => {
          if (!assistantOverlayOpenRef.current) return;
          setIsTtsSpeaking(false);
          setFollowUpWakeDetected(false);
          setAssistantPhase("listening");
          setAssistantLiveTranscript("");
          wakeWordRef.current?.clearTranscript();
          startAssistantIdleTimer();
        }, 1200);
      }
    }
  }

  const submitPlanText = useCallback(
    async (rawText: string) => {
      if (isSubmittingRef.current || isVoiceBusy) return;

      const text = rawText.trim();
      if (!text) {
        setPlan({
          status: "error",
          message: "Type a plan first — empty text cannot be submitted.",
        });
        return;
      }

      if (!token) {
        setPlan({
          status: "error",
          message: "You are not signed in. Log in again, then retry.",
        });
        return;
      }

      isSubmittingRef.current = true;
      setPlan({ status: "loading" });
      warmupSpeech();

      try {
        const result = await parseRoutine(token, {
          text,
          timezone,
          sessionId: assistantSessionIdRef.current || undefined,
        });
        if (result.sessionId) {
          assistantSessionIdRef.current = result.sessionId;
        }
        await applyParseSuccess(result);
        await refreshReminders(token);
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : "Could not plan your day. Check the network and try again.";
        setPlan({ status: "error", message });

        if (assistantOverlayOpenRef.current) {
          setAssistantPhase("error");
          setAssistantError(message);
          if (prefs.spokenFeedbackEnabled) {
            void speakText(
              "I couldn't process that. Please try speaking again.",
              {
                token,
                onStart: () => {
                  if (
                    assistantPhaseRef.current === "error" ||
                    assistantPhaseRef.current === "responding"
                  ) {
                    setIsTtsSpeaking(true);
                  }
                },
                onDone: () => {
                  setIsTtsSpeaking(false);
                  setFollowUpWakeDetected(false);
                  setAssistantPhase("listening");
                  startAssistantIdleTimer();
                },
                onStopped: () => {
                  setIsTtsSpeaking(false);
                  setFollowUpWakeDetected(false);
                  setAssistantPhase("listening");
                  startAssistantIdleTimer();
                },
                onError: () => {
                  setIsTtsSpeaking(false);
                  setFollowUpWakeDetected(false);
                  setAssistantPhase("listening");
                  startAssistantIdleTimer();
                },
              },
            );
          } else {
            startAssistantIdleTimer();
          }
        }
      } finally {
        isSubmittingRef.current = false;
      }
    },
    [
      isVoiceBusy,
      token,
      timezone,
      refreshReminders,
      prefs.spokenFeedbackEnabled,
      startAssistantIdleTimer,
    ],
  );

  async function handlePlanSubmit() {
    await submitPlanText(planText);
  }

  // Feature 1.2: Handles user utterances during the post-wake conversation session
  const handleAssistantUtterance = useCallback(
    async (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;

      // 1. If user spoke ONLY the wake phrase (e.g. saying "Hey Assistant" while waiting):
      // Acknowledge the wake-phrase, give haptic feedback, and keep listening for instruction!
      if (isOnlyWakePhrase(trimmed, prefs.wakePhrase)) {
        clearAssistantIdleTimer();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
          () => {},
        );
        setFollowUpWakeDetected(true);
        setAssistantPhase("listening");
        setAssistantLiveTranscript("");
        wakeWordRef.current?.clearTranscript();
        startAssistantIdleTimer();
        return;
      }

      // 2. Strip leading wake phrase from the instruction (e.g. "hey assistant gym at 7am" -> "gym at 7am")
      const cleanInstruction = stripLeadingWakePhrase(
        trimmed,
        prefs.wakePhrase,
      );
      if (!cleanInstruction) {
        return;
      }

      clearAssistantIdleTimer();
      setFollowUpWakeDetected(false);

      // Check for closing phrase ("done", "that's all", "thank you", "cancel")
      if (isClosingPhrase(cleanInstruction)) {
        clearAssistantIdleTimer();
        setFollowUpWakeDetected(false);
        setAssistantPhase("done");
        setAssistantLiveTranscript("");
        wakeWordRef.current?.clearTranscript();

        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});

        if (prefs.spokenFeedbackEnabled) {
          setIsTtsSpeaking(false);
          void speakText("You're all set! Have a great day.", {
            token,
            onStart: () => {
              if (assistantPhaseRef.current === "done") {
                setIsTtsSpeaking(true);
              }
            },
            onDone: () => {
              setIsTtsSpeaking(false);
              setTimeout(() => handleCloseAssistant(), 800);
            },
            onStopped: () => {
              setIsTtsSpeaking(false);
              handleCloseAssistant();
            },
            onError: () => {
              setIsTtsSpeaking(false);
              handleCloseAssistant();
            },
          });
        } else {
          setTimeout(() => handleCloseAssistant(), 1200);
        }
        return;
      }

      // User dictated a new routine or change ("also remind me to take meds at noon")
      setFollowUpWakeDetected(false);
      setAssistantPhase("thinking");
      await submitPlanText(cleanInstruction);
    },
    [
      clearAssistantIdleTimer,
      handleCloseAssistant,
      prefs.spokenFeedbackEnabled,
      prefs.wakePhrase,
      submitPlanText,
      token,
      startAssistantIdleTimer,
    ],
  );

  const handleWakeDetected = useCallback(
    ({
      phrase,
      trailingTranscript,
    }: {
      phrase: string;
      trailingTranscript: string;
    }) => {
      warmupSpeech();
      setWakeFeedback(`✨ "${phrase}" detected!`);
      setTimeout(() => setWakeFeedback(null), 3500);

      clearAssistantIdleTimer();
      setFollowUpWakeDetected(false);
      if (!assistantOverlayOpenRef.current) {
        assistantSessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setAssistantCreatedReminders([]);
      }
      setAssistantOverlayOpen(true);
      setAssistantSpokenMessage("");
      setAssistantError(null);

      const cleanTrailing = stripLeadingWakePhrase(
        trailingTranscript,
        prefs.wakePhrase,
      );

      if (cleanTrailing && cleanTrailing.length > 2) {
        // Continuous single-breath utterance: "Hey Assistant gym at 7am and lunch at 1pm"
        setAssistantLiveTranscript(cleanTrailing);
        setAssistantPhase("thinking");
        void submitPlanText(cleanTrailing);
      } else {
        // Just the wake phrase spoken: open overlay in listening mode
        setFollowUpWakeDetected(true);
        setAssistantLiveTranscript("");
        setAssistantPhase("listening");
        wakeWordRef.current?.clearTranscript();
      }
    },
    [clearAssistantIdleTimer, submitPlanText, prefs.wakePhrase],
  );

  const handleOpenAssistantManually = useCallback(() => {
    warmupSpeech();
    clearAssistantIdleTimer();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    );
    assistantSessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setAssistantCreatedReminders([]);
    setAssistantSpokenMessage("");
    setAssistantError(null);
    setFollowUpWakeDetected(true);
    setAssistantLiveTranscript("");
    setAssistantPhase("listening");
    setAssistantOverlayOpen(true);
    wakeWordRef.current?.clearTranscript();
    startAssistantIdleTimer();
  }, [clearAssistantIdleTimer, startAssistantIdleTimer]);

  const wakeWord = useWakeWord({
    enabled: prefs.assistantEnabled && prefs.microphoneEnabled,
    wakePhrase: prefs.wakePhrase,
    sensitivity: prefs.wakeSensitivity,
    paused:
      voiceSheetOpen ||
      isVoiceBusy ||
      busy ||
      isTtsSpeaking ||
      assistantPhase === "done",
    mode: assistantOverlayOpen ? "conversation" : "wake",
    onWake: handleWakeDetected,
    onFollowUpWake: (_phrase) => {
      // Never interrupt while assistant is thinking or speaking/responding
      if (assistantPhaseRef.current !== "listening") return;
      void stopSpeaking();
      setIsTtsSpeaking(false);
      clearAssistantIdleTimer();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
        () => {},
      );
      setFollowUpWakeDetected(true);
      setAssistantPhase("listening");
      setAssistantLiveTranscript("");
      wakeWordRef.current?.clearTranscript();
      startAssistantIdleTimer();
    },
    onTranscript: (transcript) => {
      if (
        assistantOverlayOpenRef.current &&
        assistantPhaseRef.current === "listening" &&
        !isTtsSpeakingRef.current
      ) {
        clearAssistantIdleTimer();
        setAssistantLiveTranscript(transcript);
      }
    },
    onUtteranceComplete: (transcript) => {
      if (
        assistantOverlayOpenRef.current &&
        assistantPhaseRef.current === "listening" &&
        !isTtsSpeakingRef.current
      ) {
        void handleAssistantUtterance(transcript);
      }
    },
  });

  const wakeWordRef = useRef(wakeWord);
  wakeWordRef.current = wakeWord;

  async function handleVoiceRecorded(uri: string) {
    if (!token) {
      setPlan({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }

    setIsVoiceBusy(true);
    setPlan({ status: "loading" });

    try {
      const result = await transcribeRoutineAudio(token, {
        uri,
        mimeType: "audio/mp4",
      });
      setPlanText(result.transcript);
      setPlan({ status: "idle" });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not process voice plan. Check mic/network and try again.";
      setPlan({ status: "error", message });
    } finally {
      setIsVoiceBusy(false);
    }
  }

  async function handlePing() {
    if (ping.status === "loading") return;
    setPing({ status: "loading" });
    try {
      const data = await pingHealth();
      setPing({
        status: "success",
        message: `ok: ${String(data.ok)} · service: ${data.service} · ${new Date().toLocaleTimeString()}`,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Something went wrong while pinging the API.";
      setPing({ status: "error", message });
    }
  }

  async function handleTestPush() {
    if (testPush.status === "loading") return;
    if (!token) {
      setTestPush({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }
    if (!prefs.pushNotificationsEnabled) {
      setTestPush({
        status: "error",
        message: "Enable Push Notifications in the sidebar first.",
      });
      return;
    }

    setTestPush({ status: "loading" });
    try {
      const result = await sendTestPush(token);
      if (!result.ok || result.sent < 1) {
        const detail =
          result.errors.length > 0
            ? result.errors.join("; ")
            : "Expo accepted no tickets.";
        setTestPush({
          status: "error",
          message: `Push not delivered (${detail})`,
        });
        return;
      }
      setTestPush({
        status: "success",
        message: `Sent ${result.sent} push(es) to ${result.deviceCount} device(s). Check the notification shade (app can stay open or backgrounded).`,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not send test push. Is the backend running?";
      setTestPush({ status: "error", message });
    }
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      setSidebarOpen(false);
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleToggleMicrophone(value: boolean) {
    if (value) {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone permission needed",
          "Enable the microphone in system Settings to use voice plans.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        await prefs.setMicrophoneEnabled(false);
        return;
      }
    }
    await prefs.setMicrophoneEnabled(value);
  }

  async function handleTogglePush(value: boolean) {
    if (value) {
      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(
          "Notifications are off",
          "Enable notifications in system Settings to receive reminders.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        await prefs.setPushNotificationsEnabled(false);
        return;
      }
    }
    await prefs.setPushNotificationsEnabled(value);
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl },
        ]}
      >
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings sidebar"
            onPress={() => setSidebarOpen(true)}
            style={({ pressed }) => [
              styles.avatar,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.avatarLetter}>{avatarLetter(user)}</Text>
          </Pressable>

          <View style={styles.welcomeBlock}>
            <Text style={styles.welcomeEyebrow}>Routine Manager</Text>
            <Text style={styles.welcomeTitle}>
              Welcome {welcomeName(user)}
            </Text>
          </View>
        </View>

        {prefs.assistantEnabled && prefs.microphoneEnabled ? (
          <Pressable
            onPress={() => {
              if (!wakeWord.isNativeAvailable) return;
              if (wakeWord.hasPermission === false) {
                void wakeWord.requestPermission();
                return;
              }
              clearAssistantIdleTimer();
              setAssistantOverlayOpen(true);
              setAssistantPhase("listening");
              setAssistantLiveTranscript("");
              setAssistantSpokenMessage("");
              setAssistantCreatedReminders([]);
              setAssistantError(null);
              wakeWord.clearTranscript();
            }}
            style={({ pressed }) => [
              styles.assistantBanner,
              wakeFeedback ? styles.assistantBannerDetected : null,
              pressed ? styles.pressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Tap to activate voice assistant session"
          >
            <View style={styles.assistantBannerHeader}>
              <View style={styles.assistantBannerTitleGroup}>
                <View
                  style={[
                    styles.pulseDot,
                    wakeFeedback
                      ? styles.pulseDotDetected
                      : wakeWord.isListening ||
                          (prefs.assistantEnabled &&
                            prefs.microphoneEnabled &&
                            wakeWord.hasPermission !== false)
                        ? styles.pulseDotActive
                        : styles.pulseDotIdle,
                  ]}
                />
                <Text style={styles.assistantBannerTitle}>
                  {wakeFeedback
                    ? wakeFeedback
                    : !wakeWord.isNativeAvailable
                      ? "Hands-free needs dev build (Use mic button below)"
                      : wakeWord.hasPermission === false
                        ? "Microphone permission needed"
                        : wakeWord.isListening ||
                            (prefs.assistantEnabled && prefs.microphoneEnabled)
                          ? `Listening for "${prefs.wakePhrase}"`
                          : "Assistant standby"}
                </Text>
              </View>

              {wakeWord.hasPermission === false ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    void wakeWord.requestPermission();
                  }}
                  style={styles.enableButton}
                >
                  <Text style={styles.enableButtonText}>Grant</Text>
                </Pressable>
              ) : null}
            </View>

            {wakeWord.lastTranscript && !wakeFeedback ? (
              <Text style={styles.assistantHeardText} numberOfLines={1}>
                Heard: "{wakeWord.lastTranscript}"
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        <View style={styles.composerCard}>
          <AiPlanComposer
            value={planText}
            onChangeText={(next) => {
              setPlanText(next);
              if (plan.status === "error") {
                setPlan({ status: "idle" });
              }
            }}
            onPressMic={() => {
              if (!prefs.microphoneEnabled) {
                setPlan({
                  status: "error",
                  message:
                    "Microphone Access is turned off in Settings. Enable it in the sidebar to use voice input.",
                });
                return;
              }
              setVoiceSheetOpen(true);
            }}
            onSubmit={() => {
              void handlePlanSubmit();
            }}
            editable={!busy}
            submitting={plan.status === "loading" && !isVoiceBusy}
            micDisabled={!prefs.microphoneEnabled || busy}
          />

          {busy ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#1D4ED8" />
              <Text style={styles.loadingText}>
                {isVoiceBusy
                  ? "Transcribing your voice…"
                  : "Generating reminders…"}
              </Text>
            </View>
          ) : null}

          {plan.status === "error" ? (
            <FeedbackBanner tone="error" title="Error" body={plan.message} />
          ) : null}

          {plan.status === "success" ? (
            <AssistantResponseCard message={plan.message} />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {showAllReminders
              ? `All reminders (${sortedReminders.length})`
              : `Recent reminders (${Math.min(RECENT_PREVIEW_COUNT, sortedReminders.length)} of ${sortedReminders.length})`}
          </Text>

          {isLoadingReminders && sortedReminders.length === 0 ? (
            <ActivityIndicator color="#1D4ED8" />
          ) : null}

          {remindersError ? (
            <FeedbackBanner
              tone="error"
              title="Could not load reminders"
              body={remindersError}
              actionLabel="Retry"
              onAction={() => {
                if (token) void refreshReminders(token);
              }}
            />
          ) : null}

          {!remindersError &&
          sortedReminders.length === 0 &&
          !isLoadingReminders ? (
            <Text style={styles.emptyText}>
              No reminders yet. Submit a plan above to create some.
            </Text>
          ) : null}

          <View style={styles.reminderList}>
            {visibleReminders.map((item) => {
              const startLabel = formatReminderTime(
                item.startAt,
                item.timezone || timezone,
                prefs.use24HourClock,
              );
              const endLabel = item.endAt
                ? ` → ${formatReminderTime(item.endAt, item.timezone || timezone, prefs.use24HourClock)}`
                : "";
              return (
                <ReminderRow
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  timeLabel={`${startLabel}${endLabel}`}
                  status={item.status}
                  kind={item.kind}
                  meetLink={item.action?.meetLink}
                  isNew={justCreatedIds.has(item.id)}
                  onPress={() => {
                    router.push({
                      pathname: "/reminder/[id]",
                      params: { id: item.id },
                    });
                  }}
                />
              );
            })}
          </View>

          {canShowMore ? (
            <AppButton
              label={
                showAllReminders
                  ? "Show less"
                  : `Show more (${sortedReminders.length - RECENT_PREVIEW_COUNT} more)`
              }
              variant="ghost"
              onPress={() => setShowAllReminders((prev) => !prev)}
            />
          ) : null}
        </View>
      </ScrollView>

      <HomeSidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        microphoneEnabled={prefs.microphoneEnabled}
        pushNotificationsEnabled={prefs.pushNotificationsEnabled}
        use24HourClock={prefs.use24HourClock}
        assistantEnabled={prefs.assistantEnabled}
        wakePhrase={prefs.wakePhrase}
        wakeSensitivity={prefs.wakeSensitivity}
        isAssistantListening={wakeWord.isListening}
        onToggleMicrophone={(value) => {
          void handleToggleMicrophone(value);
        }}
        onTogglePush={(value) => {
          void handleTogglePush(value);
        }}
        onToggle24Hour={(value) => {
          void prefs.setUse24HourClock(value);
        }}
        onToggleAssistant={(value) => {
          void prefs.setAssistantEnabled(value);
        }}
        onChangeWakeSensitivity={(value) => {
          void prefs.setWakeSensitivity(value);
        }}
        spokenFeedbackEnabled={prefs.spokenFeedbackEnabled}
        onToggleSpokenFeedback={(value) => {
          void prefs.setSpokenFeedbackEnabled(value);
        }}
        ping={ping}
        testPush={testPush}
        onPing={() => {
          void handlePing();
        }}
        onTestPush={() => {
          void handleTestPush();
        }}
        onLogout={() => {
          void handleLogout();
        }}
        isLoggingOut={isLoggingOut}
      />

      <VoiceRecordSheet
        isPresented={voiceSheetOpen}
        onDismiss={() => setVoiceSheetOpen(false)}
        onRecorded={handleVoiceRecorded}
        onPermissionDenied={() => {
          setPlan({
            status: "error",
            message:
              "Microphone permission is required for voice plans. Enable it in system Settings, then try again. You can still type a plan.",
          });
        }}
        onError={(message) => {
          setPlan({ status: "error", message });
        }}
      />

      <AssistantOverlay
        visible={assistantOverlayOpen}
        phase={assistantPhase}
        liveTranscript={assistantLiveTranscript}
        assistantMessage={assistantSpokenMessage}
        errorMessage={assistantError}
        createdReminders={assistantCreatedReminders}
        isTtsSpeaking={isTtsSpeaking}
        followUpWakeDetected={followUpWakeDetected}
        spokenFeedbackEnabled={prefs.spokenFeedbackEnabled}
        onToggleSpokenFeedback={() => {
          void prefs.setSpokenFeedbackEnabled(!prefs.spokenFeedbackEnabled);
        }}
        onStopSpeaking={() => {
          void stopSpeaking();
          setIsTtsSpeaking(false);
          setFollowUpWakeDetected(true);
          setAssistantPhase("listening");
          setAssistantLiveTranscript("");
          wakeWordRef.current?.clearTranscript();
          startAssistantIdleTimer();
        }}
        onDone={() => {
          handleCloseAssistant();
        }}
        onClose={() => {
          handleCloseAssistant();
        }}
      />

      <FloatingAssistantBubble
        visible={
          prefs.assistantEnabled &&
          !assistantOverlayOpen &&
          !voiceSheetOpen &&
          !sidebarOpen
        }
        isListening={wakeWord.isListening}
        onPress={handleOpenAssistantManually}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    experimental_backgroundImage: `
      linear-gradient(180deg, rgba(147, 197, 253, 0.55) 0%, rgba(59, 130, 246, 0.18) 55%, rgba(255, 255, 255, 0) 100%)
    `,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D4ED8",
    boxShadow: shadows.subtle,
  },
  avatarLetter: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  welcomeBlock: {
    flex: 1,
    gap: 2,
  },
  welcomeEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#2563EB",
    textTransform: "uppercase",
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: "#0F172A",
  },
  assistantBanner: {
    backgroundColor: "#F1F5F9",
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  assistantBannerDetected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#3B82F6",
    borderWidth: 1.5,
  },
  assistantBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  assistantBannerTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    flex: 1,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pulseDotActive: {
    backgroundColor: "#16A34A",
  },
  pulseDotDetected: {
    backgroundColor: "#2563EB",
  },
  pulseDotIdle: {
    backgroundColor: "#94A3B8",
  },
  assistantBannerTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E293B",
  },
  assistantHeardText: {
    fontSize: 12,
    color: "#64748B",
    fontStyle: "italic",
    paddingLeft: spacing.sm + 4,
  },
  enableButton: {
    backgroundColor: "#2563EB",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
  enableButtonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  composerCard: {
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.18)",
    boxShadow: shadows.subtle,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    flex: 1,
    color: "#475569",
    fontSize: 14,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  emptyText: {
    color: "#64748B",
    lineHeight: 20,
  },
  reminderList: {
    gap: spacing.sm,
  },
  reminderRow: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 4,
    gap: spacing.xs,
    backgroundColor: "rgba(37, 99, 235, 0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.12)",
  },
  reminderRowNew: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  reminderTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kindIcon: {
    fontSize: 16,
  },
  reminderTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  badgeGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  meetPill: {
    backgroundColor: "rgba(22, 163, 74, 0.12)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(22, 163, 74, 0.3)",
  },
  meetPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#15803D",
  },
  newBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  reminderMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reminderTime: {
    fontSize: 13,
    color: "#64748B",
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.88,
  },
});
