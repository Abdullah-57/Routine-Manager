import { SymbolView } from "expo-symbols";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { radius, spacing } from "@/theme";

type AiPlanComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onPressMic: () => void;
  onSubmit: () => void;
  editable: boolean;
  submitting: boolean;
  micDisabled: boolean;
};

/**
 * ChatGPT-style composer: multiline field + mic on the right, submit below.
 */
export function AiPlanComposer({
  value,
  onChangeText,
  onPressMic,
  onSubmit,
  editable,
  submitting,
  micDisabled,
}: AiPlanComposerProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.fieldShell}>
        <TextInput
          accessibilityLabel="Plan or manage text"
          multiline
          placeholder="Ask to create, move, or delete reminders…"
          placeholderTextColor="rgba(30, 58, 138, 0.4)"
          style={styles.input}
          textAlignVertical="top"
          value={value}
          editable={editable}
          onChangeText={onChangeText}
          selectionColor="#2563EB"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record voice plan"
          disabled={micDisabled || !editable}
          onPress={onPressMic}
          style={({ pressed }) => [
            styles.micButton,
            pressed ? styles.pressed : null,
            micDisabled || !editable ? styles.disabled : null,
          ]}
        >
          <View style={styles.micIcon}>
            <SymbolView
              name={{ ios: "mic.fill", android: "mic", web: "mic" }}
              size={22}
              tintColor="#FFFFFF"
              resizeMode="center"
              style={styles.micSymbol}
              fallback={<Text style={styles.micFallback}>🎙️</Text>}
            />
          </View>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!editable || submitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.submit,
          pressed ? styles.pressed : null,
          !editable || submitting ? styles.disabled : null,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitLabel}>Submit</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm + 2,
  },
  fieldShell: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "rgba(37, 99, 235, 0.28)",
    minHeight: 112,
  },
  input: {
    flex: 1,
    minHeight: 88,
    maxHeight: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 16,
    lineHeight: 22,
    color: "#0F172A",
    fontWeight: "500",
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    marginBottom: 2,
  },
  micIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  micSymbol: {
    width: 22,
    height: 22,
    transform: [{ translateX: 2 }, { translateY: 3 }],
  },
  micFallback: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  submit: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "#1D4ED8",
  },
  submitLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.55,
  },
});
