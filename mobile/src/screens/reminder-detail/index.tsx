import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { ScreenScroll } from "@/components/ui/screen";
import { ThemedText } from "@/components/ui/themed-text";
import {
  cancelReminderLocalNotification,
  rescheduleReminderLocalNotification,
} from "@/notifications/local-reminders";
import {
  formatReminderTime,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/utils/reminder-time";
import { colors, radius, shadows, spacing } from "@/theme";

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

export function ReminderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { back } = useRouter();

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

  return (
    <ScreenScroll>
      {load.status === "loading" ? (
        <ActivityIndicator color={colors.tint} />
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
        <View style={styles.card}>
          <ThemedText variant="largeTitle">Edit reminder</ThemedText>
          <ThemedText variant="caption">
            Source: {load.reminder.source} · TZ: {timezone}
          </ThemedText>

          <ThemedText variant="label">Title</ThemedText>
          <AppTextField
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />

          <ThemedText variant="label">Notes</ThemedText>
          <AppTextField
            style={styles.notesInput}
            multiline
            textAlignVertical="top"
            value={notes}
            onChangeText={(next) => {
              setNotes(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />

          <ThemedText variant="label">Status</ThemedText>
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

          <ThemedText variant="label">Start (local)</ThemedText>
          <ThemedText variant="caption">Format: YYYY-MM-DDTHH:mm</ThemedText>
          <AppTextField
            autoCapitalize="none"
            autoCorrect={false}
            value={startLocal}
            onChangeText={(next) => {
              setStartLocal(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />
          <ThemedText variant="caption">
            Preview:{" "}
            {fromLocalDateTimeInput(startLocal, timezone)
              ? formatReminderTime(
                  fromLocalDateTimeInput(startLocal, timezone)!,
                  timezone,
                )
              : "invalid"}
          </ThemedText>

          <ThemedText variant="label">End (optional)</ThemedText>
          <AppTextField
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Leave blank for none"
            value={endLocal}
            onChangeText={(next) => {
              setEndLocal(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />

          {formError ? (
            <FeedbackBanner tone="error" title="Error" body={formError} />
          ) : null}

          {saveMessage ? (
            <FeedbackBanner tone="success" title="Saved" body={saveMessage} />
          ) : null}

          <AppButton
            label="Save changes"
            loading={isSaving}
            disabled={isDeleting}
            onPress={() => {
              void handleSave();
            }}
          />

          <AppButton
            label="Delete reminder"
            variant="danger"
            loading={isDeleting}
            disabled={isSaving}
            onPress={confirmDelete}
          />
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.secondaryGroupedBackground,
    boxShadow: shadows.subtle,
  },
  notesInput: {
    minHeight: 90,
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
    backgroundColor: colors.fill,
  },
  statusChipSelected: {
    backgroundColor: colors.tint,
  },
  statusChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.secondaryLabel,
  },
  statusChipLabelSelected: {
    color: colors.onTint,
  },
  pressed: {
    opacity: 0.85,
  },
});
