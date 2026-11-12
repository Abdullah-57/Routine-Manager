import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/auth/AuthContext";

export default function AuthLayout() {
  const { token, isHydrated } = useAuth();

  if (!isHydrated) {
    return null;
  }

  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack>
      <Stack.Screen
        name="welcome"
        options={{ headerShown: false, animation: "fade" }}
      />
      <Stack.Screen
        name="login"
        options={{
          title: "",
          headerTransparent: true,
          headerTintColor: "#FFFFFF",
          headerShadowVisible: false,
          headerBackTitle: "Welcome",
        }}
      />
      <Stack.Screen
        name="signup"
        options={{
          title: "",
          headerTransparent: true,
          headerTintColor: "#FFFFFF",
          headerShadowVisible: false,
          headerBackTitle: "Log in",
        }}
      />
    </Stack>
  );
}
