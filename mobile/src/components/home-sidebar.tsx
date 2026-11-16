import { Host, Switch } from "@expo/ui";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { getGoogleStatus, type GoogleStatusResponse } from "@/api/integrations";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "@/components/ui/app-button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import type { WakeSensitivity } from "@/preferences/app-preferences";
import { radius, shadows, spacing } from "@/theme";

type ToolState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type HomeSidebarProps = {
  visible: boolean;
  onClose: () => void;
  microphoneEnabled: boolean;
  pushNotificationsEnabled: boolean;
  use24HourClock: boolean;
  assistantEnabled: boolean;
  wakePhrase: string;
  wakeSensitivity: WakeSensitivity;
  isAssistantListening?: boolean;
  spokenFeedbackEnabled?: boolean;
  onToggleMicrophone: (value: boolean) => void;
  onTogglePush: (value: boolean) => void;
  onToggle24Hour: (value: boolean) => void;
  onToggleAssistant: (value: boolean) => void;
  onChangeWakeSensitivity: (value: WakeSensitivity) => void;
  onToggleSpokenFeedback?: (value: boolean) => void;
  ping: ToolState;
  testPush: ToolState;
  onPing: () => void;
  onTestPush: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
};

function SettingRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Host matchContents seedColor="#2563EB">
        <Switch value={value} onValueChange={onValueChange} />
      </Host>
    </View>
  );
}

export function HomeSidebar({
  visible,
  onClose,
  microphoneEnabled,
  pushNotificationsEnabled,
  use24HourClock,
  assistantEnabled,
  wakePhrase,
  wakeSensitivity,
  isAssistantListening = false,
  spokenFeedbackEnabled = true,
  onToggleMicrophone,
  onTogglePush,
  onToggle24Hour,
  onToggleAssistant,
  onChangeWakeSensitivity,
  onToggleSpokenFeedback,
  ping,
  testPush,
  onPing,
  onTestPush,
  onLogout,
  isLoggingOut,
}: HomeSidebarProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const router = useRouter();
  const { token } = useAuth();
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusResponse | null>(null);

  useEffect(() => {
    if (visible && token) {
      void getGoogleStatus(token)
        .then((res) => setGoogleStatus(res))
        .catch(() => undefined);
    }
  }, [visible, token]);

  useEffect(() => {
    progress.set(
      withTiming(visible ? 1 : 0, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [progress, visible]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.get()) * -320 }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * 0.45,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.scrim, scrimStyle]} />
        </Pressable>

        <Animated.View
          style={[
            styles.panel,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: insets.bottom + spacing.md,
            },
            panelStyle,
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.panelContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Quick controls for this device</Text>

            <View style={styles.settingsBlock}>
              <Text style={styles.sectionLabel}>System</Text>
              <SettingRow
                label="Microphone Access"
                value={microphoneEnabled}
                onValueChange={onToggleMicrophone}
              />
              <SettingRow
                label="Push Notifications"
                value={pushNotificationsEnabled}
                onValueChange={onTogglePush}
              />
              <SettingRow
                label="24 hour clock"
                value={use24HourClock}
                onValueChange={onToggle24Hour}
              />

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>Hands-Free Voice Assistant</Text>
              <SettingRow
                label="Wake-Word Activation"
                value={assistantEnabled}
                onValueChange={onToggleAssistant}
              />

              {assistantEnabled ? (
                <View style={styles.assistantDetailsCard}>
                  <View style={styles.assistantStatusRow}>
                    <Text style={styles.phraseLabel}>Detection Status</Text>
                    <View style={styles.statusIndicatorWrapper}>
                      <View
                        style={[
                          styles.statusDot,
                          assistantEnabled && microphoneEnabled
                            ? styles.statusDotActive
                            : styles.statusDotStandby,
                        ]}
                      />
                      <Text style={styles.statusText}>
                        {!assistantEnabled
                          ? "Standby"
                          : !microphoneEnabled
                            ? "Mic Disabled"
                            : "Listening"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.phraseRow}>
                    <Text style={styles.phraseLabel}>Wake Phrase</Text>
                    <Text style={styles.phraseValue}>"{wakePhrase}"</Text>
                  </View>

                  <View style={styles.sensitivityRow}>
                    <Text style={styles.phraseLabel}>Sensitivity</Text>
                    <View style={styles.sensitivityButtonGroup}>
                      {(["low", "medium", "high"] as WakeSensitivity[]).map(
                        (level) => (
                          <Pressable
                            key={level}
                            style={[
                              styles.sensitivityButton,
                              wakeSensitivity === level &&
                                styles.sensitivityButtonActive,
                            ]}
                            onPress={() => onChangeWakeSensitivity(level)}
                          >
                            <Text
                              style={[
                                styles.sensitivityButtonText,
                                wakeSensitivity === level &&
                                  styles.sensitivityButtonTextActive,
                              ]}
                            >
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </Text>
                          </Pressable>
                        ),
                      )}
                    </View>
                  </View>

                  <View style={styles.spokenReplyRow}>
                    <SettingRow
                      label="Speak Confirmations"
                      value={spokenFeedbackEnabled ?? true}
                      onValueChange={onToggleSpokenFeedback ?? (() => {})}
                    />
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.divider} />

            <View style={styles.connectedAccountsBlock}>
              <Text style={styles.sectionLabel}>Connected Accounts</Text>
              <Pressable
                style={styles.accountCard}
                onPress={() => {
                  onClose();
                  router.push("/settings/connections");
                }}
              >
                <View style={styles.accountCardLeft}>
                  <View style={styles.googleIconCircle}>
                    <Text style={styles.googleIconText}>G</Text>
                  </View>
                  <View style={styles.accountCardMeta}>
                    <Text style={styles.accountCardTitle}>Google Account</Text>
                    <Text style={styles.accountCardSubtitle} numberOfLines={1}>
                      {googleStatus?.connected && googleStatus.integration
                        ? googleStatus.integration.email
                        : "Contacts & meeting invites"}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.accountPill,
                    googleStatus?.connected
                      ? styles.accountPillConnected
                      : styles.accountPillDisconnected,
                  ]}
                >
                  <View
                    style={[
                      styles.accountDot,
                      googleStatus?.connected
                        ? styles.accountDotConnected
                        : styles.accountDotDisconnected,
                    ]}
                  />
                  <Text
                    style={[
                      styles.accountPillText,
                      googleStatus?.connected
                        ? styles.accountPillTextConnected
                        : styles.accountPillTextDisconnected,
                    ]}
                  >
                    {googleStatus?.connected ? "Linked" : "Link"}
                  </Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.divider} />

            <View style={styles.toolsBlock}>
              <Text style={styles.sectionLabel}>Developer tools</Text>
              <AppButton
                label="Ping API"
                variant="secondary"
                loading={ping.status === "loading"}
                onPress={onPing}
              />
              {ping.status === "success" ? (
                <FeedbackBanner
                  tone="success"
                  title="Success"
                  body={ping.message}
                />
              ) : null}
              {ping.status === "error" ? (
                <FeedbackBanner tone="error" title="Error" body={ping.message} />
              ) : null}

              <AppButton
                label="Send test push"
                variant="secondary"
                loading={testPush.status === "loading"}
                onPress={onTestPush}
              />
              {testPush.status === "success" ? (
                <FeedbackBanner
                  tone="success"
                  title="Test push"
                  body={testPush.message}
                />
              ) : null}
              {testPush.status === "error" ? (
                <FeedbackBanner
                  tone="error"
                  title="Test push error"
                  body={testPush.message}
                />
              ) : null}
            </View>

            <View style={styles.spacer} />

            <View style={styles.divider} />

            <AppButton
              label="Log out"
              variant="danger"
              loading={isLoggingOut}
              onPress={onLogout}
            />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#0F172A",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "82%",
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    boxShadow: shadows.raised,
  },
  panelContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 14,
    color: "#1E293B",
    marginBottom: spacing.sm,
  },
  settingsBlock: {
    gap: spacing.sm,
  },
  toolsBlock: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "#F8FAFC",
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  assistantDetailsCard: {
    backgroundColor: "#F1F5F9",
    borderRadius: radius.md,
    borderCurve: "continuous",
    padding: spacing.sm + 2,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  assistantStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusIndicatorWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotActive: {
    backgroundColor: "#16A34A",
  },
  statusDotStandby: {
    backgroundColor: "#EAB308",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
  },
  phraseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  phraseLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  phraseValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2563EB",
  },
  sensitivityRow: {
    gap: 6,
  },
  sensitivityButtonGroup: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: "#E2E8F0",
    padding: 3,
    borderRadius: radius.sm,
  },
  sensitivityButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: 6,
  },
  sensitivityButtonActive: {
    backgroundColor: "#FFFFFF",
    boxShadow: shadows.subtle,
  },
  sensitivityButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  sensitivityButtonTextActive: {
    color: "#0F172A",
    fontWeight: "700",
  },
  spokenReplyRow: {
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  divider: {
    height: 2,
    backgroundColor: "#94A3B8",
    marginVertical: spacing.md,
    borderRadius: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#0F172A",
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  connectedAccountsBlock: {
    gap: spacing.xs,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  accountCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    marginRight: spacing.xs,
  },
  googleIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#EA4335",
    alignItems: "center",
    justifyContent: "center",
  },
  googleIconText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  accountCardMeta: {
    flex: 1,
  },
  accountCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  accountCardSubtitle: {
    fontSize: 11,
    color: "#64748B",
  },
  accountPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 4,
  },
  accountPillConnected: {
    backgroundColor: "#DCFCE7",
  },
  accountPillDisconnected: {
    backgroundColor: "#F1F5F9",
  },
  accountDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  accountDotConnected: {
    backgroundColor: "#16A34A",
  },
  accountDotDisconnected: {
    backgroundColor: "#94A3B8",
  },
  accountPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  accountPillTextConnected: {
    color: "#15803D",
  },
  accountPillTextDisconnected: {
    color: "#475569",
  },
  spacer: {
    flexGrow: 1,
    minHeight: spacing.lg,
  },
});
