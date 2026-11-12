import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { spacing } from "@/theme";

const BAR_COUNT = 28;

type VoiceWaveformProps = {
  /** Normalized 0–1 level from recorder metering (or fallback animation). */
  level: number;
  active: boolean;
};

function WaveBar({
  index,
  level,
  active,
}: {
  index: number;
  level: number;
  active: boolean;
}) {
  const height = useSharedValue(8);

  useEffect(() => {
    // Stagger neighboring bars so the wave looks organic.
    const phase = (index / BAR_COUNT) * Math.PI * 2;
    const wobble = 0.35 + 0.65 * Math.abs(Math.sin(Date.now() / 180 + phase));
    const next = active
      ? Math.max(8, 8 + level * wobble * 52)
      : 8;
    height.set(withTiming(next, { duration: 90 }));
  }, [active, height, index, level]);

  const style = useAnimatedStyle(() => ({
    height: height.get(),
  }));

  return <Animated.View style={[styles.bar, style]} />;
}

/**
 * Simple bar waveform driven by mic metering level.
 * Re-renders on a short interval so inactive bars still breathe slightly while active.
 */
export function VoiceWaveform({ level, active }: VoiceWaveformProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 80);
    return () => clearInterval(id);
  }, [active]);

  const bars = useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, i) => i),
    // tick forces a soft reshuffle of wobble while recording
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  return (
    <View style={styles.row}>
      {bars.map((index) => (
        <WaveBar key={index} index={index} level={level} active={active} />
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
