import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  LocationPickerModal,
  SelectedLocation,
} from "../components/LocationPickerModal";
import { FONTS } from "../constants/fonts";
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
const TIME_SETTING_KEYS = ["WORKDAY_START_TIME", "WORKDAY_END_TIME"] as const;
type TimeSettingKey = (typeof TIME_SETTING_KEYS)[number];

type FieldKind = "text" | "number" | "decimal" | "boolean" | "choice";

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
        placeholder: "America/Chicago",
        kind: "text",
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
        description: "Comma-separated: mon,tue,wed,thu,fri",
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

function formatCoordinateLabel(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) {
    return "No point selected yet.";
  }
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
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

function formatTimeForDisplay(value: string | boolean | undefined) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return trimmed;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2];
  if (Number.isNaN(hours) || hours < 0 || hours > 23) {
    return trimmed;
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

function parseDisplayTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([aApP][mM])$/);
  if (!match) {
    return null;
  }

  const rawHour = Number.parseInt(match[1], 10);
  const rawMinute = match[2] ?? "00";
  const suffix = match[3].toUpperCase();
  const minutes = Number.parseInt(rawMinute, 10);

  if (
    Number.isNaN(rawHour) ||
    rawHour < 1 ||
    rawHour > 12 ||
    Number.isNaN(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const baseHour = rawHour % 12;
  const hour24 = suffix === "PM" ? baseHour + 12 : baseHour;
  return `${String(hour24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function SettingsScreen() {
  const [settings, setSettings] = React.useState<AppSettingsValues>(getInitialSettingsState);
  const [timeInputs, setTimeInputs] = React.useState<Record<TimeSettingKey, string>>({
    WORKDAY_START_TIME: "",
    WORKDAY_END_TIME: "",
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [activeLocationGroupId, setActiveLocationGroupId] = React.useState<LocationSettingGroup["id"] | null>(null);
  const lastSavedSettingsRef = React.useRef("");
  const hasLoadedSettingsRef = React.useRef(false);
  const saveSequenceRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchAppSettings();
      setSettings((current) => {
        const nextSettings = { ...current, ...response.settings };
        lastSavedSettingsRef.current = serializeSettings(nextSettings);
        hasLoadedSettingsRef.current = true;
        setTimeInputs({
          WORKDAY_START_TIME: formatTimeForDisplay(nextSettings.WORKDAY_START_TIME),
          WORKDAY_END_TIME: formatTimeForDisplay(nextSettings.WORKDAY_END_TIME),
        });
        return nextSettings;
      });
      setWarnings(response.warnings);
      setErrors(response.errors);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const handleTextChange = React.useCallback((key: string, value: string) => {
    if (isTimeSettingKey(key)) {
      setTimeInputs((current) => ({
        ...current,
        [key]: value,
      }));

      const parsedValue = parseDisplayTime(value);
      if (parsedValue === null) {
        return;
      }

      setSettings((current) => ({
        ...current,
        [key]: parsedValue,
      }));
      return;
    }

    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleToggleChange = React.useCallback((key: string, value: boolean) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
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

  React.useEffect(() => {
    setTimeInputs((current) => {
      const next = {
        WORKDAY_START_TIME: formatTimeForDisplay(settings.WORKDAY_START_TIME),
        WORKDAY_END_TIME: formatTimeForDisplay(settings.WORKDAY_END_TIME),
      };
      if (
        current.WORKDAY_START_TIME === next.WORKDAY_START_TIME &&
        current.WORKDAY_END_TIME === next.WORKDAY_END_TIME
      ) {
        return current;
      }
      return next;
    });
  }, [settings.WORKDAY_END_TIME, settings.WORKDAY_START_TIME]);

  const activeLocationGroup = React.useMemo(
    () =>
      LOCATION_SETTING_GROUPS.find((group) => group.id === activeLocationGroupId) ?? null,
    [activeLocationGroupId],
  );

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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        bounces
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>
            Edit the non-secret config values Sunday uses at runtime.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.loadingText}>Loading settings…</Text>
          </View>
        ) : (
          <>
            {SETTINGS_SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionPanel}>
                  {section.title === "Locations"
                    ? LOCATION_SETTING_GROUPS.map((group, index) => {
                        const locationValue = String(settings[group.locationKey] ?? "");
                        const latitude = parseCoordinate(settings[group.latitudeKey]);
                        const longitude = parseCoordinate(settings[group.longitudeKey]);

                        return (
                          <View
                            key={group.id}
                            style={[
                              styles.fieldRow,
                              index !== LOCATION_SETTING_GROUPS.length - 1 && styles.fieldRowBorder,
                            ]}
                          >
                            <View style={styles.fieldHeader}>
                              <Text style={styles.fieldLabel}>{group.title}</Text>
                              <Text style={styles.fieldDescription}>{group.description}</Text>
                            </View>

                            <TextInput
                              autoCapitalize="words"
                              autoCorrect={false}
                              onChangeText={(value) => handleTextChange(group.locationKey, value)}
                              placeholder={group.placeholder}
                              placeholderTextColor="#6f6f6f"
                              style={styles.input}
                              value={locationValue}
                            />

                            <View style={styles.locationRow}>
                              <View style={styles.locationMeta}>
                                <Text style={styles.locationMetaLabel}>Selected point</Text>
                                <Text style={styles.locationMetaValue}>
                                  {formatCoordinateLabel(latitude, longitude)}
                                </Text>
                              </View>
                              <Pressable
                                onPress={() => setActiveLocationGroupId(group.id)}
                                style={styles.locationButton}
                              >
                                <Text style={styles.locationButtonText}>
                                  {latitude !== null && longitude !== null ? "Adjust on map" : "Pick on map"}
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })
                    : section.fields.map((field, index) => {
                    const rawValue = settings[field.key];
                    const stringValue = typeof rawValue === "boolean" ? "" : String(rawValue ?? "");
                    const boolValue = rawValue === true;

                    return (
                      <View
                        key={field.key}
                        style={[
                          styles.fieldRow,
                          index !== section.fields.length - 1 && styles.fieldRowBorder,
                        ]}
                      >
                        <View style={styles.fieldHeader}>
                          <Text style={styles.fieldLabel}>{field.label}</Text>
                          {field.description ? (
                            <Text style={styles.fieldDescription}>{field.description}</Text>
                          ) : null}
                        </View>

                        {field.kind === "boolean" ? (
                          <Switch
                            value={boolValue}
                            onValueChange={(value) => handleToggleChange(field.key, value)}
                            trackColor={{ false: "#3a3a3a", true: "#4f4f4f" }}
                            thumbColor={boolValue ? "#ffffff" : "#d6d6d6"}
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
                        ) : (
                          <TextInput
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType={getKeyboardType(field.kind)}
                            onChangeText={(value) => handleTextChange(field.key, value)}
                            placeholder={
                              isTimeSettingKey(field.key) ? "9:00 AM" : field.placeholder
                            }
                            placeholderTextColor="#6f6f6f"
                            style={styles.input}
                            value={isTimeSettingKey(field.key) ? timeInputs[field.key] : stringValue}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
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
        )}
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
    paddingTop: 24,
    paddingBottom: 120,
    gap: 18,
  },
  header: {
    gap: 8,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontFamily: FONTS.semibold,
  },
  subtitle: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONTS.regular,
  },
  loadingState: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
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
  fieldRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldHeader: {
    gap: 4,
  },
  fieldLabel: {
    color: "#ffffff",
    fontFamily: FONTS.medium,
    fontSize: 16,
  },
  fieldDescription: {
    color: MUTED,
    fontFamily: FONTS.regular,
    fontSize: 13,
    lineHeight: 18,
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
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationMeta: {
    flex: 1,
    gap: 4,
  },
  locationMetaLabel: {
    color: MUTED,
    fontFamily: FONTS.medium,
    fontSize: 12,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  locationMetaValue: {
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 14,
  },
  locationButton: {
    borderRadius: 999,
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  locationButtonText: {
    color: BACKGROUND,
    fontFamily: FONTS.semibold,
    fontSize: 14,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
  statusText: {
    color: "#cfcfcf",
    fontFamily: FONTS.medium,
    fontSize: 14,
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
});
