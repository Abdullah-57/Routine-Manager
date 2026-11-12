import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { spacing } from "@/theme";

const BAR_COUNT = 28;
const MIN_BAR_HEIGHT = 8;
const MAX_BAR_HEIGHT = 64;
const TICK_MS = 80;

type VoiceWaveformProps = {
  /** Normalized 0–1 level from recorder metering (or fallback animation). */
  level: number;
  active: boolean;
};

/**
 * How much of the wave each bar carries. Speech energy is mid-dominant, so the
 * center bars grow the most and the edges follow quieter — like a spectrum.
 */
function bandWeight(index: number): number {
  const center = (BAR_COUNT - 1) / 2;
  return 1 - (Math.abs(index - center) / center) * 0.75;
}

const MIN_TARGETS = Array.from({ length: BAR_COUNT }, () => MIN_BAR_HEIGHT);

const WaveBar = memo(function WaveBar({ target }: { target: number }) {
  const height = useSharedValue(MIN_BAR_HEIGHT);

  useEffect(() => {
    height.set(withTiming(target, { duration: 70 }));
  }, [height, target]);

  const style = useAnimatedStyle(() => ({
    height: height.get(),
  }));

  return <Animated.View style={[styles.bar, style]} />;
});

/**
 * Bar waveform driven by mic metering. expo-audio's recorder only exposes
 * loudness (dB metering), so:
 * - intensity: fast-attack / slow-decay envelope on the level, so bars pop
 *   when speech starts and settle naturally between words;
 * - pitch / timbre: rolling per-bar harmonics modulate each bar at its own
 *   rate over the band curve, so the shape keeps shifting with the voice
 *   instead of moving as one block.
 * Re-renders on a short interval while active; bars animate to their targets.
 */
export function VoiceWaveform({ level, active }: VoiceWaveformProps) {
  const [targets, setTargets] = useState<number[]>(MIN_TARGETS);
  const levelRef = useRef(level);
  const envelopeRef = useRef(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    if (!active) {
      envelopeRef.current = 0;
      return;
    }

    const id = setInterval(() => {
      // Fast attack, slow decay on the raw metering level.
      envelopeRef.current = Math.max(
        levelRef.current,
        envelopeRef.current * 0.7,
      );
      phaseRef.current += TICK_MS / 1000;

      setTargets(
        Array.from({ length: BAR_COUNT }, (_, index) => {
          const band = bandWeight(index);
          const harmonic =
            0.6 +
            0.4 * Math.sin(phaseRef.current * (2.4 + band * 3.2) + index * 0.55);
          const height =
            MIN_BAR_HEIGHT +
            envelopeRef.current *
              band *
              harmonic *
              (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
          return Math.min(MAX_BAR_HEIGHT, Math.max(MIN_BAR_HEIGHT, height));
        }),
      );
    }, TICK_MS);

    return () => clearInterval(id);
  }, [active]);

  // While inactive, bars rest at the minimum height.
  const shown = active ? targets : MIN_TARGETS;

  return (
    <View style={styles.row}>
      {shown.map((target, index) => (
        <WaveBar key={index} target={target} />
      ))}
    </View>
  );
}

/** Convert expo-audio metering (approx dB) into 0–1. */
export function normalizeMetering(metering: number | undefined): number {
  if (typeof metering !== "number" || Number.isNaN(metering)) {
    return 0.28;
  }
  // Typical speech sits roughly between -50 and -10 dB.
  return Math.min(1, Math.max(0.08, (metering + 55) / 45));
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  bar: {
    width: 4,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
});
