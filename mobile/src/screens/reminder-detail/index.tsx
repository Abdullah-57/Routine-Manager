import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import {
  formatReminderTime,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/utils/reminder-time";

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

  const timezone = user?.timezone || getDeviceTimezone();

  const applyReminderToForm = useCallback(
    (reminder: ReminderSummary) => {
      const tz = reminder.timezone || timezone;
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
    [timezone],
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      {load.status === "loading" ? (
        <ActivityIndicator color="#2563eb" />
      ) : null}

      {load.status === "error" ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorLabel}>Error</Text>
          <Text style={styles.errorBody}>{load.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadReminder()}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => back()}>
            <Text style={styles.link}>Go back</Text>
          </Pressable>
        </View>
      ) : null}

      {load.status === "ready" ? (
        <View style={styles.form}>
          <Text style={styles.heading}>Edit reminder</Text>
          <Text style={styles.meta}>
            Source: {load.reminder.source} · TZ: {timezone}
          </Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
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
          />

          <Text style={styles.label}>Status</Text>
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

          <Text style={styles.label}>Start (local)</Text>
          <Text style={styles.help}>Format: YYYY-MM-DDTHH:mm</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            value={startLocal}
            onChangeText={(next) => {
              setStartLocal(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />
          <Text style={styles.preview}>
            Preview:{" "}
            {fromLocalDateTimeInput(startLocal, timezone)
              ? formatReminderTime(
                  fromLocalDateTimeInput(startLocal, timezone)!,
                  timezone,
                )
              : "invalid"}
          </Text>

          <Text style={styles.label}>End (optional)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="Leave blank for none"
            placeholderTextColor="#a3a3a3"
            value={endLocal}
            onChangeText={(next) => {
              setEndLocal(next);
              setFormError(null);
              setSaveMessage(null);
            }}
            editable={!isSaving && !isDeleting}
          />

          {formError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorLabel}>Error</Text>
              <Text style={styles.errorBody}>{formError}</Text>
            </View>
          ) : null}

          {saveMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successLabel}>Saved</Text>
              <Text style={styles.successBody}>{saveMessage}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isSaving || isDeleting}
            onPress={() => {
              void handleSave();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.pressed : null,
              isSaving ? styles.disabled : null,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonLabel}>Save changes</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={isSaving || isDeleting}
            onPress={confirmDelete}
            style={({ pressed }) => [
              styles.dangerButton,
              pressed ? styles.pressed : null,
              isDeleting ? styles.disabled : null,
            ]}
          >
            {isDeleting ? (
              <ActivityIndicator color="#b91c1c" />
            ) : (
              <Text style={styles.dangerButtonLabel}>Delete reminder</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  form: {
    gap: 10,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
  },
  meta: {
    color: "#737373",
    fontSize: 13,
    marginBottom: 4,
  },
  label: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "600",
    color: "#404040",
  },
  help: {
    fontSize: 12,
    color: "#737373",
  },
  preview: {
    fontSize: 13,
    color: "#525252",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 12,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#ffffff",
  },
  notesInput: {
    minHeight: 90,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusChip: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fafafa",
  },
  statusChipSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#2563eb",
  },
  statusChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#404040",
  },
  statusChipLabelSelected: {
    color: "#ffffff",
  },
  primaryButton: {
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  dangerButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#b91c1c",
  },
  dangerButtonLabel: {
    color: "#b91c1c",
    fontSize: 16,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.7,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 14,
    gap: 6,
  },
  errorLabel: {
    fontWeight: "700",
  },
  errorBody: {
    color: "#404040",
  },
  successBox: {
    backgroundColor: "#ecfdf5",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 14,
    gap: 4,
  },
  successLabel: {
    fontWeight: "700",
  },
  successBody: {
    color: "#404040",
  },
  link: {
    color: "#2563eb",
    fontWeight: "600",
  },
});
