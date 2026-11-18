import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
  formatTimeOnly,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/utils/reminder-time";
import { radius, shadows, spacing } from "@/theme";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; reminder: ReminderSummary }
  | { status: "error"; message: string };

type ReminderKind = "simple" | "meeting" | "call" | "custom";

const KIND_OPTIONS: Array<{ value: ReminderKind; label: string; icon: string }> = [
  { value: "simple", label: "Reminder", icon: "⏰" },
  { value: "meeting", label: "Meeting", icon: "🎥" },
  { value: "call", label: "Call", icon: "📞" },
  { value: "custom", label: "Custom", icon: "✨" },
];

const STATUS_OPTIONS: ReminderStatus[] = [
  "scheduled",
  "completed",
  "cancelled",
];

function formatLeadTime(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins === 60) return "1h";
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatRelativeCountdown(startAtISO: string): string {
  const diffMs = new Date(startAtISO).getTime() - Date.now();
  if (diffMs < -60 * 1000) {
    const minsAgo = Math.floor(-diffMs / (60 * 1000));
    if (minsAgo < 60) return `Started ${minsAgo}m ago`;
    const hoursAgo = Math.floor(minsAgo / 60);
    return `Started ${hoursAgo}h ago`;
  }
  if (diffMs <= 60 * 1000) {
    return "Starting Now";
  }
  const minsUntil = Math.ceil(diffMs / (60 * 1000));
  if (minsUntil < 60) return `Starts in ${minsUntil} min`;
  const hours = Math.floor(minsUntil / 60);
  const remainingMins = minsUntil % 60;
  return `Starts in ${hours}h ${remainingMins > 0 ? `${remainingMins}m` : ""}`.trim();
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
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const { token, user } = useAuth();
  const { back } = useRouter();
  const insets = useSafeAreaInsets();

  const [viewMode, setViewMode] = useState<"meeting" | "edit">(
    action === "join" ? "meeting" : "edit",
  );

  useEffect(() => {
    if (action === "join") {
      setViewMode("meeting");
    }
  }, [action]);

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ReminderStatus>("scheduled");
  const [kind, setKind] = useState<ReminderKind>("simple");
  const [leadTimes, setLeadTimes] = useState<number[]>([]);
  const [meetLink, setMeetLink] = useState("");
  const [attendees, setAttendees] = useState<
    Array<{ name?: string | null; email?: string | null; inviteSentAt?: string | null }>
  >([]);
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
      setKind(reminder.kind ?? "simple");
      setLeadTimes(reminder.leadTimes ?? []);
      setMeetLink(reminder.action?.meetLink ?? "");
      setAttendees(reminder.action?.attendees ?? []);
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
      if (error instanceof ApiError && error.status === 404) {
        void cancelReminderLocalNotification(id);
      }
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
        kind,
        leadTimes,
        action:
          meetLink.trim() || attendees.length > 0
            ? {
                type: meetLink.trim()
                  ? "meeting_link"
                  : kind === "call"
                    ? "call"
                    : "none",
                status: "done",
                meetLink: meetLink.trim() || null,
                attendees,
              }
            : undefined,
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

  function addLeadTime(minutes: number) {
    if (minutes <= 0) return;
    setLeadTimes((prev) => {
      const next = Array.from(new Set([...prev, minutes])).sort((a, b) => b - a);
      return next;
    });
    setFormError(null);
    setSaveMessage(null);
  }

  function removeLeadTime(minutes: number) {
    setLeadTimes((prev) => prev.filter((m) => m !== minutes));
    setFormError(null);
    setSaveMessage(null);
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

  const isMeetingItem =
    kind === "meeting" ||
    Boolean(meetLink) ||
    (load.status === "ready" &&
      (load.reminder.kind === "meeting" ||
        Boolean(load.reminder.action?.meetLink)));

  const finalMeetUrl = (
    meetLink.trim() ||
    (load.status === "ready" ? load.reminder.action?.meetLink?.trim() : "") ||
    notes.match(/https?:\/\/[^\s]+/i)?.[0] ||
    `https://meet.jit.si/RoutineApp-${(title || (load.status === "ready" ? load.reminder.title : "Meeting")).replace(/[^a-zA-Z0-9]/g, "")}-${id}`
  ).trim();

  const formattedMeetUrl = /^https?:\/\//i.test(finalMeetUrl)
    ? finalMeetUrl
    : `https://${finalMeetUrl}`;

  async function handleLaunchMeeting() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await Linking.openURL(formattedMeetUrl);
    } catch (err) {
      Alert.alert("Could not open meeting", (err as Error)?.message || String(err));
    }
  }

  async function handleShareMeetingLink() {
    void Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        title: title || (load.status === "ready" ? load.reminder.title : "Meeting"),
        message: `Join meeting: ${formattedMeetUrl}`,
        url: formattedMeetUrl,
      });
    } catch {
      // Non-fatal
    }
  }

  async function handleQuickComplete() {
    if (savingRef.current || isSaving || !token || !id) return;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    setSaveMessage(null);
    try {
      await cancelReminderLocalNotification(id);
      const { reminder } = await updateReminder(token, id, {
        status: "completed",
      });
      applyReminderToForm(reminder);
      setStatus("completed");
      setLoad({ status: "ready", reminder });
      setSaveMessage("Meeting marked as completed!");
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    } catch (e) {
      setFormError(
        e instanceof ApiError ? e.message : "Could not update status",
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
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
          viewMode === "meeting" && isMeetingItem ? (
            <>
              {/* Pre-Meeting Hub View */}
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.screenTitle} numberOfLines={1}>
                    Meeting Hub
                  </Text>
                  <Text style={styles.preMeetingSubtitle}>One-tap to video call</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit Reminder Details"
                  onPress={() => setViewMode("edit")}
                  style={({ pressed }) => [
                    styles.editModeToggle,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.editModeToggleText}>✏️ Edit</Text>
                </Pressable>
              </View>

              {formError ? (
                <FeedbackBanner tone="error" title="Error" body={formError} />
              ) : null}

              {saveMessage ? (
                <FeedbackBanner tone="success" title="Success" body={saveMessage} />
              ) : null}

              <View style={styles.preMeetingHeroCard}>
                <View style={styles.preMeetingHeroHeader}>
                  <View
                    style={[
                      styles.preMeetingHeroBadge,
                      status === "completed"
                        ? styles.preMeetingHeroBadgeCompleted
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preMeetingHeroBadgeDot,
                        status === "completed"
                          ? styles.preMeetingHeroBadgeDotCompleted
                          : null,
                      ]}
                    >
                      ●
                    </Text>
                    <Text
                      style={[
                        styles.preMeetingHeroBadgeText,
                        status === "completed"
                          ? styles.preMeetingHeroBadgeTextCompleted
                          : null,
                      ]}
                    >
                      {status === "completed" ? "Completed" : "Ready to Join"}
                    </Text>
                  </View>
                  <Text style={styles.preMeetingCountdown}>
                    {formatRelativeCountdown(load.reminder.startAt)}
                  </Text>
                </View>

                <Text style={styles.preMeetingHeroTitle}>
                  {title || load.reminder.title}
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Join Video Meeting Now"
                  onPress={handleLaunchMeeting}
                  style={({ pressed }) => [
                    styles.preMeetingBigJoinButton,
                    pressed ? styles.preMeetingButtonPressed : null,
                  ]}
                >
                  <View style={styles.preMeetingBigJoinContent}>
                    <View style={styles.preMeetingCamCircle}>
                      <Text style={styles.preMeetingCamIcon}>📹</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.preMeetingBigJoinText}>
                        Join Video Meeting
                      </Text>
                      <Text style={styles.preMeetingBigJoinSubtext}>
                        {meetLink.trim()
                          ? "Tap to open meeting in browser / app"
                          : "Instant Jitsi Room ready"}
                      </Text>
                    </View>
                    <Text style={styles.preMeetingJoinArrow}>→</Text>
                  </View>
                </Pressable>

                <View style={styles.preMeetingLinkRow}>
                  <View style={styles.preMeetingLinkBox}>
                    <Text style={styles.preMeetingLinkText} numberOfLines={1}>
                      {formattedMeetUrl}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Share meeting link"
                    onPress={handleShareMeetingLink}
                    style={({ pressed }) => [
                      styles.preMeetingShareButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.preMeetingShareText}>📤 Share</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Scheduled Time</Text>
                <View style={styles.preMeetingTimeRow}>
                  <Text style={styles.preMeetingTimeIcon}>🕒</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.preMeetingTimePrimary}>
                      {formatReminderTime(load.reminder.startAt, timezone)}
                      {load.reminder.endAt
                        ? ` → ${formatTimeOnly(load.reminder.endAt, timezone, false)}`
                        : ""}
                    </Text>
                    <Text style={styles.preMeetingTimeSecondary}>
                      Timezone: {timezone}
                    </Text>
                  </View>
                </View>

                {leadTimes.length > 0 ? (
                  <View style={styles.preMeetingAlertsRow}>
                    <Text style={styles.preMeetingAlertsIcon}>🔔</Text>
                    <Text style={styles.preMeetingAlertsText}>
                      Early notifications set for:{" "}
                      {leadTimes.map((m) => formatLeadTime(m)).join(", ")} before
                    </Text>
                  </View>
                ) : null}
              </View>

              {notes.trim() ? (
                <View style={styles.card}>
                  <Text style={styles.fieldLabel}>Agenda & Notes</Text>
                  <Text style={styles.preMeetingNotesText}>{notes.trim()}</Text>
                </View>
              ) : null}

              {attendees.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.fieldLabel}>
                    Invited Attendees ({attendees.length})
                  </Text>
                  <View style={styles.attendeesContainer}>
                    {attendees.map((att, idx) => (
                      <View key={idx} style={styles.attendeeItem}>
                        <View style={styles.attendeeAvatar}>
                          <Text style={styles.attendeeAvatarText}>
                            {(att.name || att.email || "A").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.attendeeTextContainer}>
                          <Text style={styles.attendeeName}>
                            {att.name || "Attendee"}
                          </Text>
                          {att.email ? (
                            <Text style={styles.attendeeEmail}>{att.email}</Text>
                          ) : null}
                        </View>
                        {att.inviteSentAt ? (
                          <View style={styles.inviteSentChip}>
                            <Text style={styles.inviteSentText}>✉️ Invite Sent</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.preMeetingActions}>
                {status !== "completed" ? (
                  <AppButton
                    label="✓ Mark as Completed"
                    variant="primary"
                    loading={isSaving}
                    onPress={handleQuickComplete}
                    style={styles.preMeetingCompleteButton}
                  />
                ) : null}

                <AppButton
                  label="Edit Reminder Details"
                  variant="ghost"
                  onPress={() => setViewMode("edit")}
                />
              </View>
            </>
          ) : (
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.screenTitle}>Edit reminder</Text>
                </View>
                {isMeetingItem ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open Pre-Meeting Hub"
                    onPress={() => setViewMode("meeting")}
                    style={({ pressed }) => [
                      styles.editModeToggle,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.editModeToggleText}>🎥 Hub</Text>
                  </Pressable>
                ) : null}
              </View>

            {kind === "meeting" || meetLink || attendees.length > 0 ? (
              <View style={styles.meetingCard}>
                <View style={styles.meetingCardHeader}>
                  <View style={styles.meetingCardTitleRow}>
                    <Text style={styles.meetingCardIcon}>🎥</Text>
                    <View>
                      <Text style={styles.meetingCardTitle}>Video Meeting Room</Text>
                      <Text style={styles.meetingCardSubtitle}>
                        {meetLink ? "Instant room ready" : "Meeting details"}
                      </Text>
                    </View>
                  </View>
                  {meetLink ? (
                    <View style={styles.liveBadge}>
                      <Text style={styles.liveBadgeText}>Ready</Text>
                    </View>
                  ) : null}
                </View>

                {meetLink ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Join Video Meeting Now"
                    onPress={() => {
                      void Linking.openURL(meetLink).catch((err) => {
                        Alert.alert("Could not open meeting", err?.message || String(err));
                      });
                    }}
                    style={({ pressed }) => [
                      styles.joinButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.joinButtonIcon}>📹</Text>
                    <Text style={styles.joinButtonText}>Join Video Meeting Now</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Pre-Meeting Hub"
                  onPress={() => setViewMode("meeting")}
                  style={({ pressed }) => [
                    styles.openHubButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.openHubButtonText}>🎥 Open Pre-Meeting Hub</Text>
                </Pressable>

                {attendees.length > 0 ? (
                  <View style={styles.attendeesContainer}>
                    <Text style={styles.attendeesHeading}>
                      Invited Attendees ({attendees.length})
                    </Text>
                    {attendees.map((att, idx) => (
                      <View key={idx} style={styles.attendeeItem}>
                        <View style={styles.attendeeAvatar}>
                          <Text style={styles.attendeeAvatarText}>
                            {(att.name || att.email || "A").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.attendeeTextContainer}>
                          <Text style={styles.attendeeName}>
                            {att.name || "Attendee"}
                          </Text>
                          {att.email ? (
                            <Text style={styles.attendeeEmail}>{att.email}</Text>
                          ) : null}
                        </View>
                        {att.inviteSentAt ? (
                          <View style={styles.inviteSentChip}>
                            <Text style={styles.inviteSentText}>✉️ Invite Sent</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Type / Kind</Text>
              <View style={styles.statusRow}>
                {KIND_OPTIONS.map((opt) => {
                  const selected = kind === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      disabled={isSaving || isDeleting}
                      onPress={() => {
                        setKind(opt.value);
                        setFormError(null);
                        setSaveMessage(null);
                      }}
                      style={({ pressed }) => [
                        styles.statusChip,
                        styles.kindChip,
                        selected ? styles.statusChipSelected : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text style={styles.kindChipIcon}>{opt.icon}</Text>
                      <Text
                        style={[
                          styles.kindChipLabel,
                          selected ? styles.kindChipLabelSelected : null,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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

              {kind === "meeting" || meetLink ? (
                <>
                  <Text style={styles.fieldLabel}>Meeting Link</Text>
                  <AppTextField
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="https://meet.jit.si/... or https://meet.google.com/..."
                    value={meetLink}
                    onChangeText={(next) => {
                      setMeetLink(next);
                      setFormError(null);
                      setSaveMessage(null);
                    }}
                    editable={!isSaving && !isDeleting}
                    placeholderTextColor="#94A3B8"
                    selectionColor="#1D4ED8"
                    style={styles.input}
                  />
                </>
              ) : null}
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
              <View style={styles.leadTimeHeader}>
                <Text style={styles.fieldLabel}>Pre-Reminders (Lead Times)</Text>
                <Text style={styles.leadTimeHint}>Early alerts before start time</Text>
              </View>

              {leadTimes.length > 0 ? (
                <View style={styles.leadChipsWrap}>
                  {leadTimes.map((mins) => (
                    <View key={mins} style={styles.leadChip}>
                      <Text style={styles.leadChipIcon}>🔔</Text>
                      <Text style={styles.leadChipLabel}>{formatLeadTime(mins)} before</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${formatLeadTime(mins)} alert`}
                        disabled={isSaving || isDeleting}
                        onPress={() => removeLeadTime(mins)}
                        style={styles.leadChipRemove}
                      >
                        <Text style={styles.leadChipRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noLeadTimesText}>
                  No pre-alerts set · notification fires only at scheduled time
                </Text>
              )}

              <Text style={styles.quickAddLabel}>Quick Add:</Text>
              <View style={styles.quickAddRow}>
                {[5, 15, 30, 60, 120, 1440].map((mins) => {
                  const alreadyAdded = leadTimes.includes(mins);
                  return (
                    <Pressable
                      key={mins}
                      accessibilityRole="button"
                      disabled={isSaving || isDeleting || alreadyAdded}
                      onPress={() => addLeadTime(mins)}
                      style={({ pressed }) => [
                        styles.quickAddChip,
                        alreadyAdded ? styles.quickAddChipDisabled : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.quickAddChipText,
                          alreadyAdded ? styles.quickAddChipTextDisabled : null,
                        ]}
                      >
                        +{formatLeadTime(mins)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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
        )
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
  meetingCard: {
    gap: spacing.md,
    padding: spacing.md + 2,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#EFF6FF",
    borderWidth: 1.5,
    borderColor: "rgba(37, 99, 235, 0.35)",
    boxShadow: shadows.subtle,
  },
  meetingCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  meetingCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  meetingCardIcon: {
    fontSize: 26,
  },
  meetingCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  meetingCardSubtitle: {
    fontSize: 12,
    color: "#3B82F6",
    fontWeight: "500",
  },
  liveBadge: {
    backgroundColor: "#16A34A",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  liveBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  joinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#1D4ED8",
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    boxShadow: shadows.subtle,
  },
  joinButtonIcon: {
    fontSize: 18,
  },
  joinButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  attendeesContainer: {
    gap: spacing.xs + 2,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(37, 99, 235, 0.2)",
  },
  attendeesHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1E40AF",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  attendeeItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.15)",
  },
  attendeeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  attendeeAvatarText: {
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "700",
  },
  attendeeTextContainer: {
    flex: 1,
  },
  attendeeName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  attendeeEmail: {
    fontSize: 11,
    color: "#64748B",
  },
  inviteSentChip: {
    backgroundColor: "rgba(22, 163, 74, 0.1)",
    paddingHorizontal: spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  inviteSentText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#15803D",
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
  kindChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kindChipIcon: {
    fontSize: 14,
  },
  kindChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  kindChipLabelSelected: {
    color: "#FFFFFF",
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
  leadTimeHeader: {
    gap: 2,
  },
  leadTimeHint: {
    fontSize: 12,
    color: "#64748B",
  },
  leadChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 4,
    marginTop: spacing.xs,
  },
  leadChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
  },
  leadChipIcon: {
    fontSize: 13,
  },
  leadChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1D4ED8",
  },
  leadChipRemove: {
    paddingLeft: 4,
    paddingVertical: 2,
  },
  leadChipRemoveText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  noLeadTimesText: {
    fontSize: 13,
    color: "#64748B",
    fontStyle: "italic",
    paddingVertical: spacing.xs,
  },
  quickAddLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: spacing.xs + 2,
  },
  quickAddRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 4,
  },
  quickAddChip: {
    backgroundColor: "rgba(241, 245, 249, 1)",
    borderWidth: 1,
    borderColor: "rgba(203, 213, 225, 0.8)",
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
  },
  quickAddChipDisabled: {
    opacity: 0.4,
  },
  quickAddChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  quickAddChipTextDisabled: {
    color: "#94A3B8",
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
  preMeetingSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 1,
  },
  editModeToggle: {
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  editModeToggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  preMeetingHeroCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#F0F7FF",
    borderWidth: 2,
    borderColor: "rgba(37, 99, 235, 0.35)",
    boxShadow: shadows.subtle,
  },
  preMeetingHeroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preMeetingHeroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  preMeetingHeroBadgeCompleted: {
    backgroundColor: "#E2E8F0",
  },
  preMeetingHeroBadgeDot: {
    fontSize: 10,
    color: "#16A34A",
  },
  preMeetingHeroBadgeDotCompleted: {
    color: "#64748B",
  },
  preMeetingHeroBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#15803D",
  },
  preMeetingHeroBadgeTextCompleted: {
    color: "#475569",
  },
  preMeetingCountdown: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2563EB",
  },
  preMeetingHeroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  preMeetingBigJoinButton: {
    backgroundColor: "#1D4ED8",
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    boxShadow: shadows.subtle,
  },
  preMeetingButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  preMeetingBigJoinContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
  },
  preMeetingCamCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  preMeetingCamIcon: {
    fontSize: 22,
  },
  preMeetingBigJoinText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  preMeetingBigJoinSubtext: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
  },
  preMeetingJoinArrow: {
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  preMeetingLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  preMeetingLinkBox: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm - 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.2)",
  },
  preMeetingLinkText: {
    fontSize: 12,
    color: "#3B82F6",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  preMeetingShareButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.3)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  preMeetingShareText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  preMeetingTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 2,
  },
  preMeetingTimeIcon: {
    fontSize: 20,
  },
  preMeetingTimePrimary: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  preMeetingTimeSecondary: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 1,
  },
  preMeetingAlertsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0, 0, 0, 0.06)",
  },
  preMeetingAlertsIcon: {
    fontSize: 14,
  },
  preMeetingAlertsText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "500",
  },
  preMeetingNotesText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  preMeetingActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  preMeetingCompleteButton: {
    backgroundColor: "#16A34A",
  },
  openHubButton: {
    marginTop: spacing.xs,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  openHubButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1D4ED8",
  },
});
