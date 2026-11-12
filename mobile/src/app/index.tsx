import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";

export default function Index() {
  const { token, isHydrated } = useAuth();

  if (!isHydrated) {
    return null;
  }

  return <Redirect href={token ? "/(tabs)" : "/(auth)/welcome"} />;
}
