import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { BottomSheet } from "@expo/ui";
import { useEffect, useRef } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  VoiceWaveform,
  normalizeMetering,
} from "@/components/voice-waveform";
import { radius, spacing } from "@/theme";

type VoiceRecordSheetProps = {
  isPresented: boolean;
  onDismiss: () => void;
  onRecorded: (uri: string) => Promise<void>;
  onPermissionDenied: () => void;
  onError: (message: string) => void;
};

const SHEET_WIDTH = Dimensions.get("window").width;

/**
 * Bottom sheet with live waveform while recording.
 * Stop → returns audio URI to parent (parent transcribes into the text field).
 *
 * Important: BottomSheet children are React Native views. Nesting another
 * @expo/ui Host/Button inside collapses into a tiny misaligned control and
 * often ignores presses — so Stop is a full-width RN Pressable.
 */
export function VoiceRecordSheet({
  isPresented,
  onDismiss,
  onRecorded,
  onPermissionDenied,
  onError,
}: VoiceRecordSheetProps) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 80);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const startedRef = useRef(false);

  const isRecording = recorderState.isRecording;
  const level = normalizeMetering(recorderState.metering);

  useEffect(() => {
    if (!isPresented) {
      startedRef.current = false;
      startingRef.current = false;
      stoppingRef.current = false;
      return;
    }
    if (startedRef.current || startingRef.current) return;
    startedRef.current = true;
    startingRef.current = true;

    void (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          onPermissionDenied();
          onDismiss();
          return;
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });

        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not start the microphone.";
        onError(message);
        onDismiss();
      } finally {
        startingRef.current = false;
      }
    })();
  }, [isPresented, onDismiss, onError, onPermissionDenied, recorder]);

  async function handleStop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    try {
      const status = recorder.getStatus();
      if (status.isRecording) {
        await recorder.stop();
      }
      const uri = recorder.uri;
      onDismiss();
      if (!uri) {
        onError("Recording finished but no audio file was saved. Try again.");
        return;
      }
      await onRecorded(uri);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not finish voice recording.";
      onError(message);
      onDismiss();
    } finally {
      stoppingRef.current = false;
    }
  }

  async function handleDismiss() {
    if (stoppingRef.current) {
      onDismiss();
      return;
    }
    try {
      if (recorder.getStatus().isRecording) {
        await recorder.stop();
      }
    } catch {
      // Ignore cancel cleanup errors.
    }
    onDismiss();
  }

  // Do not keep a full-screen Host mounted when the sheet is closed —
  // that overlay steals all taps from Home (avatar, mic, submit, etc.).
  // BottomSheet creates its own Host only while presented.
  if (!isPresented) {
    return null;
  }

  return (
    <BottomSheet
      isPresented={isPresented}
      onDismiss={() => {
        void handleDismiss();
      }}
      snapPoints={["half"]}
      containerColor="#FFFFFF"
      contentPadding={{
        top: spacing.md,
        bottom: spacing.lg,
        left: 0,
        right: 0,
      }}
      shouldDismissOnClickOutside={false}
    >
      <View style={styles.sheetInner}>
        <Text style={styles.title}>Listening…</Text>
        <Text style={styles.caption}>
          Speak your plan. Tap Stop when you’re done — we’ll put the
          transcript in the text field.
        </Text>

        <View style={styles.waveWrap}>
          <VoiceWaveform level={level} active={isRecording || isPresented} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
          hitSlop={12}
          onPress={() => {
            void handleStop();
          }}
          style={({ pressed }) => [
            styles.stopButton,
            pressed ? styles.stopPressed : null,
          ]}
        >
          <Text style={styles.stopLabel}>Stop</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetInner: {
    width: SHEET_WIDTH,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    width: "100%",
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
    textAlign: "center",
  },
  caption: {
    width: "100%",
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
    textAlign: "center",
  },
  waveWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
    paddingVertical: spacing.sm,
  },
  stopButton: {
    width: "100%",
    minHeight: 52,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  stopPressed: {
    opacity: 0.88,
  },
  stopLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
