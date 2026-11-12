import { Host, Switch } from "@expo/ui";
import { useEffect } from "react";
import {
  Modal,
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
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "@/components/ui/app-button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
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
  onToggleMicrophone: (value: boolean) => void;
  onTogglePush: (value: boolean) => void;
  onToggle24Hour: (value: boolean) => void;
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
  onToggleMicrophone,
  onTogglePush,
  onToggle24Hour,
  ping,
  testPush,
  onPing,
  onTestPush,
  onLogout,
  isLoggingOut,
}: HomeSidebarProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

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
  spacer: {
    flexGrow: 1,
    minHeight: spacing.lg,
  },
});
