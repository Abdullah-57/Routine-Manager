import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Must run early (import from root layout). Controls what happens when a
 * notification fires while the app is open (foreground).
 */
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
