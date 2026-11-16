import * as Haptics from "expo-haptics";
import React, { useEffect, useRef } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReminderSummary } from "@/api/reminders";
import { colors, radius, shadows, spacing } from "@/theme";

export type AssistantPhase =
  | "listening"
  | "thinking"
  | "responding"
  | "follow_up"
  | "done"
  | "error";

export type AssistantOverlayProps = {
  visible: boolean;
  phase: AssistantPhase;
  liveTranscript: string;
  assistantMessage: string;
  errorMessage?: string | null;
  createdReminders?: ReminderSummary[];
  isTtsSpeaking: boolean;
  followUpWakeDetected?: boolean;
  spokenFeedbackEnabled: boolean;
  onToggleSpokenFeedback: () => void;
  onStopSpeaking: () => void;
  onDone: () => void;
  onClose: () => void;
};

/**
 * Animated voice orb with concentric pulse rings and audio wave indicators.
 * Strictly animates transform and opacity on the UI thread via Reanimated worklets.
 */
function VoiceOrb({
  phase,
  isTtsSpeaking,
  followUpWakeDetected,
}: {
  phase: AssistantPhase;
  isTtsSpeaking: boolean;
  followUpWakeDetected?: boolean;
}) {
  const pulseRing1 = useSharedValue(1);
  const pulseRing2 = useSharedValue(1);
  const opacityRing1 = useSharedValue(0.4);
  const opacityRing2 = useSharedValue(0.2);

  const waveBar1 = useSharedValue(0.4);
  const waveBar2 = useSharedValue(0.8);
  const waveBar3 = useSharedValue(0.5);
  const waveBar4 = useSharedValue(0.9);

  useEffect(() => {
    if (phase === "listening") {
      // Gentle breathing pulse
      pulseRing1.value = withRepeat(
        withSequence(
          withTiming(1.22, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
      opacityRing1.value = withRepeat(
        withSequence(
          withTiming(0.65, { duration: 900 }),
          withTiming(0.25, { duration: 900 }),
        ),
        -1,
        true,
      );

      pulseRing2.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.05, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
      opacityRing2.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 1100 }),
          withTiming(0.1, { duration: 1100 }),
        ),
        -1,
        true,
      );
    } else if (phase === "thinking") {
      // Fast thinking pulse
      pulseRing1.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 400 }),
          withTiming(1.0, { duration: 400 }),
        ),
        -1,
        true,
      );
      pulseRing2.value = withRepeat(
        withSequence(
          withTiming(1.28, { duration: 500 }),
          withTiming(1.02, { duration: 500 }),
        ),
        -1,
        true,
      );
    } else {
      pulseRing1.value = withTiming(1.0, { duration: 300 });
      pulseRing2.value = withTiming(1.0, { duration: 300 });
      opacityRing1.value = withTiming(0.2, { duration: 300 });
      opacityRing2.value = withTiming(0.05, { duration: 300 });
    }
  }, [phase, opacityRing1, opacityRing2, pulseRing1, pulseRing2]);

  // Audio wave bounce during TTS playback
  useEffect(() => {
    if (isTtsSpeaking) {
      waveBar1.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: 220 }),
          withTiming(0.3, { duration: 220 }),
        ),
        -1,
        true,
      );
      waveBar2.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 280 }),
          withTiming(1.0, { duration: 280 }),
        ),
        -1,
        true,
      );
      waveBar3.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: 250 }),
          withTiming(0.4, { duration: 250 }),
        ),
        -1,
        true,
      );
      waveBar4.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 310 }),
          withTiming(1.0, { duration: 310 }),
        ),
        -1,
        true,
      );
    } else {
      waveBar1.value = withTiming(0.3, { duration: 200 });
      waveBar2.value = withTiming(0.5, { duration: 200 });
      waveBar3.value = withTiming(0.4, { duration: 200 });
      waveBar4.value = withTiming(0.6, { duration: 200 });
    }
  }, [isTtsSpeaking, waveBar1, waveBar2, waveBar3, waveBar4]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulseRing1.value }],
    opacity: opacityRing1.value,
  }));

  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulseRing2.value }],
    opacity: opacityRing2.value,
  }));

  const bar1Style = useAnimatedStyle(() => ({
    transform: [{ scaleY: waveBar1.value }],
  }));
  const bar2Style = useAnimatedStyle(() => ({
    transform: [{ scaleY: waveBar2.value }],
  }));
  const bar3Style = useAnimatedStyle(() => ({
    transform: [{ scaleY: waveBar3.value }],
  }));
  const bar4Style = useAnimatedStyle(() => ({
    transform: [{ scaleY: waveBar4.value }],
  }));

  let orbIcon = "🎙️";
  if (followUpWakeDetected) orbIcon = "✨";
  else if (phase === "thinking") orbIcon = "✨";
  else if (phase === "responding" || isTtsSpeaking) orbIcon = "🔊";
  else if (phase === "done") orbIcon = "✓";
  else if (phase === "error") orbIcon = "⚠️";

  const isGreen = followUpWakeDetected || (phase === "listening" && !isTtsSpeaking);

  return (
    <View style={orbStyles.container}>
      <Animated.View
        style={[
          orbStyles.ring,
          orbStyles.ring2,
          isGreen ? orbStyles.ringListeningGreen : null,
          ring2Style,
        ]}
      />
      <Animated.View
        style={[
          orbStyles.ring,
          orbStyles.ring1,
          isGreen ? orbStyles.ringListeningGreen : null,
          ring1Style,
        ]}
      />

      <View
        style={[
          orbStyles.core,
          isGreen ? orbStyles.coreListeningGreen : null,
          phase === "thinking" ? orbStyles.coreThinking : null,
          phase === "done" ? orbStyles.coreDone : null,
          phase === "error" ? orbStyles.coreError : null,
        ]}
      >
        {isTtsSpeaking ? (
          <View style={orbStyles.waveContainer}>
            <Animated.View style={[orbStyles.waveBar, bar1Style]} />
            <Animated.View style={[orbStyles.waveBar, bar2Style]} />
            <Animated.View style={[orbStyles.waveBar, bar3Style]} />
            <Animated.View style={[orbStyles.waveBar, bar4Style]} />
          </View>
        ) : (
          <Text style={orbStyles.icon}>{orbIcon}</Text>
        )}
      </View>
    </View>
  );
}

export function AssistantOverlay({
  visible,
  phase,
  liveTranscript,
  assistantMessage,
  errorMessage,
  createdReminders = [],
  isTtsSpeaking,
  followUpWakeDetected,
  spokenFeedbackEnabled,
  onToggleSpokenFeedback,
  onStopSpeaking,
  onDone,
  onClose,
}: AssistantOverlayProps) {
  const insets = useSafeAreaInsets();
  const cardTranslateY = useSharedValue(100);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      cardTranslateY.value = withTiming(0, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      });
      cardOpacity.value = withTiming(1, { duration: 240 });
    } else {
      cardTranslateY.value = withTiming(80, { duration: 200 });
      cardOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [visible, cardOpacity, cardTranslateY]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardTranslateY.value }],
    opacity: cardOpacity.value,
  }));

  if (!visible) return null;

  let headline = "Listening...";
  let subheadline =
    "Speak naturally, e.g. 'Gym at 7am and lunch with Alex at 1pm'";

  if (phase === "listening") {
    headline = "🟢 I'm listening!";
    if (followUpWakeDetected) {
      subheadline = "Heard “Hey Assistant”! Speak your routine now...";
    } else if (assistantMessage) {
      subheadline =
        "Speak your next routine or reminder, or say 'Done'";
    } else {
      subheadline =
        "Speak naturally, e.g. 'Gym at 7am and lunch with Alex at 1pm'";
    }
  } else if (phase === "thinking") {
    headline = "Planning your day...";
    subheadline = "Converting your spoken routine into reminders";
  } else if (phase === "responding") {
    headline = isTtsSpeaking ? "Assistant speaking..." : "Routine scheduled";
    subheadline = isTtsSpeaking
      ? "Reading your confirmation aloud"
      : "Spoken confirmation";
  } else if (phase === "follow_up") {
    headline = "Anything else?";
    subheadline =
      "Say another routine, say “Hey Assistant”, or say “Done” to finish";
  } else if (phase === "done") {
    headline = "All done!";
    subheadline = "Your routines are all set";
  } else if (phase === "error") {
    headline = "Couldn't complete routine";
    subheadline = errorMessage || "Please try speaking again";
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropDismiss} onPress={onClose} />

        <Animated.View
          style={[
            styles.card,
            { paddingBottom: Math.max(insets.bottom, 20) },
            animatedCardStyle,
          ]}
        >
          {/* Top Header Bar */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.statusDot} />
              <Text style={styles.brandTitle}>Quiet Assistant</Text>
            </View>

            <View style={styles.headerRight}>
              {/* Spoken TTS Mute/Unmute Toggle */}
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  if (isTtsSpeaking) {
                    onStopSpeaking();
                  }
                  onToggleSpokenFeedback();
                }}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed ? styles.iconButtonPressed : null,
                ]}
                hitSlop={8}
                accessibilityLabel={
                  spokenFeedbackEnabled ? "Mute Spoken Feedback" : "Enable Spoken Feedback"
                }
              >
                <Text style={styles.iconButtonText}>
                  {spokenFeedbackEnabled ? "🔊" : "🔇"}
                </Text>
              </Pressable>

              {/* Close Button */}
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.iconButton,
                  styles.closeButton,
                  pressed ? styles.iconButtonPressed : null,
                ]}
                hitSlop={8}
                accessibilityLabel="Close Assistant"
              >
                <Text style={styles.closeIconText}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* Central Animated Orb */}
          <View style={styles.orbSection}>
            <VoiceOrb
              phase={phase}
              isTtsSpeaking={isTtsSpeaking}
              followUpWakeDetected={followUpWakeDetected}
            />
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.subheadline}>{subheadline}</Text>

            {/* Clear Visual Readiness Pill */}
            {phase === "listening" && !isTtsSpeaking ? (
              <View style={styles.activePillGreen}>
                <View style={styles.activePillDotGreen} />
                <Text style={styles.activePillTextGreen}>
                  {assistantMessage
                    ? "🟢 Listening · Say your next routine or “Done”"
                    : followUpWakeDetected
                      ? "✨ Ready! Speak your routine now"
                      : "🟢 Microphone active · Listening for your routine..."}
                </Text>
              </View>
            ) : followUpWakeDetected && !isTtsSpeaking ? (
              <View style={styles.activePillGreen}>
                <View style={styles.activePillDotGreen} />
                <Text style={styles.activePillTextGreen}>
                  ✨ Ready! Speak your routine now
                </Text>
              </View>
            ) : phase === "follow_up" ? (
              <View style={styles.activePillCyan}>
                <View style={styles.activePillDotCyan} />
                <Text style={styles.activePillTextCyan}>
                  Microphone active · Say your routine or “Hey Assistant”
                </Text>
              </View>
            ) : null}
          </View>

          {/* Live Transcript / Response Scroll Area */}
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.contentScrollInner}
            showsVerticalScrollIndicator={false}
          >
            {/* Live Streaming Speech Transcript */}
            {liveTranscript ? (
              <View style={styles.transcriptBubble}>
                <Text style={styles.transcriptLabel}>Heard you say:</Text>
                <Text style={styles.transcriptText}>“{liveTranscript}”</Text>
              </View>
            ) : null}

            {/* Assistant Spoken Response / Message */}
            {assistantMessage ? (
              <View style={styles.responseBubble}>
                <View style={styles.responseHeader}>
                  <Text style={styles.responseTag}>Assistant</Text>
                  {isTtsSpeaking ? (
                    <Pressable
                      onPress={onStopSpeaking}
                      style={styles.stopTtsButton}
                    >
                      <Text style={styles.stopTtsText}>Stop audio ⏹</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.responseText}>{assistantMessage}</Text>
              </View>
            ) : null}

            {/* Created / Scheduled Reminder Chips */}
            {createdReminders.length > 0 ? (
              <View style={styles.remindersContainer}>
                <Text style={styles.remindersHeader}>
                  Session Reminders ({createdReminders.length}):
                </Text>
                <View style={styles.chipGrid}>
                  {createdReminders.map((reminder) => {
                    const isCancelled = reminder.status === "cancelled";
                    const isMeeting =
                      reminder.kind === "meeting" ||
                      Boolean(reminder.action?.meetLink);
                    const isCall = reminder.kind === "call";
                    const meetLink = reminder.action?.meetLink;
                    const emoji = isCancelled
                      ? "🚫"
                      : isMeeting
                        ? "🎥"
                        : isCall
                          ? "📞"
                          : "⏰";

                    return (
                      <Pressable
                        key={reminder.id}
                        disabled={!meetLink}
                        onPress={() => {
                          if (meetLink) {
                            void Linking.openURL(meetLink).catch(() => {});
                          }
                        }}
                        style={[
                          styles.reminderChip,
                          isCancelled ? styles.reminderChipCancelled : null,
                          isMeeting ? styles.reminderChipMeeting : null,
                        ]}
                      >
                        <Text style={styles.chipEmoji}>{emoji}</Text>
                        <View style={styles.chipTextContainer}>
                          <Text
                            style={[
                              styles.chipTitle,
                              isCancelled ? styles.chipTitleCancelled : null,
                            ]}
                            numberOfLines={1}
                          >
                            {reminder.title}
                          </Text>
                          <View style={styles.chipMetaRow}>
                            <Text style={styles.chipTime}>
                              {isCancelled
                                ? "Cancelled"
                                : new Date(reminder.startAt).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                            </Text>
                            {meetLink ? (
                              <View style={styles.meetLinkBadge}>
                                <Text style={styles.meetLinkBadgeText}>Tap to Join</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Follow-up / Suggestions prompt */}
            {phase === "follow_up" ? (
              <View style={styles.followUpCard}>
                <Text style={styles.followUpPrompt}>
                  👉 Say another reminder to add it hands-free, or say{" "}
                  <Text style={styles.followUpBold}>“Done”</Text> to finish.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom Action Footer */}
          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                  () => {},
                );
                onDone();
              }}
              style={({ pressed }) => [
                styles.doneButton,
                pressed ? styles.doneButtonPressed : null,
              ]}
            >
              <Text style={styles.doneButtonText}>
                {phase === "done" ? "Close" : "Done / Finish"}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const orbStyles = StyleSheet.create({
  container: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  ring: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: colors.tint,
  },
  ringListeningGreen: {
    backgroundColor: "#10B981",
  },
  ring1: {
    width: 82,
    height: 82,
  },
  ring2: {
    width: 96,
    height: 96,
  },
  core: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tint,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  coreListeningGreen: {
    backgroundColor: "#10B981",
  },
  coreThinking: {
    backgroundColor: "#0284C7", // Cyan / ocean
  },
  coreDone: {
    backgroundColor: colors.success,
  },
  coreError: {
    backgroundColor: colors.danger,
  },
  icon: {
    fontSize: 26,
    color: "#FFFFFF",
  },
  waveContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 24,
  },
  waveBar: {
    width: 4,
    height: 20,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  backdropDismiss: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    maxHeight: "82%",
    elevation: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tint,
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: colors.secondaryLabel,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPressed: {
    opacity: 0.7,
  },
  iconButtonText: {
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: colors.fill,
  },
  closeIconText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.secondaryLabel,
  },
  orbSection: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.sm,
  },
  headline: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.label,
    textAlign: "center",
    marginBottom: 4,
  },
  subheadline: {
    fontSize: 13,
    color: colors.secondaryLabel,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  activePillGreen: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "#10B981",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
    gap: 6,
  },
  activePillDotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  activePillTextGreen: {
    fontSize: 12,
    fontWeight: "700",
    color: "#047857",
  },
  activePillCyan: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 118, 110, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(15, 118, 110, 0.3)",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
    gap: 6,
  },
  activePillDotCyan: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tint,
  },
  activePillTextCyan: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.tint,
  },
  contentScroll: {
    maxHeight: 220,
    marginTop: spacing.md,
  },
  contentScrollInner: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  transcriptBubble: {
    backgroundColor: colors.fill,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.tint,
  },
  transcriptLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.tertiaryLabel,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  transcriptText: {
    fontSize: 15,
    fontStyle: "italic",
    color: colors.label,
    lineHeight: 20,
  },
  responseBubble: {
    backgroundColor: Platform.select({
      ios: "rgba(15, 118, 110, 0.08)",
      android: "rgba(15, 118, 110, 0.08)",
      default: "#E6F4F1",
    }),
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(15, 118, 110, 0.2)",
  },
  responseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  responseTag: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.tint,
    textTransform: "uppercase",
  },
  stopTtsButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  stopTtsText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.tint,
  },
  responseText: {
    fontSize: 14,
    color: colors.label,
    lineHeight: 20,
  },
  remindersContainer: {
    marginTop: spacing.xs,
  },
  remindersHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.secondaryLabel,
    marginBottom: spacing.xs,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  reminderChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    gap: 6,
  },
  reminderChipCancelled: {
    opacity: 0.6,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  reminderChipMeeting: {
    backgroundColor: "rgba(15, 118, 110, 0.12)",
    borderColor: "rgba(15, 118, 110, 0.25)",
    borderWidth: 1,
  },
  chipMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  meetLinkBadge: {
    backgroundColor: colors.tint,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  meetLinkBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipTextContainer: {
    flexDirection: "column",
  },
  chipTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.label,
    maxWidth: 160,
  },
  chipTitleCancelled: {
    textDecorationLine: "line-through",
    color: colors.secondaryLabel,
  },
  chipTime: {
    fontSize: 11,
    color: colors.secondaryLabel,
  },
  followUpCard: {
    backgroundColor: colors.fill,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  followUpPrompt: {
    fontSize: 12,
    color: colors.secondaryLabel,
    textAlign: "center",
    lineHeight: 18,
  },
  followUpBold: {
    fontWeight: "700",
    color: colors.label,
  },
  footer: {
    paddingTop: spacing.md,
  },
  doneButton: {
    backgroundColor: colors.tint,
    borderRadius: radius.full,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButtonPressed: {
    opacity: 0.85,
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onTint,
  },
});
