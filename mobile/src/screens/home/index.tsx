import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, pingHealth } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";

type PingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function HomeScreen() {
  const { user, logout } = useAuth();
  const [ping, setPing] = useState<PingState>({ status: "idle" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handlePing() {
    if (ping.status === "loading") return;

    setPing({ status: "loading" });

    try {
      const data = await pingHealth();
      setPing({
        status: "success",
        message: `ok: ${String(data.ok)} · service: ${data.service} · ${new Date().toLocaleTimeString()}`,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Something went wrong while pinging the API.";
      setPing({ status: "error", message });
    }
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={styles.section}>
        <Text style={styles.title}>Home</Text>
        <Text style={styles.subtitle}>
          Signed in as {user?.email ?? "your account"}.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={ping.status === "loading"}
        onPress={handlePing}
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : null,
          ping.status === "loading" ? styles.buttonDisabled : null,
        ]}
      >
        {ping.status === "loading" ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonLabel}>Ping API</Text>
        )}
      </Pressable>

      {ping.status === "success" ? (
        <View style={[styles.result, styles.resultSuccess]}>
          <Text style={styles.resultLabel}>Success</Text>
          <Text style={styles.resultBody}>{ping.message}</Text>
        </View>
      ) : null}

      {ping.status === "error" ? (
        <View style={[styles.result, styles.resultError]}>
          <Text style={styles.resultLabel}>Error</Text>
          <Text style={styles.resultBody}>{ping.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={isLoggingOut}
        onPress={handleLogout}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed ? styles.buttonPressed : null,
        ]}
      >
        {isLoggingOut ? (
          <ActivityIndicator color="#2563eb" />
        ) : (
          <Text style={styles.secondaryButtonLabel}>Log out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: "#525252",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#2563eb",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButtonLabel: {
    color: "#2563eb",
    fontSize: 16,
    fontWeight: "600",
  },
  result: {
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 14,
    gap: 4,
  },
  resultSuccess: {
    backgroundColor: "#ecfdf5",
  },
  resultError: {
    backgroundColor: "#fef2f2",
  },
  resultLabel: {
    fontWeight: "700",
  },
  resultBody: {
    color: "#404040",
    lineHeight: 20,
  },
});
