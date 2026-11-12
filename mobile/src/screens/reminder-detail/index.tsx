import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import {
  deleteReminder,
  getReminder,
  updateReminder,
  type ReminderStatus,
  type ReminderSummary,
} from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
import { AppButton } from "@/components/ui/app-button";
import { AppTextField } from "@/components/ui/app-text-field";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import {
  cancelReminderLocalNotification,
  rescheduleReminderLocalNotification,
} from "@/notifications/local-reminders";
import {
  formatReminderTime,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/utils/reminder-time";
import { radius, shadows, spacing } from "@/theme";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; reminder: ReminderSummary }
  | { status: "error"; message: string };

const STATUS_OPTIONS: ReminderStatus[] = [
  "scheduled",
  "completed",
  "cancelled",
];

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function BackChevron() {
  if (process.env.EXPO_OS === "ios") {
    return (
      <SymbolView
        name="chevron.left"
        size={20}
        tintColor="#1D4ED8"
        weight="semibold"
      />
    );
  }
  return <Text style={styles.backFallback}>‹</Text>;
}

export function ReminderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { back } = useRouter();
  const insets = useSafeAreaInsets();

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ReminderStatus>("scheduled");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const accountTimezone = user?.timezone || getDeviceTimezone();
  // Prefer the reminder's stored TZ so edit/preview match Home + calendar agenda.
  const timezone =
    (load.status === "ready" ? load.reminder.timezone : undefined) ||
    accountTimezone;

  const applyReminderToForm = useCallback(
    (reminder: ReminderSummary) => {
      const tz = reminder.timezone || accountTimezone;
      setTitle(reminder.title);
      setNotes(reminder.notes ?? "");
      setStatus(
        (STATUS_OPTIONS.includes(reminder.status as ReminderStatus)
          ? reminder.status
          : "scheduled") as ReminderStatus,
      );
      setStartLocal(toLocalDateTimeInput(reminder.startAt, tz));
      setEndLocal(
        reminder.endAt ? toLocalDateTimeInput(reminder.endAt, tz) : "",
      );
    },
    [accountTimezone],
  );

  const loadReminder = useCallback(async () => {
    if (!token || !id) {
      setLoad({ status: "error", message: "Missing reminder id or session." });
      return;
    }

    setLoad({ status: "loading" });
    setFormError(null);
    setSaveMessage(null);

    try {
      const { reminder } = await getReminder(token, id);
      applyReminderToForm(reminder);
      setLoad({ status: "ready", reminder });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load this reminder.";
      setLoad({ status: "error", message });
    }
  }, [token, id, applyReminderToForm]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing load-on-mount flow, unchanged
    void loadReminder();
  }, [loadReminder]);

  async function handleSave() {
    if (savingRef.current || !token || !id) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Title is required.");
      setSaveMessage(null);
      return;
    }

    const startAtISO = fromLocalDateTimeInput(startLocal, timezone);
    if (!startAtISO) {
      setFormError("Start must look like 2026-11-12T09:00");
      setSaveMessage(null);
      return;
    }

    let endAtISO: string | null = null;
    if (endLocal.trim()) {
      endAtISO = fromLocalDateTimeInput(endLocal.trim(), timezone);
      if (!endAtISO) {
        setFormError("End must look like 2026-11-12T18:00 (or leave blank)");
        setSaveMessage(null);
        return;
      }
      if (new Date(endAtISO).getTime() < new Date(startAtISO).getTime()) {
        setFormError("End must be after start.");
        setSaveMessage(null);
        return;
      }
    }

    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    setSaveMessage(null);

    try {
      const { reminder } = await updateReminder(token, id, {
        title: trimmedTitle,
        notes: notes.trim(),
        status,
        startAt: startAtISO,
        endAt: endAtISO,
        timezone,
      });

      applyReminderToForm(reminder);
      setLoad({ status: "ready", reminder });
      await rescheduleReminderLocalNotification(reminder);
      setSaveMessage("Saved. Calendar and Home will refresh when you go back.");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not save changes. Try again.";
      setFormError(message);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  function confirmDelete() {
    if (deletingRef.current || !token || !id) return;

    Alert.alert(
      "Delete reminder?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDelete();
          },
        },
      ],
      { cancelable: true },
    );
  }

  async function handleDelete() {
    if (deletingRef.current || !token || !id) return;

    deletingRef.current = true;
    setIsDeleting(true);
    setFormError(null);

    try {
      await deleteReminder(token, id);
      await cancelReminderLocalNotification(id);
      back();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not delete reminder. Try again.";
      setFormError(message);
      deletingRef.current = false;
      setIsDeleting(false);
    }
  }

  const startPreview = fromLocalDateTimeInput(startLocal, timezone);
  const endPreview = endLocal.trim()
    ? fromLocalDateTimeInput(endLocal.trim(), timezone)
    : null;

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md },
        ]}
      >
        {load.status === "loading" ? (
          <ActivityIndicator color="#1D4ED8" />
        ) : null}

        {load.status === "error" ? (
          <FeedbackBanner
            tone="error"
            title="Error"
            body={load.message}
            actionLabel="Retry"
            onAction={() => {
              void loadReminder();
            }}
          />
        ) : null}

        {load.status === "error" ? (
          <AppButton label="Go back" variant="ghost" onPress={() => back()} />
        ) : null}

        {load.status === "ready" ? (
          <>
            <View style={styles.titleRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={() => back()}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <BackChevron />
              </Pressable>
              <Text style={styles.screenTitle}>Edit reminder</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Title</Text>
              <AppTextField
                value={title}
                onChangeText={(next) => {
                  setTitle(next);
                  setFormError(null);
                  setSaveMessage(null);
                }}
                editable={!isSaving && !isDeleting}
                placeholderTextColor="#94A3B8"
                selectionColor="#1D4ED8"
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Notes</Text>
              <AppTextField
                style={[styles.input, styles.notesInput]}
                multiline
                textAlignVertical="top"
                value={notes}
                onChangeText={(next) => {
                  setNotes(next);
                  setFormError(null);
                  setSaveMessage(null);
                }}
                editable={!isSaving && !isDeleting}
                placeholderTextColor="#94A3B8"
                selectionColor="#1D4ED8"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Starts</Text>
              <AppTextField
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="2026-11-12T09:00"
                value={startLocal}
                onChangeText={(next) => {
                  setStartLocal(next);
                  setFormError(null);
                  setSaveMessage(null);
                }}
                editable={!isSaving && !isDeleting}
                placeholderTextColor="#94A3B8"
                selectionColor="#1D4ED8"
                style={styles.input}
              />
              {startLocal.trim() ? (
                startPreview ? (
                  <Text style={styles.previewValid}>
                    {formatReminderTime(startPreview, timezone)}
                  </Text>
                ) : (
                  <Text style={styles.previewInvalid}>
                    Use the format 2026-11-12T09:00
                  </Text>
                )
              ) : null}

              <Text style={styles.fieldLabel}>Ends · optional</Text>
              <AppTextField
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="2026-11-12T18:00 · leave blank for none"
                value={endLocal}
                onChangeText={(next) => {
                  setEndLocal(next);
                  setFormError(null);
                  setSaveMessage(null);
                }}
                editable={!isSaving && !isDeleting}
                placeholderTextColor="#94A3B8"
                selectionColor="#1D4ED8"
                style={styles.input}
              />
              {endLocal.trim() ? (
                endPreview ? (
                  <Text style={styles.previewValid}>
                    {formatReminderTime(endPreview, timezone)}
                  </Text>
                ) : (
                  <Text style={styles.previewInvalid}>
                    Use the format 2026-11-12T18:00
                  </Text>
                )
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Status</Text>
              <View style={styles.statusRow}>
                {STATUS_OPTIONS.map((option) => {
                  const selected = status === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      disabled={isSaving || isDeleting}
                      onPress={() => {
                        setStatus(option);
                        setFormError(null);
                        setSaveMessage(null);
                      }}
                      style={({ pressed }) => [
                        styles.statusChip,
                        selected ? styles.statusChipSelected : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusChipLabel,
                          selected ? styles.statusChipLabelSelected : null,
                        ]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {formError ? (
              <FeedbackBanner tone="error" title="Error" body={formError} />
            ) : null}

            {saveMessage ? (
              <FeedbackBanner tone="success" title="Saved" body={saveMessage} />
            ) : null}

            <View style={styles.actions}>
              <AppButton
                label="Save changes"
                loading={isSaving}
                disabled={isDeleting}
                onPress={() => {
                  void handleSave();
                }}
                style={styles.primaryButton}
              />

              <AppButton
                label="Delete reminder"
                variant="danger"
                loading={isDeleting}
                disabled={isSaving}
                onPress={confirmDelete}
                style={styles.dangerButton}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
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
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  backFallback: {
    fontSize: 24,
    lineHeight: 26,
    color: "#1D4ED8",
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: "#0F172A",
  },
  card: {
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.18)",
    boxShadow: shadows.subtle,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#2563EB",
    textTransform: "uppercase",
  },
  input: {
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
    borderColor: "rgba(37, 99, 235, 0.18)",
  },
  notesInput: {
    minHeight: 90,
  },
  previewValid: {
    fontSize: 13,
    color: "#1D4ED8",
  },
  previewInvalid: {
    fontSize: 13,
    color: "#DC2626",
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statusChip: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  statusChipSelected: {
    backgroundColor: "#1D4ED8",
  },
  statusChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    textTransform: "capitalize",
  },
  statusChipLabelSelected: {
    color: "#FFFFFF",
  },
  actions: {
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: "#1D4ED8",
  },
  dangerButton: {
    borderColor: "#DC2626",
  },
  pressed: {
    opacity: 0.85,
  },
});
