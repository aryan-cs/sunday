import AsyncStorage from "@react-native-async-storage/async-storage";

const CALENDAR_PREFERENCES_KEY = "sunday.calendar.preferences";

export type CalendarPreferences = {
  hiddenCalendarIds: string[];
  colorsById: Record<string, string>;
};

const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  hiddenCalendarIds: [],
  colorsById: {},
};

export async function loadCalendarPreferences(): Promise<CalendarPreferences> {
  const raw = await AsyncStorage.getItem(CALENDAR_PREFERENCES_KEY);
  if (!raw) {
    return DEFAULT_CALENDAR_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CalendarPreferences>;
    return {
      hiddenCalendarIds: Array.isArray(parsed.hiddenCalendarIds)
        ? parsed.hiddenCalendarIds.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [],
      colorsById:
        parsed.colorsById && typeof parsed.colorsById === "object"
          ? Object.fromEntries(
              Object.entries(parsed.colorsById).filter(
                ([key, value]) =>
                  typeof key === "string" &&
                  key.trim().length > 0 &&
                  typeof value === "string" &&
                  value.trim().length > 0,
              ),
            )
          : {},
    };
  } catch {
    return DEFAULT_CALENDAR_PREFERENCES;
  }
}

export async function saveCalendarPreferences(
  nextPreferences: CalendarPreferences,
): Promise<CalendarPreferences> {
  const normalized: CalendarPreferences = {
    hiddenCalendarIds: [...new Set(nextPreferences.hiddenCalendarIds.filter(Boolean))],
    colorsById: Object.fromEntries(
      Object.entries(nextPreferences.colorsById).filter(
        ([key, value]) => key.trim().length > 0 && value.trim().length > 0,
      ),
    ),
  };
  await AsyncStorage.setItem(CALENDAR_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}
