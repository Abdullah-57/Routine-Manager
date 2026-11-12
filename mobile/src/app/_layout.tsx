import { Stack } from "expo-router";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import "@/notifications/handler";
import { useNotificationNavigation } from "@/notifications/use-notification-navigation";
import { useRegisterPushToken } from "@/notifications/use-register-push-token";
import { colors } from "@/theme";

export { ErrorBoundary } from "expo-router";

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
          options={{ title: "Reminder", presentation: "card" }}
        />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
