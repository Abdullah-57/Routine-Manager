import { Button } from "@expo/ui";
import { Link } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AppTextField } from "@/components/ui/app-text-field";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { NativeHost } from "@/components/ui/native-actions";
import { ScreenScroll, ScreenSection } from "@/components/ui/screen";
import { ThemedText } from "@/components/ui/themed-text";
import { colors, radius, shadows, spacing } from "@/theme";

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await login(trimmedEmail, password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not log in. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenScroll>
      <ScreenSection>
        <ThemedText variant="largeTitle">Log in</ThemedText>
        <ThemedText variant="subhead">
          Welcome back. Your session is stored securely on this device.
        </ThemedText>
      </ScreenSection>

      <View style={styles.card}>
        <ThemedText variant="label">Email</ThemedText>
        <AppTextField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
        />

        <ThemedText variant="label">Password</ThemedText>
        <AppTextField
          autoCapitalize="none"
          autoComplete="password"
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? (
          <FeedbackBanner tone="error" title="Could not log in" body={error} />
        ) : null}

        <NativeHost>
          <Button
            label={isSubmitting ? "Logging in…" : "Log in"}
            variant="filled"
            disabled={isSubmitting}
            onPress={() => {
              void handleSubmit();
            }}
          />
        </NativeHost>
      </View>

      <ThemedText variant="subhead">
        New here?{" "}
        <Link href="/(auth)/signup" style={styles.link}>
          Create an account
        </Link>
      </ThemedText>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.secondaryGroupedBackground,
    boxShadow: shadows.subtle,
  },
  link: {
    color: colors.tint,
    fontWeight: "600",
  },
});
