import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "../api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;

      try {
        const { data: token } = await Notifications.getExpoPushTokenAsync();
        await registerPushToken(token);
      } catch (e) {
        // Non-fatal — app works without push
      }
    })();
  }, []);
}
