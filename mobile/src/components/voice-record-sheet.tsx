import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { AudioRecorder } from "expo-audio";
import { BottomSheet, Button, Column } from "@expo/ui";
import { useCallback, useEffect, useRef } from "react";
import {
  Dimensions,
  Platform,
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
/** Max time to wait for expo-audio's stop() before continuing without it. */
const STOP_SETTLE_MS = 1200;

/**
 * The red tint only applies to the native iOS button (SwiftUI). It is loaded
 * lazily so Android/web never touch the Swift-UI modifier module.
 */
function stopButtonModifiers() {
  if (Platform.OS !== "ios") return [];
  const { tint } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy-load keeps Android/web away from Swift-UI-only modifiers
    require("@expo/ui/swift-ui/modifiers") as typeof import("@expo/ui/swift-ui/modifiers");
  return [tint("#DC2626")];
}

/**
 * Owns the metering polling. Its 80ms updates re-render only this subtree —
 * never the sheet content around it. A constantly re-driven native sheet
 * swallows touches on its hosted content, which is why the Stop button
 * appeared dead while the waveform was running.
 */
function RecordingWaveform({
  recorder,
  presented,
}: {
  recorder: AudioRecorder;
  presented: boolean;
}) {
  const recorderState = useAudioRecorderState(recorder, 80);
  const level = normalizeMetering(recorderState.metering);

  return (
    <View style={styles.waveWrap}>
      <VoiceWaveform
        level={level}
        active={recorderState.isRecording || presented}
      />
    </View>
  );
}

/**
 * Bottom sheet with live waveform while recording.
 * Stop → returns audio URI to parent (parent transcribes into the text field).
 *
 * Stop is the native @expo/ui Button placed directly inside the sheet, not a
 * React Native Pressable: touches on RN-hosted content inside the native
 * sheet were not registering, while native controls keep their own native
 * touch path.
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
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const startedRef = useRef(false);

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
    // Insurance: never carry a stuck stop guard into a new presentation.
    stoppingRef.current = false;

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

  const handleStop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    try {
      try {
        if (recorder.isRecording) {
          // Known expo-audio quirk: stop() can hang or reject while recorder
          // status is being polled, which made the Stop button do nothing.
          // Race it so the flow always continues.
          await Promise.race([
            recorder.stop(),
            new Promise((resolve) => setTimeout(resolve, STOP_SETTLE_MS)),
          ]);
        }
      } catch {
        // stop() may reject if the recorder already stopped — the file can
        // still be usable, so fall through and try the uri.
      }

      // If stop() is slow to finalize the file, give it a short grace period.
      let uri = recorder.uri;
      for (let attempt = 0; !uri && attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        uri = recorder.uri;
      }

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
  }, [onDismiss, onError, onRecorded, recorder]);

  const handleStopPress = useCallback(() => {
    void handleStop();
  }, [handleStop]);

  async function handleDismiss() {
    if (stoppingRef.current) {
      onDismiss();
      return;
    }
    try {
      if (recorder.isRecording) {
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

        <RecordingWaveform recorder={recorder} presented={isPresented} />
      </View>

      <Column alignment="center" style={styles.buttonRow}>
        <Button
          label="Stop"
          variant="filled"
          onPress={handleStopPress}
          style={styles.stopButton}
          modifiers={stopButtonModifiers()}
        />
      </Column>
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
    paddingBottom: spacing.lg,
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
  buttonRow: {
    width: SHEET_WIDTH,
  },
  stopButton: {
    width: SHEET_WIDTH - spacing.lg * 2,
    height: 52,
    borderRadius: radius.md,
  },
});
