import type { TextStyle } from "react-native";
import { colors } from "./colors";

export const type = {
  largeTitle: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: colors.label,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: colors.label,
  },
  headline: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.label,
  },
  body: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
    color: colors.label,
  },
  subhead: {
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 21,
    color: colors.secondaryLabel,
  },
  caption: {
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 18,
    color: colors.secondaryLabel,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.secondaryLabel,
  },
} as const satisfies Record<string, TextStyle>;
