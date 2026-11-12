import { Stack, type ErrorBoundaryProps } from "expo-router";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { AppButton } from "@/components/ui/app-button";
import "@/notifications/handler";
import { useNotificationNavigation } from "@/notifications/use-notification-navigation";
import { useRegisterPushToken } from "@/notifications/use-register-push-token";
import { AppPreferencesProvider } from "@/preferences/app-preferences";
import { colors, radius, shadows, spacing } from "@/theme";

/**
 * Feature 9.1: friendly global crash screen. Replaces the default Expo Router
 * boundary (dev-only error dump / blank screen in production) with a themed
 * fallback and a working Try-again button, so a rendering crash never leaves
 * the user on a white screen.
 */
function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorRoot}>
      <View style={styles.errorCard}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorBody}>
          The app hit an unexpected error. Try again — your account and
          reminders are stored safely in the cloud.
        </Text>
        {error?.message ? (
          <Text style={styles.errorDetail} numberOfLines={3}>
            {error.message}
          </Text>
        ) : null}
        <AppButton
          label="Try again"
          onPress={() => {
            void retry();
          }}
          style={styles.errorButton}
        />
      </View>
    </View>
  );
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RootErrorBoundary {...props} />;
}

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash may already be hidden in some reload paths
});

function buildAppTheme(scheme: "light" | "dark" | null | undefined): Theme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.seed,
      background: colors.groupedBackground as string,
      card: colors.secondaryGroupedBackground as string,
      text: colors.label as string,
      border: colors.separator as string,
      notification: colors.seed,
    },
  };
}

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { isHydrated, token } = useAuth();
  const navigationTheme = useMemo(
    () => buildAppTheme(colorScheme),
    [colorScheme],
  );
  // Wait until auth is ready and user is signed in before pushing reminder routes.
  useNotificationNavigation(isHydrated && !!token);
  // Feature 6.2: save Expo push token on the backend after login / hydrate.
  useRegisterPushToken(isHydrated ? token : null);

  useEffect(() => {
    if (isHydrated) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [isHydrated]);

  if (!isHydrated) {
    return null;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="reminder/[id]"
          options={{ title: "Reminder", presentation: "card", headerShown: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppPreferencesProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </AppPreferencesProvider>
  );
}

const styles = StyleSheet.create({
  errorRoot: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  errorCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.18)",
    boxShadow: shadows.subtle,
  },
  errorIcon: {
    fontSize: 40,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: "#0F172A",
    textAlign: "center",
  },
  errorBody: {
    fontSize: 15,
    lineHeight: 21,
    color: "#334155",
    textAlign: "center",
  },
  errorDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748B",
    textAlign: "center",
  },
  errorButton: {
    alignSelf: "stretch",
    marginTop: spacing.xs,
    backgroundColor: "#1D4ED8",
  },
});
