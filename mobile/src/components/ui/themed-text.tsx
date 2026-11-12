import { Text, type TextProps, type TextStyle } from "react-native";
import { type as typeRamp } from "@/theme";

type Variant = keyof typeof typeRamp;

type ThemedTextProps = TextProps & {
  variant?: Variant;
};

export function ThemedText({
  variant = "body",
  style,
  ...props
}: ThemedTextProps) {
  return <Text style={[typeRamp[variant] as TextStyle, style]} {...props} />;
}
