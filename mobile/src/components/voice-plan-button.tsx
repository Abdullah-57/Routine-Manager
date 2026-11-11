import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

  const isRecording = phase === "recording" || recorderState.isRecording;
  const isUploading = phase === "uploading";
  const isBusy = disabled || isUploading;

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
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not start the microphone.";
      onError(message);
      setPhase("idle");
    } finally {
      busyRef.current = false;
    }
  }

  async function stopAndUpload() {
    if (busyRef.current) return;
    busyRef.current = true;
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
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.label}>
            {isRecording ? "Stop & plan from voice" : "Record voice plan"}
          </Text>
        )}
      </Pressable>
      {isRecording ? (
        <Text style={styles.hint}>Listening… tap again when you finish.</Text>
      ) : null}
      {isUploading ? (
        <Text style={styles.hint}>
          Transcribing and creating reminders…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonRecording: {
    backgroundColor: "#b91c1c",
  },
  label: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  hint: {
    color: "#525252",
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.7,
  },
});
