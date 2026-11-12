import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useAuth } from "@/auth/AuthContext";

export default function TabsLayout() {
  const { token, isHydrated } = useAuth();

  if (!isHydrated) {
    return null;
  }

  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <NativeTabs
      // Tint drives selected chrome; keep label dark so it stays readable on the white bar.
      tintColor="#1D4ED8"
      backgroundColor="#FFFFFF"
      // Blue pill behind the selected icon only (Material indicator wraps the icon).
      indicatorColor="#1D4ED8"
      labelStyle={{
        default: { color: "#64748B", fontWeight: "600" },
        // Label sits under the pill on the white tab bar — must not be white.
        selected: { color: "#1D4ED8", fontWeight: "700" },
      }}
      iconColor={{
        default: "#64748B",
        selected: "#FFFFFF",
      }}
      labelVisibilityMode="labeled"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
