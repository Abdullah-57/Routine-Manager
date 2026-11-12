import { Easing } from "react-native-reanimated";

export const motion = {
  pressMs: 120,
  enterMs: 200,
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
  pressScale: 0.97,
} as const;
