import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ui/themed-text";
import { colors, motion, radius, spacing } from "@/theme";

type VoicePhase = "idle" | "recording" | "uploading";

type VoicePlanButtonProps = {
  disabled?: boolean;
  onRecorded: (uri: string) => Promise<void>;
  onPermissionDenied: () => void;
  onError: (message: string) => void;
};

/**
 * Tap once to start recording, tap again to stop → parent uploads the file.
 * Requests mic permission on first use (not on mount).
 */
export function VoicePlanButton({
  disabled = false,
  onRecorded,
  onPermissionDenied,
  onError,
}: VoicePlanButtonProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const busyRef = useRef(false);
  const pulse = useSharedValue(1);

  const isRecording = phase === "recording" || recorderState.isRecording;
  const isUploading = phase === "uploading";
  const isBusy = disabled || isUploading;

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.get(),
  }));

  function startPulse() {
    pulse.set(
      withRepeat(
        withTiming(0.55, {
          duration: 700,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
  }

  function stopPulse() {
    pulse.set(withTiming(1, { duration: motion.pressMs }));
  }

  async function startRecording() {
    if (busyRef.current || isBusy) return;
    busyRef.current = true;

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onPermissionDenied();
        return;
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      startPulse();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not start the microphone.";
      onError(message);
      setPhase("idle");
      stopPulse();
    } finally {
      busyRef.current = false;
    }
  }

  async function stopAndUpload() {
    if (busyRef.current) return;
    busyRef.current = true;
    stopPulse();
    setPhase("uploading");

    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        onError("Recording finished but no audio file was saved. Try again.");
        setPhase("idle");
        return;
      }
      await onRecorded(uri);
      setPhase("idle");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not finish voice recording.";
      onError(message);
      setPhase("idle");
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <View style={styles.wrap}>
      <Animated.View style={isRecording ? pulseStyle : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isRecording ? "Stop recording" : "Record voice plan"
          }
          disabled={isBusy && !isRecording}
          onPress={() => {
            if (isRecording) {
              void stopAndUpload();
            } else {
              void startRecording();
            }
          }}
          style={({ pressed }) => [
            styles.button,
            isRecording ? styles.buttonRecording : null,
            pressed ? styles.pressed : null,
            isBusy && !isRecording ? styles.disabled : null,
          ]}
        >
          {isUploading ? (
            <ActivityIndicator color={colors.onTint} />
          ) : (
            <View style={styles.row}>
              {process.env.EXPO_OS === "ios" ? (
                <SymbolView
                  name={isRecording ? "stop.fill" : "mic.fill"}
                  size={18}
                  tintColor={colors.onTint}
                />
              ) : null}
              <Text style={styles.label}>
                {isRecording ? "Stop & plan from voice" : "Record voice plan"}
              </Text>
            </View>
          )}
        </Pressable>
      </Animated.View>
      {isRecording ? (
        <ThemedText variant="caption">
          Listening… tap again when you finish.
        </ThemedText>
      ) : null}
      {isUploading ? (
        <ThemedText variant="caption">
          Transcribing and creating reminders…
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  buttonRecording: {
    backgroundColor: colors.danger,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  label: {
    color: colors.onTint,
    fontSize: 16,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: motion.pressScale }],
  },
  disabled: {
    opacity: 0.55,
  },
});
