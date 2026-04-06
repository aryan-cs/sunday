import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

const USE_PHONE_LOCATION_KEY = "sunday.usePhoneLocation";
type ReverseGeocodeResult = Awaited<ReturnType<typeof Location.reverseGeocodeAsync>>[number];

function compactJoin(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function formatReverseGeocodeResult(result: ReverseGeocodeResult | undefined) {
  if (!result) {
    return null;
  }

  const primary = compactJoin([
    result.name,
    result.streetNumber && result.street ? `${result.streetNumber} ${result.street}` : result.street,
  ]);
  const locality = compactJoin([
    result.city ?? result.subregion,
    result.region,
  ]);
  const fallback = compactJoin([
    result.district,
    result.city ?? result.subregion,
    result.region,
    result.country,
  ]);

  return primary || locality || fallback || null;
}

export async function getPhoneLocationEnabledPreference(): Promise<boolean> {
  const storedValue = await AsyncStorage.getItem(USE_PHONE_LOCATION_KEY);
  return storedValue === "true";
}

export async function setPhoneLocationEnabledPreference(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(USE_PHONE_LOCATION_KEY, "true");
    return;
  }

  await AsyncStorage.removeItem(USE_PHONE_LOCATION_KEY);
}

export async function requestPhoneLocationAccess(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted) {
    return {
      granted: true,
      canAskAgain: existing.canAskAgain,
    };
  }

  const requested = await Location.requestForegroundPermissionsAsync();
  return {
    granted: requested.granted,
    canAskAgain: requested.canAskAgain,
  };
}

export async function getPhoneLocationPermissionState(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  const existing = await Location.getForegroundPermissionsAsync();
  return {
    granted: existing.granted,
    canAskAgain: existing.canAskAgain,
  };
}

export async function reverseGeocodePhoneLocation(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    return formatReverseGeocodeResult(results[0]);
  } catch {
    return null;
  }
}
