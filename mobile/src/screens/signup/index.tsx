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

export function SignupScreen() {
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await signup({
        email: trimmedEmail,
        password,
        displayName: displayName.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not sign up. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenScroll>
      <ScreenSection>
        <ThemedText variant="largeTitle">Sign up</ThemedText>
        <ThemedText variant="subhead">
          Create an account to sync routines and reminders.
        </ThemedText>
      </ScreenSection>

      <View style={styles.card}>
        <ThemedText variant="label">Display name (optional)</ThemedText>
        <AppTextField
          autoCapitalize="words"
          placeholder="Your name"
          value={displayName}
          onChangeText={setDisplayName}
        />

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
          autoComplete="password-new"
          placeholder="At least 8 characters"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? (
          <FeedbackBanner tone="error" title="Could not sign up" body={error} />
        ) : null}

        <NativeHost>
          <Button
            label={isSubmitting ? "Creating account…" : "Create account"}
            variant="filled"
            disabled={isSubmitting}
            onPress={() => {
              void handleSubmit();
            }}
          />
        </NativeHost>
      </View>

      <ThemedText variant="subhead">
        Already have an account?{" "}
        <Link href="/(auth)/login" style={styles.link}>
          Log in
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
