import { useEffect } from "react";
import * as Location from "expo-location";
import { postLocation } from "../api";

export function useLocation() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          await postLocation(
            loc.coords.latitude,
            loc.coords.longitude,
            loc.coords.accuracy
          );
        }
      } catch (e) {
        // Location is an enhancement — never block the UI on failure
      }
    })();

    return () => { cancelled = true; };
  }, []);
}
