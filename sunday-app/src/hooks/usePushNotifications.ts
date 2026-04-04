import { useEffect } from "react";
import Constants from "expo-constants";
import { registerPushToken } from "../api";

export function usePushNotifications() {
  useEffect(() => {
    if (Constants.appOwnership === "expo") {
      return;
    }

    (async () => {
      try {
        const Notifications = await import("expo-notifications");

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") return;
        const { data: token } = await Notifications.getExpoPushTokenAsync();
        await registerPushToken(token);
      } catch {
        // Non-fatal — push not supported in Expo Go (SDK 53+), works in dev builds
      }
    })();
  }, []);
}
