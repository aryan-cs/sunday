import React from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  LocationPickerModal,
  SelectedLocation,
} from "../components/LocationPickerModal";
import { TravelTypeSelector } from "../components/TravelTypeSelector";
import { FONTS } from "../constants/fonts";
import {
  getPhoneLocationPermissionState,
  getPhoneLocationEnabledPreference,
  requestPhoneLocationAccess,
  setPhoneLocationEnabledPreference,
} from "../lib/phoneLocationPreference";
import {
  AppSettingsValues,
  fetchAppSettings,
  saveAppSettings,
} from "../lib/settings";

const BACKGROUND = "#121212";
const PANEL = "#1f1f1f";
const PANEL_ALT = "#252525";
const BORDER = "#323232";
const MUTED = "#8b8b8b";
const ACCENT = "#ffffff";
const AUTOSAVE_DELAY_MS = 500;
const SETTINGS_RETRY_DELAY_MS = 2000;
const TIME_SETTING_KEYS = ["WORKDAY_START_TIME", "WORKDAY_END_TIME"] as const;
type TimeSettingKey = (typeof TIME_SETTING_KEYS)[number];
const NUMERIC_PICKER_KEYS = [
  "PREP_TIME_MINUTES",
  "ONLINE_PREP_MINUTES",
  "POLL_INTERVAL_SECONDS",
  "MAX_EMAILS_PER_CYCLE",
] as const;
type NumericPickerKey = (typeof NUMERIC_PICKER_KEYS)[number];
const DEFAULT_TIMEZONE_OPTIONS = [
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "UTC",
] as const;
const WORKDAY_OPTIONS = [
  { label: "Su", value: "sun" },
  { label: "M", value: "mon" },
  { label: "T", value: "tue" },
  { label: "W", value: "wed" },
  { label: "Th", value: "thu" },
  { label: "F", value: "fri" },
  { label: "Sa", value: "sat" },
] as const;
type FieldKind = "text" | "number" | "decimal" | "boolean" | "choice" | "select";

type SettingField = {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  description?: string;
  options?: string[];
};

type SettingSection = {
  title: string;
  fields: SettingField[];
};

type LocationSettingGroup = {
  id: "home" | "work";
  title: string;
  description: string;
  locationKey: string;
  latitudeKey: string;
  longitudeKey: string;
  placeholder: string;
};

const LOCATION_SETTING_GROUPS: LocationSettingGroup[] = [
  {
    id: "home",
    title: "Home",
    description: "Pin your default home point instead of typing coordinates.",
    locationKey: "DEFAULT_HOME_LOCATION",
    latitudeKey: "DEFAULT_HOME_LATITUDE",
    longitudeKey: "DEFAULT_HOME_LONGITUDE",
    placeholder: "Champaign, IL",
  },
  {
    id: "work",
    title: "Work",
    description: "Pin your default work point instead of typing coordinates.",
    locationKey: "DEFAULT_WORK_LOCATION",
    latitudeKey: "DEFAULT_WORK_LATITUDE",
    longitudeKey: "DEFAULT_WORK_LONGITUDE",
    placeholder: "Office address",
  },
];

function HomeLocationIcon({ size = 22, color = "#e3e3e3" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"
        fill={color}
      />
    </Svg>
  );
}

function WorkLocationIcon({ size = 22, color = "#e3e3e3" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M160-120q-33 0-56.5-23.5T80-200v-440q0-33 23.5-56.5T160-720h160v-80q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v80h160q33 0 56.5 23.5T880-640v440q0 33-23.5 56.5T800-120H160Zm0-80h640v-440H160v440Zm240-520h160v-80H400v80ZM160-200v-440 440Z"
        fill={color}
      />
    </Svg>
  );
}

const SETTINGS_SECTIONS: SettingSection[] = [
  {
    title: "Calendar",
    fields: [
      {
        key: "TARGET_CALENDAR_ID",
        label: "Target calendar ID",
        placeholder: "primary",
        kind: "text",
      },
      {
        key: "TIMEZONE",
        label: "Time zone",
        description: "Choose a valid IANA time zone.",
        placeholder: "America/Chicago",
        kind: "select",
        options: [...DEFAULT_TIMEZONE_OPTIONS],
      },
      {
        key: "TEXT_EMAIL_LINKS",
        label: "Include email links in texts",
        kind: "boolean",
      },
    ],
  },
  {
    title: "Locations",
    fields: [
      {
        key: "DEFAULT_HOME_LOCATION",
        label: "Home location",
        kind: "text",
      },
      {
        key: "DEFAULT_WORK_LOCATION",
        label: "Work location",
        kind: "text",
      },
    ],
  },
  {
    title: "Schedule",
    fields: [
      {
        key: "WORK_DAYS",
        label: "Work days",
        description: "Tap the days when work-hours logic should apply.",
        kind: "text",
      },
      {
        key: "WORKDAY_START_TIME",
        label: "Workday start",
        description: "Use 12-hour time like 9:00 AM",
        placeholder: "9:00 AM",
        kind: "text",
      },
      {
        key: "WORKDAY_END_TIME",
        label: "Workday end",
        description: "Use 12-hour time like 5:00 PM",
        placeholder: "5:00 PM",
        kind: "text",
      },
      {
        key: "TRAVEL_TYPE",
        label: "Travel type",
        kind: "choice",
        options: ["driving", "walking", "bicycling", "transit"],
      },
      {
        key: "PREP_TIME_MINUTES",
        label: "Prep minutes",
        kind: "number",
      },
      {
        key: "ONLINE_PREP_MINUTES",
        label: "Online prep minutes",
        kind: "number",
      },
      {
        key: "POLL_INTERVAL_SECONDS",
        label: "Poll interval seconds",
        kind: "number",
      },
      {
        key: "MAX_EMAILS_PER_CYCLE",
        label: "Max emails per cycle",
        kind: "number",
      },
    ],
  },
];

function getKeyboardType(kind: FieldKind) {
  if (kind === "number") {
    return "number-pad" as const;
  }
  if (kind === "decimal") {
    return "decimal-pad" as const;
  }
  return "default" as const;
}

function getInitialSettingsState() {
  const values: AppSettingsValues = {};
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) {
      values[field.key] = field.kind === "boolean" ? false : "";
    }
  }
  for (const group of LOCATION_SETTING_GROUPS) {
    values[group.locationKey] = "";
    values[group.latitudeKey] = "";
    values[group.longitudeKey] = "";
  }
  return values;
}

function serializeSettings(settings: AppSettingsValues) {
  const sortedKeys = Object.keys(settings).sort();
  return JSON.stringify(settings, sortedKeys);
}

function parseCoordinate(rawValue: string | boolean | undefined) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const parsed = Number.parseFloat(rawValue.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function defaultPickerCoordinate(settings: AppSettingsValues) {
  for (const group of LOCATION_SETTING_GROUPS) {
    const latitude = parseCoordinate(settings[group.latitudeKey]);
    const longitude = parseCoordinate(settings[group.longitudeKey]);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  }

  return {
    latitude: 40.110588,
    longitude: -88.20727,
  };
}

function isTimeSettingKey(value: string): value is TimeSettingKey {
  return (TIME_SETTING_KEYS as readonly string[]).includes(value);
}

function isNumericPickerKey(value: string): value is NumericPickerKey {
  return (NUMERIC_PICKER_KEYS as readonly string[]).includes(value);
}

function parseWorkDays(value: string | boolean | undefined) {
  if (typeof value !== "string") {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getTimeZoneOptions() {
  const supportedValuesOf = (
    Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;

  const dynamicOptions =
    typeof supportedValuesOf === "function" ? supportedValuesOf("timeZone") : [];
  const merged = [...DEFAULT_TIMEZONE_OPTIONS, ...dynamicOptions];
  return [...new Set(merged)].sort((left, right) => left.localeCompare(right));
}

function getTimeSettingDate(value: string | boolean | undefined) {
  const date = new Date();
  date.setSeconds(0, 0);

  if (typeof value !== "string") {
    return date;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return date;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return date;
  }

  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatTimeForBackend(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = React.useState<AppSettingsValues>(getInitialSettingsState);
  const [isPhoneLocationEnabled, setIsPhoneLocationEnabled] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [activeLocationGroupId, setActiveLocationGroupId] = React.useState<LocationSettingGroup["id"] | null>(null);
  const [isTimezonePickerVisible, setIsTimezonePickerVisible] = React.useState(false);
  const [pendingTimezone, setPendingTimezone] = React.useState("");
  const lastSavedSettingsRef = React.useRef("");
  const hasLoadedSettingsRef = React.useRef(false);
  const saveSequenceRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = React.useCallback(async () => {
    try {
      const response = await fetchAppSettings();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setSettings((current) => {
        const nextSettings = { ...current, ...response.settings };
        lastSavedSettingsRef.current = serializeSettings(nextSettings);
        hasLoadedSettingsRef.current = true;
        return nextSettings;
      });
      setWarnings(response.warnings);
      setErrors(response.errors);
      setIsLoading(false);
    } catch (error) {
      console.warn(
        "[sunday] settings load failed, retrying...",
        error instanceof Error ? error.message : error,
      );
      if (!retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          void loadSettings();
        }, SETTINGS_RETRY_DELAY_MS);
      }
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const storedEnabled = await getPhoneLocationEnabledPreference();
        let enabled = storedEnabled;

        if (storedEnabled) {
          const permission = await getPhoneLocationPermissionState();
          if (!permission.granted) {
            enabled = false;
            await setPhoneLocationEnabledPreference(false);
          }
        }

        if (!cancelled) {
          setIsPhoneLocationEnabled(enabled);
        }
      } catch (error) {
        console.warn(
          "[sunday] failed to load phone location preference",
          error instanceof Error ? error.message : error,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const handleTextChange = React.useCallback((key: string, value: string) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleTimeChange = React.useCallback(
    (key: TimeSettingKey, event: DateTimePickerEvent, selectedDate?: Date) => {
      if (event.type === "dismissed" || !selectedDate) {
        return;
      }

      setSettings((current) => ({
        ...current,
        [key]: formatTimeForBackend(selectedDate),
      }));
    },
    [],
  );

  const handleToggleChange = React.useCallback((key: string, value: boolean) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const openTimezonePicker = React.useCallback(() => {
    setPendingTimezone(String(settings.TIMEZONE ?? "") || "America/Chicago");
    setIsTimezonePickerVisible(true);
  }, [settings.TIMEZONE]);

  const closeTimezonePicker = React.useCallback(() => {
    setIsTimezonePickerVisible(false);
  }, []);

  const confirmTimezonePicker = React.useCallback(() => {
    handleTextChange("TIMEZONE", pendingTimezone || "America/Chicago");
    setIsTimezonePickerVisible(false);
  }, [handleTextChange, pendingTimezone]);

  const handlePhoneLocationToggle = React.useCallback(async (nextValue: boolean) => {
    setErrorMessage(null);

    if (!nextValue) {
      setIsPhoneLocationEnabled(false);
      await setPhoneLocationEnabledPreference(false);
      return;
    }

    try {
      const permission = await requestPhoneLocationAccess();
      if (permission.granted) {
        setIsPhoneLocationEnabled(true);
        await setPhoneLocationEnabledPreference(true);
        return;
      }

      setIsPhoneLocationEnabled(false);
      await setPhoneLocationEnabledPreference(false);
      setErrorMessage(
        permission.canAskAgain
          ? "Location access was denied."
          : "Enable location access for Sunday in iPhone Settings to use your phone location.",
      );
    } catch (error) {
      setIsPhoneLocationEnabled(false);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to request location access.",
      );
    }
  }, []);

  const handleWorkDayToggle = React.useCallback((day: (typeof WORKDAY_OPTIONS)[number]["value"]) => {
    setSettings((current) => {
      const nextDays = parseWorkDays(current.WORK_DAYS);
      if (nextDays.has(day)) {
        nextDays.delete(day);
      } else {
        nextDays.add(day);
      }

      const serialized = WORKDAY_OPTIONS
        .map((option) => option.value)
        .filter((value) => nextDays.has(value))
        .join(",");

      return {
        ...current,
        WORK_DAYS: serialized,
      };
    });
  }, []);

  const handleLocationSelected = React.useCallback(
    (group: LocationSettingGroup, selection: SelectedLocation) => {
      setSettings((current) => ({
        ...current,
        [group.locationKey]: selection.label,
        [group.latitudeKey]: selection.latitude.toFixed(6),
        [group.longitudeKey]: selection.longitude.toFixed(6),
      }));
      setActiveLocationGroupId(null);
    },
    [],
  );

  React.useEffect(() => {
    if (isLoading || !hasLoadedSettingsRef.current) {
      return;
    }

    const serialized = serializeSettings(settings);
    if (serialized === lastSavedSettingsRef.current) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }

    const saveId = ++saveSequenceRef.current;
    setStatusMessage("Saving…");

    saveTimeoutRef.current = setTimeout(() => {
      const snapshot = settings;

      void (async () => {
        setIsSaving(true);
        setErrorMessage(null);
        try {
          const response = await saveAppSettings(snapshot);
          if (saveId !== saveSequenceRef.current) {
            return;
          }

          const nextSettings = { ...snapshot, ...response.settings };
          lastSavedSettingsRef.current = serializeSettings(nextSettings);
          setSettings(nextSettings);
          setWarnings(response.warnings);
          setErrors(response.errors);
          setStatusMessage("Saved");
          statusTimeoutRef.current = setTimeout(() => {
            setStatusMessage((current) => (current === "Saved" ? null : current));
          }, 1200);
        } catch (error) {
          if (saveId !== saveSequenceRef.current) {
            return;
          }
          setErrorMessage(error instanceof Error ? error.message : "Failed to save settings.");
          setStatusMessage(null);
        } finally {
          if (saveId === saveSequenceRef.current) {
            setIsSaving(false);
          }
        }
      })();
    }, AUTOSAVE_DELAY_MS);
  }, [isLoading, settings]);

  const activeLocationGroup = React.useMemo(
    () =>
      LOCATION_SETTING_GROUPS.find((group) => group.id === activeLocationGroupId) ?? null,
    [activeLocationGroupId],
  );
  const timeZoneOptions = React.useMemo(() => getTimeZoneOptions(), []);
  const headerTopInset = insets.top + 8;

  const activePickerCoordinate = React.useMemo(() => {
    if (!activeLocationGroup) {
      return defaultPickerCoordinate(settings);
    }

    const latitude = parseCoordinate(settings[activeLocationGroup.latitudeKey]);
    const longitude = parseCoordinate(settings[activeLocationGroup.longitudeKey]);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }

    return defaultPickerCoordinate(settings);
  }, [activeLocationGroup, settings]);

  if (isLoading) {
    return (
      <SafeAreaView edges={["left", "right"]} style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingScreen}>
          <View style={styles.loadingState}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.loadingText}>Loading settings…</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        bounces
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: headerTopInset }]}>
          <Text style={styles.title}>Settings</Text>
        </View>

        <>
          {SETTINGS_SECTIONS.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionPanel}>
                {section.title === "Locations"
                  ? (
                      <>
                        {LOCATION_SETTING_GROUPS.map((group) => {
                        const locationValue = String(settings[group.locationKey] ?? "");

                        return (
                          <View
                            key={group.id}
                            style={[
                              styles.fieldRow,
                              styles.fieldRowInline,
                              styles.fieldRowBorder,
                            ]}
                          >
                            <View style={[styles.fieldHeader, styles.fieldHeaderInline, styles.locationFieldHeader]}>
                              <View style={styles.locationIconWrap}>
                                {group.id === "home" ? <HomeLocationIcon /> : <WorkLocationIcon />}
                              </View>
                            </View>

                            <Pressable
                              onPress={() => setActiveLocationGroupId(group.id)}
                              style={styles.locationValueButton}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.locationValueText,
                                  !locationValue && styles.locationValuePlaceholder,
                                ]}
                              >
                                {locationValue || group.placeholder}
                              </Text>
                            </Pressable>
                          </View>
                        );
                        })}
                        <View style={[styles.fieldRow, styles.fieldRowInline]}>
                          <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                            <Text style={styles.fieldLabel}>Use your phone location</Text>
                          </View>
                          <Switch
                            value={isPhoneLocationEnabled}
                            onValueChange={(value) => {
                              void handlePhoneLocationToggle(value);
                            }}
                            trackColor={{ false: "#3a3a3a", true: "#4f4f4f" }}
                            thumbColor={isPhoneLocationEnabled ? "#ffffff" : "#d6d6d6"}
                          />
                        </View>
                      </>
                    )
                  : section.fields.map((field, index) => {
                    const rawValue = settings[field.key];
                    const stringValue = typeof rawValue === "boolean" ? "" : String(rawValue ?? "");
                    const boolValue = rawValue === true;

                    return (
                      <View
                        key={field.key}
                        style={[
                          styles.fieldRow,
                          (field.kind === "boolean" ||
                            isNumericPickerKey(field.key) ||
                            isTimeSettingKey(field.key)) &&
                            styles.fieldRowInline,
                          index !== section.fields.length - 1 && styles.fieldRowBorder,
                        ]}
                      >
                        <View
                          style={[
                            styles.fieldHeader,
                            (field.kind === "boolean" ||
                              isNumericPickerKey(field.key) ||
                              isTimeSettingKey(field.key)) &&
                              styles.fieldHeaderInline,
                          ]}
                        >
                          <Text style={styles.fieldLabel}>{field.label}</Text>
                        </View>

                        {field.kind === "boolean" ? (
                          <Switch
                            value={boolValue}
                            onValueChange={(value) => handleToggleChange(field.key, value)}
                            trackColor={{ false: "#3a3a3a", true: "#4f4f4f" }}
                            thumbColor={boolValue ? "#ffffff" : "#d6d6d6"}
                          />
                        ) : field.key === "WORK_DAYS" ? (
                          <View style={styles.workdayRow}>
                            {WORKDAY_OPTIONS.map((option) => {
                              const selected = parseWorkDays(stringValue).has(option.value);
                              return (
                                <Pressable
                                  key={option.value}
                                  onPress={() => handleWorkDayToggle(option.value)}
                                  style={[
                                    styles.workdayButton,
                                    selected && styles.workdayButtonSelected,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.workdayButtonText,
                                      selected && styles.workdayButtonTextSelected,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : isTimeSettingKey(field.key) ? (
                          (() => {
                            const timeKey = field.key;
                            return (
                          <DateTimePicker
                            value={getTimeSettingDate(settings[timeKey])}
                            mode="time"
                            display={Platform.OS === "ios" ? "compact" : "default"}
                            themeVariant="dark"
                            onChange={(event, selectedDate) =>
                              handleTimeChange(timeKey, event, selectedDate)
                            }
                            style={styles.timePicker}
                          />
                            );
                          })()
                        ) : field.key === "TRAVEL_TYPE" ? (
                          <TravelTypeSelector
                            value={stringValue || "driving"}
                            onChange={(value) => handleTextChange(field.key, value)}
                          />
                        ) : field.kind === "choice" ? (
                          <View style={styles.choiceRow}>
                            {field.options?.map((option) => {
                              const selected = stringValue === option;
                              return (
                                <Pressable
                                  key={option}
                                  onPress={() => handleTextChange(field.key, option)}
                                  style={[
                                    styles.choiceChip,
                                    selected && styles.choiceChipSelected,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.choiceChipText,
                                      selected && styles.choiceChipTextSelected,
                                    ]}
                                  >
                                    {option}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : field.key === "TIMEZONE" ? (
                          <Pressable onPress={openTimezonePicker} style={styles.selectTrigger}>
                            <Text numberOfLines={1} style={styles.selectTriggerText}>
                              {stringValue || field.placeholder || "Select"}
                            </Text>
                            <Text style={styles.selectTriggerChevron}>▾</Text>
                          </Pressable>
                        ) : isNumericPickerKey(field.key) ? (
                          (() => {
                            const numericKey = field.key;
                            return (
                              <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                inputMode="numeric"
                                keyboardType="number-pad"
                                onChangeText={(value) =>
                                  handleTextChange(numericKey, value.replace(/[^\d]/g, ""))
                                }
                                placeholder="0"
                                placeholderTextColor="#6f6f6f"
                                selectTextOnFocus
                                style={styles.numericInput}
                                value={stringValue}
                              />
                            );
                          })()
                        ) : (
                          <TextInput
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType={getKeyboardType(field.kind)}
                            onChangeText={(value) => handleTextChange(field.key, value)}
                            placeholder={field.placeholder}
                            placeholderTextColor="#6f6f6f"
                            style={styles.input}
                            value={stringValue}
                          />
                        )}
                      </View>
                    );
                })}
              </View>
            </View>
          ))}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          {errors.map((error) => (
            <Text key={`error-${error}`} style={styles.validationText}>
              {error}
            </Text>
          ))}
          {warnings.map((warning) => (
            <Text key={`warning-${warning}`} style={styles.warningText}>
              {warning}
            </Text>
          ))}
        </>
      </ScrollView>

      {activeLocationGroup ? (
        <LocationPickerModal
          visible
          title={`${activeLocationGroup.title} location`}
          initialCoordinate={activePickerCoordinate}
          initialLabel={String(settings[activeLocationGroup.locationKey] ?? "")}
          onClose={() => setActiveLocationGroupId(null)}
          onConfirm={(selection) => handleLocationSelected(activeLocationGroup, selection)}
        />
      ) : null}

      {isTimezonePickerVisible ? (
        <Modal
          transparent
          animationType="slide"
          visible
          onRequestClose={closeTimezonePicker}
        >
          <View style={styles.sheetOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeTimezonePicker} />
            <View style={[styles.sheetPanel, { paddingBottom: insets.bottom + 14 }]}>
              <View style={styles.sheetHeader}>
                <Pressable hitSlop={10} onPress={closeTimezonePicker}>
                  <Text style={styles.sheetActionText}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>Time Zone</Text>
                <Pressable hitSlop={10} onPress={confirmTimezonePicker}>
                  <Text style={styles.sheetActionText}>Done</Text>
                </Pressable>
              </View>
              <View style={styles.sheetPickerWrap}>
                <Picker
                  selectedValue={pendingTimezone}
                  onValueChange={(value) => setPendingTimezone(String(value))}
                  itemStyle={styles.sheetPickerItem}
                  style={styles.sheetPicker}
                >
                  {timeZoneOptions.map((option) => (
                    <Picker.Item
                      key={option}
                      label={option}
                      value={option}
                      color="#ffffff"
                    />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 0,
    paddingBottom: 120,
    gap: 18,
  },
  header: {
    gap: 8,
    paddingBottom: 8,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontFamily: FONTS.semibold,
  },
  loadingState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    maxWidth: 320,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingText: {
    color: MUTED,
    fontFamily: FONTS.medium,
    fontSize: 15,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: "#ffffff",
    fontFamily: FONTS.semibold,
    fontSize: 18,
  },
  sectionPanel: {
    borderRadius: 22,
    backgroundColor: PANEL,
    overflow: "hidden",
  },
  fieldRow: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: PANEL,
    gap: 12,
  },
  fieldRowInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldHeader: {
    gap: 0,
  },
  fieldHeaderInline: {
    flex: 1,
    paddingRight: 16,
  },
  fieldLabel: {
    color: "#ffffff",
    fontFamily: FONTS.medium,
    fontSize: 16,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: "#ffffff",
    backgroundColor: PANEL_ALT,
    fontFamily: FONTS.regular,
    fontSize: 15,
  },
  timePicker: {
    width: Platform.OS === "ios" ? 124 : 132,
    alignSelf: "center",
    marginRight: Platform.OS === "ios" ? -8 : 0,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationFieldHeader: {
    flex: 0,
    width: 72,
    paddingRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  locationIconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  locationValueButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: PANEL_ALT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
  },
  locationValueText: {
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 15,
    textAlign: "right",
  },
  locationValuePlaceholder: {
    color: "#6f6f6f",
  },
  nativePickerField: {
    borderRadius: 14,
    backgroundColor: PANEL_ALT,
    overflow: "hidden",
  },
  timezonePicker: {
    color: "#ffffff",
    height: 180,
    marginHorizontal: Platform.OS === "ios" ? -8 : 0,
  },
  selectTrigger: {
    minHeight: 44,
    maxWidth: 200,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: PANEL_ALT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  selectTriggerText: {
    flex: 1,
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 15,
    textAlign: "right",
  },
  selectTriggerChevron: {
    color: MUTED,
    fontFamily: FONTS.semibold,
    fontSize: 16,
  },
  numericInput: {
    width: 76,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: "#ffffff",
    backgroundColor: PANEL_ALT,
    fontFamily: FONTS.regular,
    fontSize: 17,
    textAlign: "right",
  },
  nativePickerItem: {
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 20,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  workdayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workdayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PANEL_ALT,
    alignItems: "center",
    justifyContent: "center",
  },
  workdayButtonSelected: {
    backgroundColor: ACCENT,
  },
  workdayButtonText: {
    color: "#ffffff",
    fontFamily: FONTS.semibold,
    fontSize: 12,
  },
  workdayButtonTextSelected: {
    color: BACKGROUND,
  },
  choiceChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: PANEL_ALT,
  },
  choiceChipSelected: {
    backgroundColor: ACCENT,
  },
  choiceChipText: {
    color: "#ffffff",
    fontFamily: FONTS.medium,
    fontSize: 14,
  },
  choiceChipTextSelected: {
    color: BACKGROUND,
  },
  errorText: {
    color: "#ff7b72",
    fontFamily: FONTS.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  validationText: {
    color: "#ff9d57",
    fontFamily: FONTS.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  warningText: {
    color: "#c9c9c9",
    fontFamily: FONTS.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  sheetPanel: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: "#1d1d1f",
    overflow: "hidden",
  },
  sheetHeader: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  sheetTitle: {
    color: "#ffffff",
    fontFamily: FONTS.semibold,
    fontSize: 16,
  },
  sheetActionText: {
    color: "#0a84ff",
    fontFamily: FONTS.medium,
    fontSize: 16,
  },
  sheetPickerWrap: {
    backgroundColor: "#1d1d1f",
  },
  sheetPicker: {
    height: 216,
    color: "#ffffff",
  },
  sheetPickerItem: {
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 20,
  },
});
