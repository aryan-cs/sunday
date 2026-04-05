import React from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
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
const TOGGLE_OFF = "#1a1a1a";
const TOGGLE_ON = "#5f5f5f";
const AUTOSAVE_DELAY_MS = 500;
const SETTINGS_RETRY_DELAY_MS = 2000;
const KEYBOARD_ROW_CLEARANCE = 18;
const TIMEZONE_SHEET_OVERDRAW = 72;
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
const CONNECTED_AGENT_OPTIONS = [
  "OpenAI",
  "Anthropic",
  "Gemini",
  "Cerebras",
  "Groq",
  "Ollama",
  "OpenClaw",
] as const;
const RECOMMENDED_TRANSCRIPTION_MODEL = "ggml-small.en-q5_1";
const RECOMMENDED_SUMMARIZATION_MODEL = "qwen2.5-0.5b-instruct";
type FieldKind = "text" | "number" | "decimal" | "boolean" | "choice" | "select";
type OptionSheetKind = "agent" | "transcription-model" | "summarization-model";

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
        label: "Google Calendar ID",
        placeholder: "primary",
        kind: "text",
      },
      {
        key: "TIMEZONE",
        label: "Time Zone",
        description: "Choose a valid IANA time zone.",
        placeholder: "America/Chicago",
        kind: "select",
        options: [...DEFAULT_TIMEZONE_OPTIONS],
      },
      {
        key: "TEXT_EMAIL_LINKS",
        label: "Text email links with reminders",
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
        label: "Workday Start",
        description: "Use 12-hour time like 9:00 AM",
        placeholder: "9:00 AM",
        kind: "text",
      },
      {
        key: "WORKDAY_END_TIME",
        label: "Workday End",
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
        label: "Minutes between in-person events",
        kind: "number",
      },
      {
        key: "ONLINE_PREP_MINUTES",
        label: "Minutes between online events",
        kind: "number",
      },
      {
        key: "POLL_INTERVAL_SECONDS",
        label: "Inbox polling interval duration",
        kind: "number",
      },
      {
        key: "MAX_EMAILS_PER_CYCLE",
        label: "Maximum emails to check per cycle",
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

function formatTimeZoneLabel(value: string) {
  if (value === "UTC") {
    return "UTC";
  }

  return value
    .split("/")
    .map((segment) => segment.replace(/_/g, " "))
    .join(" / ");
}

function formatModelOptionLabel(option: string, recommendedOption: string | null) {
  return option === recommendedOption ? `${option} (Recommended)` : option;
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
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const scrollViewRef = React.useRef<ScrollView>(null);
  const calendarIdInputRef = React.useRef<TextInput>(null);
  const [settings, setSettings] = React.useState<AppSettingsValues>(getInitialSettingsState);
  const [settingsMetadata, setSettingsMetadata] = React.useState<Record<string, string>>({});
  const [isPhoneLocationEnabled, setIsPhoneLocationEnabled] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [activeLocationGroupId, setActiveLocationGroupId] = React.useState<LocationSettingGroup["id"] | null>(null);
  const [isOptionPickerVisible, setIsOptionPickerVisible] = React.useState(false);
  const [isOptionPickerMounted, setIsOptionPickerMounted] = React.useState(false);
  const [isTimezonePickerVisible, setIsTimezonePickerVisible] = React.useState(false);
  const [isTimezonePickerMounted, setIsTimezonePickerMounted] = React.useState(false);
  const [isEditingCalendarId, setIsEditingCalendarId] = React.useState(false);
  const [calendarDisplayWidth, setCalendarDisplayWidth] = React.useState(0);
  const [activeOptionPicker, setActiveOptionPicker] = React.useState<OptionSheetKind | null>(null);
  const [pendingOptionValue, setPendingOptionValue] = React.useState("");
  const [pendingTimezone, setPendingTimezone] = React.useState("");
  const [connectedAgent, setConnectedAgent] = React.useState("Ollama");
  const [transcriptionModel, setTranscriptionModel] = React.useState("ggml-large-v3-turbo-q5_0");
  const [summarizationModel, setSummarizationModel] = React.useState("qwen2.5-0.5b-instruct");
  const [transcriptionModelOptions, setTranscriptionModelOptions] = React.useState<string[]>([]);
  const [summarizationModelOptions, setSummarizationModelOptions] = React.useState<string[]>([]);
  const lastSavedSettingsRef = React.useRef("");
  const hasLoadedSettingsRef = React.useRef(false);
  const saveSequenceRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionBackdropOpacity = React.useRef(new Animated.Value(0)).current;
  const optionSheetTranslateY = React.useRef(new Animated.Value(28)).current;
  const timezoneBackdropOpacity = React.useRef(new Animated.Value(0)).current;
  const timezoneSheetTranslateY = React.useRef(new Animated.Value(28)).current;
  const calendarEditorProgress = React.useRef(new Animated.Value(0)).current;

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
      setSettingsMetadata(response.metadata ?? {});
      setWarnings(response.warnings);
      setErrors(response.errors);
      setTranscriptionModelOptions(response.modelOptions.transcription);
      setSummarizationModelOptions(response.modelOptions.summarization);
      setTranscriptionModel(
        response.metadata.transcription_model_name?.trim() ||
          response.modelOptions.transcription[0] ||
          "ggml-large-v3-turbo-q5_0",
      );
      setSummarizationModel(
        response.metadata.summarization_model_name?.trim() ||
          response.modelOptions.summarization[0] ||
          "qwen2.5-0.5b-instruct",
      );
      const savedAgent = response.settings["CONNECTED_AGENT"];
      if (savedAgent && typeof savedAgent === "string") {
        const normalized = savedAgent.charAt(0).toUpperCase() + savedAgent.slice(1).toLowerCase();
        const agentLabel = CONNECTED_AGENT_OPTIONS.find(
          (opt) => opt.toLowerCase() === savedAgent.toLowerCase()
        );
        if (agentLabel) {
          setConnectedAgent(agentLabel);
        } else if (normalized === "Sunday") {
          setConnectedAgent("Ollama");
          void saveAppSettings({ CONNECTED_AGENT: "ollama" }).catch(() => undefined);
        } else if (normalized) {
          setConnectedAgent(normalized);
        }
      }
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

  const handleCalendarIdChange = React.useCallback((value: string) => {
    setSettings((current) => ({
      ...current,
      TARGET_CALENDAR_ID: value,
    }));
    setSettingsMetadata((current) => {
      if (!current.target_calendar_label) {
        return current;
      }

      const { target_calendar_label: _, ...rest } = current;
      return rest;
    });
  }, []);

  const handleTextInputFocus = React.useCallback(
    (target: number) => {
      setTimeout(() => {
        const responder = scrollViewRef.current as ScrollView & {
          scrollResponderScrollNativeHandleToKeyboard?: (
            nodeHandle: number,
            additionalOffset?: number,
            preventNegativeScrollOffset?: boolean,
          ) => void;
        };
        responder.scrollResponderScrollNativeHandleToKeyboard?.(
          target,
          KEYBOARD_ROW_CLEARANCE,
          true,
        );
      }, 40);
    },
    [],
  );

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

  const openOptionPicker = React.useCallback(
    (kind: OptionSheetKind) => {
      setActiveOptionPicker(kind);
      if (kind === "agent") {
        setPendingOptionValue(connectedAgent || "Ollama");
      } else if (kind === "transcription-model") {
        setPendingOptionValue(transcriptionModel || "ggml-large-v3-turbo-q5_0");
      } else {
        setPendingOptionValue(summarizationModel || "qwen2.5-0.5b-instruct");
      }
      setIsOptionPickerVisible(true);
    },
    [connectedAgent, summarizationModel, transcriptionModel],
  );

  const openCalendarIdEditor = React.useCallback(() => {
    setIsEditingCalendarId(true);
  }, []);

  const closeCalendarIdEditor = React.useCallback(() => {
    setIsEditingCalendarId(false);
  }, []);

  const closeTimezonePicker = React.useCallback(() => {
    setIsTimezonePickerVisible(false);
  }, []);

  const closeOptionPicker = React.useCallback(() => {
    setIsOptionPickerVisible(false);
  }, []);

  const confirmTimezonePicker = React.useCallback(() => {
    handleTextChange("TIMEZONE", pendingTimezone || "America/Chicago");
    setIsTimezonePickerVisible(false);
  }, [handleTextChange, pendingTimezone]);

  const confirmOptionPicker = React.useCallback(() => {
    if (activeOptionPicker === "agent") {
      const agentValue = pendingOptionValue || "Ollama";
      setConnectedAgent(agentValue);
      void saveAppSettings({ CONNECTED_AGENT: agentValue.toLowerCase() }).catch((err) => {
        console.warn("[sunday] failed to save agent setting", err);
      });
    } else if (activeOptionPicker === "transcription-model") {
      setTranscriptionModel(pendingOptionValue || "ggml-large-v3-turbo-q5_0");
    } else if (activeOptionPicker === "summarization-model") {
      setSummarizationModel(pendingOptionValue || "qwen2.5-0.5b-instruct");
    }
    setIsOptionPickerVisible(false);
  }, [activeOptionPicker, pendingOptionValue]);

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
          setSettingsMetadata(response.metadata ?? {});
          setWarnings(response.warnings);
          setErrors(response.errors);
          setTranscriptionModelOptions(response.modelOptions.transcription);
          setSummarizationModelOptions(response.modelOptions.summarization);
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
  const timeZoneDisplayValue = React.useMemo(
    () => formatTimeZoneLabel(String(settings.TIMEZONE ?? "") || "America/Chicago"),
    [settings.TIMEZONE],
  );
  const targetCalendarDisplayValue =
    settingsMetadata.target_calendar_label?.trim() ||
    String(settings.TARGET_CALENDAR_ID ?? "").trim() ||
    "Primary";
  const headerTopInset = insets.top + 8;
  const timezoneSheetHiddenY = Math.max(windowHeight, 420);
  const calendarFieldExpandedWidth = Math.min(262, Math.max(196, windowWidth * 0.52));
  const calendarFieldCollapsedWidth = Math.min(
    220,
    Math.max(72, Math.ceil(calendarDisplayWidth + 16)),
  );
  const calendarFieldAnimatedStyle = React.useMemo(
    () => ({
      width: calendarEditorProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [calendarFieldCollapsedWidth, calendarFieldExpandedWidth],
      }),
      transform: [
        {
          translateX: calendarEditorProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -10],
          }),
        },
      ],
    }),
    [calendarEditorProgress, calendarFieldCollapsedWidth, calendarFieldExpandedWidth],
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

  const optionPickerConfig = React.useMemo(() => {
    if (activeOptionPicker === "agent") {
      return {
        title: "Agent",
        options: CONNECTED_AGENT_OPTIONS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "transcription-model") {
      return {
        title: "Transcription Model",
        options:
          transcriptionModelOptions.length > 0
            ? transcriptionModelOptions
            : [transcriptionModel],
        recommendedOption: RECOMMENDED_TRANSCRIPTION_MODEL,
      };
    }
    if (activeOptionPicker === "summarization-model") {
      return {
        title: "Summarization Model",
        options:
          summarizationModelOptions.length > 0
            ? summarizationModelOptions
            : [summarizationModel],
        recommendedOption: RECOMMENDED_SUMMARIZATION_MODEL,
      };
    }
    return null;
  }, [activeOptionPicker, summarizationModel, summarizationModelOptions, transcriptionModel, transcriptionModelOptions]);

  React.useEffect(() => {
    if (isOptionPickerVisible) {
      setIsOptionPickerMounted(true);
      optionBackdropOpacity.stopAnimation();
      optionSheetTranslateY.stopAnimation();
      optionBackdropOpacity.setValue(0);
      optionSheetTranslateY.setValue(timezoneSheetHiddenY);
      Animated.parallel([
        Animated.timing(optionBackdropOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(optionSheetTranslateY, {
          toValue: 0,
          speed: 11,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!isOptionPickerMounted) {
      return;
    }

    optionBackdropOpacity.stopAnimation();
    optionSheetTranslateY.stopAnimation();
    Animated.parallel([
      Animated.timing(optionBackdropOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(optionSheetTranslateY, {
          toValue: -10,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(optionSheetTranslateY, {
          toValue: timezoneSheetHiddenY,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished }) => {
      if (finished) {
        setIsOptionPickerMounted(false);
      }
    });
  }, [
    isOptionPickerMounted,
    isOptionPickerVisible,
    optionBackdropOpacity,
    optionSheetTranslateY,
    timezoneSheetHiddenY,
  ]);

  React.useEffect(() => {
    if (isTimezonePickerVisible) {
      setIsTimezonePickerMounted(true);
      timezoneBackdropOpacity.stopAnimation();
      timezoneSheetTranslateY.stopAnimation();
      timezoneBackdropOpacity.setValue(0);
      timezoneSheetTranslateY.setValue(timezoneSheetHiddenY);
      Animated.parallel([
        Animated.timing(timezoneBackdropOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(timezoneSheetTranslateY, {
          toValue: 0,
          speed: 11,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!isTimezonePickerMounted) {
      return;
    }

    timezoneBackdropOpacity.stopAnimation();
    timezoneSheetTranslateY.stopAnimation();
    Animated.parallel([
      Animated.timing(timezoneBackdropOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(timezoneSheetTranslateY, {
          toValue: -10,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(timezoneSheetTranslateY, {
          toValue: timezoneSheetHiddenY,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished }) => {
      if (finished) {
        setIsTimezonePickerMounted(false);
      }
    });
  }, [
    isTimezonePickerMounted,
    isTimezonePickerVisible,
    timezoneBackdropOpacity,
    timezoneSheetHiddenY,
    timezoneSheetTranslateY,
  ]);

  React.useEffect(() => {
    if (!isEditingCalendarId) {
      return;
    }

    const timeout = setTimeout(() => {
      calendarIdInputRef.current?.focus();
    }, 40);

    return () => clearTimeout(timeout);
  }, [isEditingCalendarId]);

  React.useEffect(() => {
    Animated.spring(calendarEditorProgress, {
      toValue: isEditingCalendarId ? 1 : 0,
      speed: 22,
      bounciness: 8,
      useNativeDriver: false,
    }).start();
  }, [calendarEditorProgress, isEditingCalendarId]);

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
        ref={scrollViewRef}
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustKeyboardInsets
        bounces
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
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
                              styles.locationFieldRow,
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
                            ios_backgroundColor={TOGGLE_OFF}
                            trackColor={{ false: TOGGLE_OFF, true: TOGGLE_ON }}
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
                          (field.kind === "boolean" ||
                            field.key === "TARGET_CALENDAR_ID" ||
                            isNumericPickerKey(field.key) ||
                            isTimeSettingKey(field.key) ||
                            field.key === "TIMEZONE") &&
                            styles.fieldRowInline,
                          styles.fieldRow,
                          index !== section.fields.length - 1 && styles.fieldRowBorder,
                        ]}
                      >
                        <View
                          style={[
                            styles.fieldHeader,
                            (field.kind === "boolean" ||
                              field.key === "TARGET_CALENDAR_ID" ||
                              isNumericPickerKey(field.key) ||
                              isTimeSettingKey(field.key) ||
                              field.key === "TIMEZONE") &&
                              styles.fieldHeaderInline,
                          ]}
                        >
                          <Text numberOfLines={1} style={styles.fieldLabel}>
                            {field.label}
                          </Text>
                        </View>

                        {field.kind === "boolean" ? (
                          <Switch
                            value={boolValue}
                            onValueChange={(value) => handleToggleChange(field.key, value)}
                            ios_backgroundColor={TOGGLE_OFF}
                            trackColor={{ false: TOGGLE_OFF, true: TOGGLE_ON }}
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
                                accentColor="#ffffff"
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
                        ) : field.key === "TARGET_CALENDAR_ID" ? (
                          <Animated.View
                            style={[styles.calendarFieldAnimatedWrap, calendarFieldAnimatedStyle]}
                          >
                            <Text
                              onLayout={(event) => setCalendarDisplayWidth(event.nativeEvent.layout.width)}
                              style={[
                                styles.calendarMeasureText,
                                styles.selectTriggerText,
                              ]}
                            >
                              {targetCalendarDisplayValue}
                            </Text>
                            {isEditingCalendarId ? (
                              <TextInput
                                ref={calendarIdInputRef}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardAppearance="dark"
                                multiline={false}
                                numberOfLines={1}
                                onBlur={closeCalendarIdEditor}
                                onChangeText={handleCalendarIdChange}
                                onFocus={(event) => handleTextInputFocus(event.nativeEvent.target)}
                                onSubmitEditing={closeCalendarIdEditor}
                                placeholder={field.placeholder}
                                placeholderTextColor="#6f6f6f"
                                selectTextOnFocus
                                style={[styles.input, styles.calendarIdInput]}
                                value={stringValue}
                              />
                            ) : (
                              <Pressable
                                onPress={openCalendarIdEditor}
                                style={[styles.selectTrigger, styles.calendarSelectTrigger]}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={[styles.selectTriggerText, styles.calendarSelectTriggerText]}
                                >
                                  {targetCalendarDisplayValue}
                                </Text>
                              </Pressable>
                            )}
                          </Animated.View>
                        ) : field.key === "TIMEZONE" ? (
                          <Pressable onPress={openTimezonePicker} style={styles.selectTrigger}>
                            <Text numberOfLines={1} style={styles.selectTriggerText}>
                              {timeZoneDisplayValue || field.placeholder || "Select"}
                            </Text>
                          </Pressable>
                        ) : isNumericPickerKey(field.key) ? (
                          (() => {
                            const numericKey = field.key;
                            return (
                              <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                inputMode="numeric"
                                keyboardAppearance="dark"
                                keyboardType="number-pad"
                                onChangeText={(value) =>
                                  handleTextChange(numericKey, value.replace(/[^\d]/g, ""))
                                }
                                onFocus={(event) => handleTextInputFocus(event.nativeEvent.target)}
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
                            keyboardAppearance="dark"
                            keyboardType={getKeyboardType(field.kind)}
                            onChangeText={(value) => handleTextChange(field.key, value)}
                            onFocus={(event) => handleTextInputFocus(event.nativeEvent.target)}
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

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connections</Text>
              <View style={styles.sectionPanel}>
              <View style={[styles.fieldRow, styles.fieldRowInline, styles.fieldRowBorder]}>
                <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                  <Text numberOfLines={1} style={styles.fieldLabel}>
                    Agent
                  </Text>
                </View>
                <Pressable onPress={() => openOptionPicker("agent")} style={styles.selectTrigger}>
                  <Text numberOfLines={1} style={styles.selectTriggerText}>
                    {connectedAgent}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Models</Text>
            <View style={styles.sectionPanel}>
              <View style={[styles.fieldRow, styles.fieldRowInline, styles.fieldRowBorder]}>
                <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                  <Text numberOfLines={1} style={styles.fieldLabel}>
                    Transcription
                  </Text>
                </View>
                <Pressable
                  onPress={() => openOptionPicker("transcription-model")}
                  style={styles.selectTrigger}
                >
                  <Text numberOfLines={1} style={styles.selectTriggerText}>
                    {transcriptionModel}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.fieldRow, styles.fieldRowInline]}>
                <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                  <Text numberOfLines={1} style={styles.fieldLabel}>
                    Summarization
                  </Text>
                </View>
                <Pressable
                  onPress={() => openOptionPicker("summarization-model")}
                  style={styles.selectTrigger}
                >
                  <Text numberOfLines={1} style={styles.selectTriggerText}>
                    {summarizationModel}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

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

      {isTimezonePickerMounted ? (
        <Modal
          transparent
          animationType="none"
          visible
          onRequestClose={closeTimezonePicker}
        >
          <View style={styles.sheetModalRoot}>
            <Animated.View
              pointerEvents="none"
              style={[styles.sheetBackdrop, { opacity: timezoneBackdropOpacity }]}
            />
            <Pressable style={StyleSheet.absoluteFill} onPress={closeTimezonePicker} />
            <Animated.View
              style={[
                styles.sheetPanel,
                {
                  paddingBottom: insets.bottom + 14 + TIMEZONE_SHEET_OVERDRAW,
                  marginBottom: -TIMEZONE_SHEET_OVERDRAW,
                  transform: [{ translateY: timezoneSheetTranslateY }],
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <Pressable
                  hitSlop={10}
                  onPress={closeTimezonePicker}
                  style={[styles.sheetHeaderButton, styles.sheetHeaderButtonGhost]}
                >
                  <Text style={styles.sheetHeaderButtonGhostText}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>Time Zone</Text>
                <Pressable
                  hitSlop={10}
                  onPress={confirmTimezonePicker}
                  style={[styles.sheetHeaderButton, styles.sheetHeaderButtonFilled]}
                >
                  <Text style={styles.sheetHeaderButtonFilledText}>Done</Text>
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
                      label={formatTimeZoneLabel(option)}
                      value={option}
                      color="#ffffff"
                    />
                  ))}
                </Picker>
              </View>
            </Animated.View>
          </View>
        </Modal>
      ) : null}

      {isOptionPickerMounted && optionPickerConfig ? (
        <Modal
          transparent
          animationType="none"
          visible
          onRequestClose={closeOptionPicker}
        >
          <View style={styles.sheetModalRoot}>
            <Animated.View
              pointerEvents="none"
              style={[styles.sheetBackdrop, { opacity: optionBackdropOpacity }]}
            />
            <Pressable style={StyleSheet.absoluteFill} onPress={closeOptionPicker} />
            <Animated.View
              style={[
                styles.sheetPanel,
                {
                  paddingBottom: insets.bottom + 14 + TIMEZONE_SHEET_OVERDRAW,
                  marginBottom: -TIMEZONE_SHEET_OVERDRAW,
                  transform: [{ translateY: optionSheetTranslateY }],
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <Pressable
                  hitSlop={10}
                  onPress={closeOptionPicker}
                  style={[styles.sheetHeaderButton, styles.sheetHeaderButtonGhost]}
                >
                  <Text style={styles.sheetHeaderButtonGhostText}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>{optionPickerConfig.title}</Text>
                <Pressable
                  hitSlop={10}
                  onPress={confirmOptionPicker}
                  style={[styles.sheetHeaderButton, styles.sheetHeaderButtonFilled]}
                >
                  <Text style={styles.sheetHeaderButtonFilledText}>Done</Text>
                </Pressable>
              </View>
              <View style={styles.sheetPickerWrap}>
                <Picker
                  selectedValue={pendingOptionValue}
                  onValueChange={(value) => setPendingOptionValue(String(value))}
                  itemStyle={styles.sheetPickerItem}
                  style={styles.sheetPicker}
                >
                  {optionPickerConfig.options.map((option) => (
                    <Picker.Item
                      key={option}
                      label={formatModelOptionLabel(option, optionPickerConfig.recommendedOption)}
                      value={option}
                      color="#ffffff"
                    />
                  ))}
                </Picker>
              </View>
            </Animated.View>
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
    paddingVertical: 10,
    backgroundColor: PANEL,
    gap: 8,
  },
  fieldRowInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  locationFieldRow: {
    paddingLeft: 12,
    paddingRight: 14,
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
    paddingRight: 12,
  },
  fieldLabel: {
    color: "#ffffff",
    fontFamily: FONTS.medium,
    fontSize: 15,
  },
  input: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 12,
    color: "#ffffff",
    backgroundColor: PANEL_ALT,
    fontFamily: FONTS.regular,
    fontSize: 14,
  },
  timePicker: {
    width: Platform.OS === "ios" ? 118 : 128,
    alignSelf: "center",
    marginRight: Platform.OS === "ios" ? -8 : 0,
    transform: Platform.OS === "ios" ? [{ scale: 0.95 }] : undefined,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationFieldHeader: {
    flex: 0,
    width: 24,
    height: 24,
    marginLeft: 3,
    paddingRight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  locationIconWrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  locationValueButton: {
    minHeight: 38,
    maxWidth: "100%",
    flexShrink: 1,
    borderRadius: 999,
    backgroundColor: PANEL_ALT,
    marginLeft: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: "center",
  },
  locationValueText: {
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 14,
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
    minHeight: 38,
    maxWidth: 220,
    borderRadius: 999,
    paddingLeft: 11,
    paddingRight: 11,
    backgroundColor: PANEL_ALT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    alignSelf: "flex-end",
    gap: 8,
  },
  calendarSelectTrigger: {
    width: "100%",
    maxWidth: "100%",
    justifyContent: "flex-end",
    paddingLeft: 8,
    paddingRight: 8,
  },
  calendarFieldAnimatedWrap: {
    alignSelf: "flex-end",
  },
  calendarMeasureText: {
    position: "absolute",
    opacity: 0,
    left: -9999,
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 14,
    textAlign: "right",
  },
  calendarIdInput: {
    width: "100%",
    height: 38,
    minHeight: 0,
    paddingVertical: 0,
    textAlign: "left",
  },
  selectTriggerText: {
    flexShrink: 1,
    color: "#ffffff",
    fontFamily: FONTS.regular,
    fontSize: 14,
    textAlign: "left",
  },
  calendarSelectTriggerText: {
    width: "100%",
    textAlign: "right",
  },
  numericInput: {
    width: 66,
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 0,
    color: "#ffffff",
    backgroundColor: PANEL_ALT,
    fontFamily: FONTS.regular,
    fontSize: 15,
    textAlign: "center",
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
    width: 38,
    height: 38,
    borderRadius: 19,
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
  sheetModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
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
  sheetHeaderButton: {
    minWidth: 72,
    paddingVertical: 10,
  },
  sheetHeaderButtonGhost: {
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#1d1d1f",
    paddingHorizontal: 14,
  },
  sheetHeaderButtonFilled: {
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: ACCENT,
    paddingHorizontal: 14,
  },
  sheetHeaderButtonGhostText: {
    color: MUTED,
    fontFamily: FONTS.semibold,
    fontSize: 15,
  },
  sheetHeaderButtonFilledText: {
    color: BACKGROUND,
    fontFamily: FONTS.semibold,
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
