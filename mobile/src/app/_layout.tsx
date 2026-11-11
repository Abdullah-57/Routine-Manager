import { Stack } from "expo-router";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import "react-native-reanimated";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import "@/notifications/handler";
import { useNotificationNavigation } from "@/notifications/use-notification-navigation";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash may already be hidden in some reload paths
});

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { isHydrated, token } = useAuth();
  // Wait until auth is ready and user is signed in before pushing reminder routes.
  useNotificationNavigation(isHydrated && !!token);

  useEffect(() => {
    if (isHydrated) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [isHydrated]);

  if (!isHydrated) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
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
