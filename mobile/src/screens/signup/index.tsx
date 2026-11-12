import { Button, Host } from "@expo/ui";
import { Link } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AppTextField } from "@/components/ui/app-text-field";
import { AuthCard, AuthShell } from "@/components/ui/auth-shell";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { radius, spacing } from "@/theme";

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
    <AuthShell>
      <View style={styles.header}>
        <Text style={styles.title}>Sign up</Text>
        <Text style={styles.subtitle}>
          Create an account to sync routines and reminders.
        </Text>
      </View>

      <AuthCard>
        <Text style={styles.label}>Display name (optional)</Text>
        <AppTextField
          autoCapitalize="words"
          placeholder="Your name"
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.field}
          placeholderTextColor="rgba(30, 58, 138, 0.45)"
        />

        <Text style={styles.label}>Email</Text>
        <AppTextField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          style={styles.field}
          placeholderTextColor="rgba(30, 58, 138, 0.45)"
        />

        <Text style={styles.label}>Password</Text>
        <AppTextField
          autoCapitalize="none"
          autoComplete="password-new"
          placeholder="At least 8 characters"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.field}
          placeholderTextColor="rgba(30, 58, 138, 0.45)"
        />

        {error ? (
          <FeedbackBanner tone="error" title="Could not sign up" body={error} />
        ) : null}

        <Host
          matchContents={{ vertical: true, horizontal: false }}
          seedColor="#1D4ED8"
          style={styles.host}
        >
          <Button
            label={isSubmitting ? "Creating account…" : "Create account"}
            variant="filled"
            disabled={isSubmitting}
            style={{ width: "100%", height: 52 }}
            onPress={() => {
              void handleSubmit();
            }}
          />
        </Host>
      </AuthCard>

      <Text style={styles.footer}>
        Already have an account?{" "}
        <Link href="/(auth)/login" style={styles.link}>
          Log in
        </Link>
      </Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  header: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: "#FFFFFF",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: "rgba(255, 255, 255, 0.88)",
    textAlign: "center",
    maxWidth: 320,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: "#1E3A8A",
    marginTop: spacing.xs,
  },
  field: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "rgba(37, 99, 235, 0.28)",
    borderRadius: radius.md,
    borderCurve: "continuous",
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "500",
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  host: {
    alignSelf: "stretch",
    width: "100%",
    marginTop: spacing.sm,
    minHeight: 52,
  },
  footer: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.9)",
    textAlign: "center",
  },
  link: {
    color: "#FFFFFF",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
