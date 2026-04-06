import React from "react";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import {
  ActivityIndicator,
  AppState,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  LocationPickerModal,
  SelectedLocation,
} from "../components/LocationPickerModal";
import { TextSegmentedSelector } from "../components/TextSegmentedSelector";
import { TravelTypeSelector } from "../components/TravelTypeSelector";
import { FONTS } from "../constants/fonts";
import {
  saveConnectionPreferences,
} from "../lib/connectionPreferences";
import { getCurrentPositionAsync } from "expo-location";
import {
  getPhoneLocationPermissionState,
  getPhoneLocationEnabledPreference,
  requestPhoneLocationAccess,
  setPhoneLocationEnabledPreference,
} from "../lib/phoneLocationPreference";
import {
  AppSettingsValues,
  fetchAppSettings,
  reverseGeocodeLocation,
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
  "AUTO_CLEANUP_HOURS",
  "LLM_MAX_TOKENS",
  "LLM_REQUESTS_PER_MINUTE",
  "LLM_RETRY_ATTEMPTS",
  "TRANSCRIPTION_THREADS",
  "TRANSCRIPT_TITLE_MAX_NEW_TOKENS",
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
  "Sunday",
  "OpenAI",
  "Anthropic",
  "Gemini",
  "Ollama",
  "OpenClaw",
] as const;
const MESSAGE_CHANNEL_OPTIONS = ["iMessage", "Telegram", "WhatsApp"] as const;
const BACKEND_OPTIONS = ["Self-hosted", "Hosted"] as const;
const RECOMMENDED_TRANSCRIPTION_MODEL = "ggml-small.en-q5_1";
const RECOMMENDED_SUMMARIZATION_MODEL = "qwen2.5-0.5b-instruct";
const LLM_PROVIDER_OPTIONS = [
  "gemini",
  "openrouter",
  "groq",
  "cerebras",
  "ollama",
  "together",
  "mistral",
  "huggingface",
  "custom",
] as const;
const TITLE_DEVICE_OPTIONS = ["auto", "cpu", "mps", "cuda"] as const;
const LOG_LEVEL_OPTIONS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;
const STANDARD_SECTION_ORDER = [
  "Calendar",
  "Locations",
  "Schedule",
  "Messaging",
  "Provider",
  "Google",
  "Runtime",
  "Danger Zone",
] as const;
const TOP_SECTION_TITLES = new Set(["Calendar", "Locations", "Schedule"]);
const COLLAPSIBLE_SECTION_TITLES = new Set(["Provider", "Google", "Runtime", "Danger Zone"]);
type FieldKind = "text" | "number" | "decimal" | "boolean" | "choice" | "select" | "secret";
type OptionSheetKind =
  | "agent"
  | "MESSAGE_CHANNEL"
  | "AGENT_MODE"
  | "transcription-model"
  | "summarization-model"
  | "ACTIVE_LLM_PROVIDER"
  | "TRANSCRIPT_TITLE_DEVICE"
  | "LOG_LEVEL";

const AGENT_MODE_OPTIONS = ["off", "builtin", "openclaw", "both"] as const;
const AGENT_MODE_LABELS: Record<string, string> = {
  off: "Off",
  builtin: "Built-in AI",
  both: "Both",
  openclaw: "OpenClaw",
};
const MESSAGE_CHANNEL_LABELS: Record<string, string> = {
  iMessage: "iOS Messages",
  Telegram: "Telegram",
  WhatsApp: "WhatsApp",
};

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
  tone?: "default" | "danger";
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

type ConnectionFieldConfig = {
  key: string;
  label: string;
  placeholder: string;
  secure: boolean;
};

type ValidationBucket = {
  errors: string[];
  warnings: string[];
};

type ValidationState = {
  byKey: Record<string, ValidationBucket>;
  unmatchedErrors: string[];
  unmatchedWarnings: string[];
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

const PROVIDER_API_KEY_FIELD_KEYS: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
  custom: "CUSTOM_LLM_API_KEY",
};

const PROVIDER_MODEL_FIELD_KEYS: Record<string, string> = {
  gemini: "GEMINI_MODEL",
  openrouter: "OPENROUTER_MODEL",
  groq: "GROQ_MODEL",
  cerebras: "CEREBRAS_MODEL",
  ollama: "OLLAMA_MODEL",
  together: "TOGETHER_MODEL",
  mistral: "MISTRAL_MODEL",
  huggingface: "HUGGINGFACE_MODEL",
  custom: "CUSTOM_LLM_MODEL",
};

const PROVIDER_BASE_URL_FIELD_KEYS: Record<string, string> = {
  ollama: "OLLAMA_BASE_URL",
  custom: "CUSTOM_LLM_BASE_URL",
};

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

function SectionChevronRightIcon({
  size = 22,
  color = "#e3e3e3",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"
        fill={color}
      />
    </Svg>
  );
}

function SectionChevronDownIcon({
  size = 22,
  color = "#e3e3e3",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"
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
        label: "Time zone",
        description: "Choose a valid IANA time zone.",
        placeholder: "America/Chicago",
        kind: "select",
        options: [...DEFAULT_TIMEZONE_OPTIONS],
      },
      {
        key: "TEXT_EMAIL_LINKS",
        label: "Include links in reminders",
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
        kind: "text",
      },
      {
        key: "WORKDAY_START_TIME",
        label: "Workday start",
        placeholder: "09:00",
        kind: "text",
      },
      {
        key: "WORKDAY_END_TIME",
        label: "Workday end",
        placeholder: "17:00",
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
  {
    title: "Messaging",
    fields: [
      {
        key: "MESSAGE_CHANNEL",
        label: "Channel",
        kind: "select",
        options: [...MESSAGE_CHANNEL_OPTIONS],
      },
      {
        key: "IMESSAGE_RECIPIENT",
        label: "Send to",
        kind: "text",
        placeholder: "+1...",
      },
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Telegram bot token",
        kind: "secret",
        placeholder: "bot token from @BotFather",
      },
      {
        key: "TELEGRAM_CHAT_ID",
        label: "Telegram chat ID",
        kind: "secret",
        placeholder: "your chat ID",
      },
      {
        key: "WHATSAPP_ACCESS_TOKEN",
        label: "WhatsApp access token",
        kind: "secret",
        placeholder: "EAAG...",
      },
      {
        key: "WHATSAPP_PHONE_NUMBER_ID",
        label: "WhatsApp phone number ID",
        kind: "text",
        placeholder: "123456789012345",
      },
      {
        key: "WHATSAPP_RECIPIENT",
        label: "WhatsApp recipient",
        kind: "text",
        placeholder: "12175551234",
      },
    ],
  },
  {
    title: "Provider",
    fields: [
      {
        key: "ACTIVE_LLM_PROVIDER",
        label: "LLM provider",
        kind: "select",
        options: [...LLM_PROVIDER_OPTIONS],
      },
      {
        key: "AGENT_MODE",
        label: "Agent mode",
        kind: "select",
        options: [...AGENT_MODE_OPTIONS],
      },
      {
        key: "OPENCLAW_ENABLED",
        label: "OpenClaw enabled",
        kind: "boolean",
      },
      {
        key: "GEMINI_MODEL",
        label: "Gemini model",
        kind: "text",
      },
      {
        key: "OPENROUTER_MODEL",
        label: "OpenRouter model",
        kind: "text",
      },
      {
        key: "OPENROUTER_SITE_URL",
        label: "OpenRouter site URL",
        kind: "text",
      },
      {
        key: "OPENROUTER_APP_NAME",
        label: "OpenRouter app name",
        kind: "text",
      },
      {
        key: "GROQ_MODEL",
        label: "Groq model",
        kind: "text",
      },
      {
        key: "CEREBRAS_MODEL",
        label: "Cerebras model",
        kind: "text",
      },
      {
        key: "OLLAMA_BASE_URL",
        label: "Ollama base URL",
        kind: "text",
      },
      {
        key: "OLLAMA_MODEL",
        label: "Ollama model",
        kind: "text",
      },
      {
        key: "TOGETHER_MODEL",
        label: "Together model",
        kind: "text",
      },
      {
        key: "MISTRAL_MODEL",
        label: "Mistral model",
        kind: "text",
      },
      {
        key: "HUGGINGFACE_MODEL",
        label: "Hugging Face model",
        kind: "text",
      },
      {
        key: "CUSTOM_LLM_BASE_URL",
        label: "Custom base URL",
        kind: "text",
      },
      {
        key: "CUSTOM_LLM_MODEL",
        label: "Custom model",
        kind: "text",
      },
      {
        key: "OPENCLAW_BASE_URL",
        label: "OpenClaw base URL",
        kind: "text",
      },
    ],
  },
  {
    title: "Google",
    fields: [
      {
        key: "GOOGLE_CREDENTIALS_FILE",
        label: "Credentials file",
        kind: "text",
      },
      {
        key: "GOOGLE_TOKEN_FILE",
        label: "Token file",
        kind: "text",
      },
    ],
  },
  {
    title: "Runtime",
    fields: [
      {
        key: "AUTO_CLEANUP_HOURS",
        label: "Auto cleanup hours",
        kind: "number",
      },
      {
        key: "GMAIL_LABELS",
        label: "Gmail labels",
        placeholder: "CATEGORY_PRIMARY",
        kind: "text",
      },
      {
        key: "STATE_DIR",
        label: "State directory",
        kind: "text",
      },
      {
        key: "LLM_MAX_TOKENS",
        label: "LLM max tokens",
        kind: "number",
      },
      {
        key: "LLM_TEMPERATURE",
        label: "LLM temperature",
        kind: "decimal",
      },
      {
        key: "LLM_REQUESTS_PER_MINUTE",
        label: "LLM requests per minute",
        kind: "number",
      },
      {
        key: "LLM_RETRY_ATTEMPTS",
        label: "LLM retry attempts",
        kind: "number",
      },
      {
        key: "LLM_RETRY_BASE_SECONDS",
        label: "LLM retry base seconds",
        kind: "decimal",
      },
      {
        key: "TRANSCRIPTION_LANGUAGE",
        label: "Transcription language",
        kind: "text",
      },
      {
        key: "TRANSCRIPTION_THREADS",
        label: "Transcription threads",
        kind: "number",
      },
      {
        key: "TRANSCRIPT_TITLE_DEVICE",
        label: "Summary device",
        kind: "select",
        options: [...TITLE_DEVICE_OPTIONS],
      },
      {
        key: "TRANSCRIPT_TITLE_MAX_NEW_TOKENS",
        label: "Summary max new tokens",
        kind: "number",
      },
      {
        key: "LOG_LEVEL",
        label: "Log level",
        kind: "select",
        options: [...LOG_LEVEL_OPTIONS],
      },
    ],
  },
  {
    title: "Danger Zone",
    tone: "danger",
    fields: [
      {
        key: "SUNDAY_API_KEY",
        label: "Sunday API key",
        kind: "secret",
      },
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API key",
        kind: "secret",
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        kind: "secret",
      },
      {
        key: "GEMINI_API_KEY",
        label: "Gemini API key",
        kind: "secret",
      },
      {
        key: "OPENROUTER_API_KEY",
        label: "OpenRouter API key",
        kind: "secret",
      },
      {
        key: "GROQ_API_KEY",
        label: "Groq API key",
        kind: "secret",
      },
      {
        key: "CEREBRAS_API_KEY",
        label: "Cerebras API key",
        kind: "secret",
      },
      {
        key: "TOGETHER_API_KEY",
        label: "Together API key",
        kind: "secret",
      },
      {
        key: "MISTRAL_API_KEY",
        label: "Mistral API key",
        kind: "secret",
      },
      {
        key: "HUGGINGFACE_API_KEY",
        label: "Hugging Face API key",
        kind: "secret",
      },
      {
        key: "CUSTOM_LLM_API_KEY",
        label: "Custom API key",
        kind: "secret",
      },
      {
        key: "GOOGLE_MAPS_API_KEY",
        label: "Google Maps API key",
        kind: "secret",
      },
      {
        key: "OPENCLAW_TOKEN",
        label: "OpenClaw token",
        kind: "secret",
      },
    ],
  },
];

const KNOWN_VALIDATION_KEYS = Array.from(
  new Set([
    ...SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)),
    "CONNECTION_AGENT",
    "BACKEND_TARGET",
    "VERCEL_BASE_URL",
    "TRANSCRIPTION_MODEL_PATH",
    "TRANSCRIPT_TITLE_MODEL_PATH",
  ]),
);

const VALIDATION_KEY_ALIASES: Record<string, string[]> = {
  DEFAULT_HOME_LATITUDE: ["DEFAULT_HOME_LOCATION"],
  DEFAULT_HOME_LONGITUDE: ["DEFAULT_HOME_LOCATION"],
  DEFAULT_WORK_LATITUDE: ["DEFAULT_WORK_LOCATION"],
  DEFAULT_WORK_LONGITUDE: ["DEFAULT_WORK_LOCATION"],
};

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values));
}

function resolveValidationKeys(keys: string[]) {
  return dedupeStrings(
    keys.flatMap((key) => VALIDATION_KEY_ALIASES[key] ?? [key]),
  );
}

function extractProviderName(message: string) {
  const match = message.match(/provider '([^']+)'/i);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

function inferValidationTargetKeys(message: string) {
  const upperMessage = message.toUpperCase();
  const directMatches = resolveValidationKeys(
    KNOWN_VALIDATION_KEYS.filter((key) => upperMessage.includes(key)),
  );
  if (directMatches.length > 0) {
    return directMatches;
  }

  const providerName = extractProviderName(message);

  if (upperMessage.startsWith("UNKNOWN LLM PROVIDER")) {
    return ["ACTIVE_LLM_PROVIDER"];
  }
  if (upperMessage.startsWith("NO API KEY SET FOR LLM PROVIDER")) {
    const providerKey = providerName ? PROVIDER_API_KEY_FIELD_KEYS[providerName] : null;
    return providerKey ? [providerKey] : ["ACTIVE_LLM_PROVIDER"];
  }
  if (upperMessage.startsWith("NO MODEL CONFIGURED FOR LLM PROVIDER")) {
    const providerKey = providerName ? PROVIDER_MODEL_FIELD_KEYS[providerName] : null;
    return providerKey ? [providerKey] : ["ACTIVE_LLM_PROVIDER"];
  }
  if (upperMessage.startsWith("NO BASE URL CONFIGURED FOR LLM PROVIDER")) {
    const providerKey = providerName ? PROVIDER_BASE_URL_FIELD_KEYS[providerName] : null;
    return providerKey ? [providerKey] : ["ACTIVE_LLM_PROVIDER"];
  }
  if (upperMessage.startsWith("GOOGLE CREDENTIALS FILE NOT FOUND")) {
    return ["GOOGLE_CREDENTIALS_FILE"];
  }
  if (upperMessage.startsWith("GOOGLE_TOKEN_JSON MUST BE CONFIGURED")) {
    return ["BACKEND_TARGET", "GOOGLE_TOKEN_FILE"];
  }
  if (upperMessage.includes("IMESSAGE DELIVERY REQUIRES MACOS")) {
    return ["MESSAGE_CHANNEL"];
  }
  if (upperMessage.includes("IMESSAGE DELIVERY DOES NOT WORK ON HOSTED BACKENDS")) {
    return ["MESSAGE_CHANNEL", "BACKEND_TARGET"];
  }
  if (upperMessage.startsWith("SPEECH TRANSCRIPTION MODEL NOT FOUND")) {
    return ["TRANSCRIPTION_MODEL_PATH"];
  }
  if (upperMessage.startsWith("TRANSCRIPT TITLE MODEL NOT FOUND")) {
    return ["TRANSCRIPT_TITLE_MODEL_PATH"];
  }

  return [];
}

function buildValidationState(errors: string[], warnings: string[]): ValidationState {
  const byKey: Record<string, ValidationBucket> = {};
  const unmatchedErrors: string[] = [];
  const unmatchedWarnings: string[] = [];

  const pushMessage = (key: string, kind: keyof ValidationBucket, message: string) => {
    const bucket = byKey[key] ?? { errors: [], warnings: [] };
    if (!bucket[kind].includes(message)) {
      bucket[kind].push(message);
    }
    byKey[key] = bucket;
  };

  for (const message of errors) {
    const targetKeys = inferValidationTargetKeys(message);
    if (targetKeys.length === 0) {
      unmatchedErrors.push(message);
      continue;
    }
    for (const key of targetKeys) {
      pushMessage(key, "errors", message);
    }
  }

  for (const message of warnings) {
    const targetKeys = inferValidationTargetKeys(message);
    if (targetKeys.length === 0) {
      unmatchedWarnings.push(message);
      continue;
    }
    for (const key of targetKeys) {
      pushMessage(key, "warnings", message);
    }
  }

  return {
    byKey,
    unmatchedErrors,
    unmatchedWarnings,
  };
}

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
  values.CONNECTION_AGENT = "Ollama";
  values.BACKEND_TARGET = Platform.OS === "web" ? "Hosted" : "Self-hosted";
  values.VERCEL_BASE_URL = "";
  values.MESSAGE_CHANNEL = "Telegram";
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

function getConnectionFieldConfig(agent: string): ConnectionFieldConfig {
  switch (agent) {
    case "OpenAI":
      return {
        key: "OPENAI_API_KEY",
        label: "API key",
        placeholder: "sk-...",
        secure: true,
      };
    case "Anthropic":
      return {
        key: "ANTHROPIC_API_KEY",
        label: "API key",
        placeholder: "sk-ant-...",
        secure: true,
      };
    case "Gemini":
      return {
        key: "GEMINI_API_KEY",
        label: "API key",
        placeholder: "AIza...",
        secure: true,
      };
    case "Ollama":
      return {
        key: "OLLAMA_BASE_URL",
        label: "Endpoint URL",
        placeholder: "http://localhost:11434",
        secure: false,
      };
    case "OpenClaw":
      return {
        key: "OPENCLAW_BASE_URL",
        label: "Endpoint URL",
        placeholder: "http://localhost:8001",
        secure: false,
      };
    case "Sunday":
    default:
      return {
        key: "SUNDAY_API_KEY",
        label: "API key",
        placeholder: "Sunday key",
        secure: true,
      };
  }
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
  const [phoneLocationLabel, setPhoneLocationLabel] = React.useState<string | null>(null);
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
  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({
    Provider: true,
    Google: true,
    Runtime: true,
    "Danger Zone": true,
  });
  const [connectedAgent, setConnectedAgent] = React.useState("Ollama");
  const [connectionMeasureWidth, setConnectionMeasureWidth] = React.useState(0);
  const [transcriptionModel, setTranscriptionModel] = React.useState("ggml-large-v3-turbo-q5_0");
  const [summarizationModel, setSummarizationModel] = React.useState("qwen2.5-0.5b-instruct");
  const [transcriptionModelOptions, setTranscriptionModelOptions] = React.useState<string[]>([]);
  const [summarizationModelOptions, setSummarizationModelOptions] = React.useState<string[]>([]);
  const [backendTarget, setBackendTarget] = React.useState("Self-hosted");
  const [vercelBaseUrl, setVercelBaseUrl] = React.useState("");
  const lastSavedSettingsRef = React.useRef("");
  const hasLoadedSettingsRef = React.useRef(false);
  const saveSequenceRef = React.useRef(0);
  const settingsRef = React.useRef<AppSettingsValues>(settings);
  const skipNextAutosaveRef = React.useRef(false);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionBackdropOpacity = React.useRef(new Animated.Value(0)).current;
  const optionSheetTranslateY = React.useRef(new Animated.Value(28)).current;
  const timezoneBackdropOpacity = React.useRef(new Animated.Value(0)).current;
  const timezoneSheetTranslateY = React.useRef(new Animated.Value(28)).current;
  const calendarEditorProgress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateInlineStateChange = React.useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 180,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
  }, []);

  const applyValidationState = React.useCallback(
    (nextWarnings: string[], nextErrors: string[]) => {
      animateInlineStateChange();
      setWarnings(nextWarnings);
      setErrors(nextErrors);
    },
    [animateInlineStateChange],
  );

  const syncConnectionStateFromSettings = React.useCallback(
    async (nextSettings: AppSettingsValues) => {
      const nextAgent = String(nextSettings.CONNECTION_AGENT ?? "").trim() || "Ollama";
      const rawBackendTarget = String(nextSettings.BACKEND_TARGET ?? "").trim();
      const nextBackendTarget =
        ["Hosted", "Vercel"].includes(rawBackendTarget)
          ? "Hosted"
          : Platform.OS === "web" && backendTarget === "Hosted"
            ? "Hosted"
            : "Self-hosted";
      const nextVercelBaseUrl = String(nextSettings.VERCEL_BASE_URL ?? "").trim();

      setConnectedAgent(nextAgent);
      setBackendTarget(nextBackendTarget);
      setVercelBaseUrl(nextVercelBaseUrl);

      await saveConnectionPreferences({
        connectedAgent: nextAgent,
        backendTarget: nextBackendTarget,
        vercelBaseUrl: nextVercelBaseUrl,
      });
    },
    [backendTarget],
  );

  const loadSettings = React.useCallback(async () => {
    try {
      const response = await fetchAppSettings();
      const nextSettings = { ...getInitialSettingsState(), ...response.settings };
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      lastSavedSettingsRef.current = serializeSettings(nextSettings);
      hasLoadedSettingsRef.current = true;
      setErrorMessage(null);
      setSettingsMetadata(response.metadata ?? {});
      applyValidationState(response.warnings, response.errors);
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
      void syncConnectionStateFromSettings(nextSettings);
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
  }, [applyValidationState, syncConnectionStateFromSettings]);

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

          if (enabled) {
            try {
              const position = await getCurrentPositionAsync({ accuracy: 4 });
              if (!cancelled) {
                const result = await reverseGeocodeLocation(
                  position.coords.latitude,
                  position.coords.longitude,
                );
                if (!cancelled) {
                  setPhoneLocationLabel(
                    result.label ||
                      `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`,
                  );
                }
              }
            } catch {
              if (!cancelled) {
                setPhoneLocationLabel("Location detected");
              }
            }
          }
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

  React.useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const persistSettingsSnapshot = React.useCallback(
    async (snapshot: AppSettingsValues, saveId: number) => {
      setIsSaving(true);
      setErrorMessage(null);
      try {
        const response = await saveAppSettings(snapshot);
        if (saveId !== saveSequenceRef.current) {
          return;
        }

        const nextSettings = { ...snapshot, ...response.settings };
        settingsRef.current = nextSettings;
        lastSavedSettingsRef.current = serializeSettings(nextSettings);
        setSettings(nextSettings);
        setSettingsMetadata(response.metadata ?? {});
        applyValidationState(response.warnings, response.errors);
        setTranscriptionModelOptions(response.modelOptions.transcription);
        setSummarizationModelOptions(response.modelOptions.summarization);
        setTranscriptionModel(
          response.metadata.transcription_model_name?.trim() ||
            response.modelOptions.transcription[0] ||
            transcriptionModel,
        );
        setSummarizationModel(
          response.metadata.summarization_model_name?.trim() ||
            response.modelOptions.summarization[0] ||
            summarizationModel,
        );
        void syncConnectionStateFromSettings(nextSettings);
        setStatusMessage("Saved");
        statusTimeoutRef.current = setTimeout(() => {
          setStatusMessage((current) => (current === "Saved" ? null : current));
        }, 1200);
      } catch (error) {
        if (saveId !== saveSequenceRef.current) {
          return;
        }
        animateInlineStateChange();
        setErrorMessage(error instanceof Error ? error.message : "Failed to save settings.");
        setStatusMessage(null);
      } finally {
        if (saveId === saveSequenceRef.current) {
          setIsSaving(false);
        }
      }
    },
    [
      animateInlineStateChange,
      applyValidationState,
      summarizationModel,
      syncConnectionStateFromSettings,
      transcriptionModel,
    ],
  );

  const saveImmediately = React.useCallback(
    (snapshot: AppSettingsValues) => {
      if (!hasLoadedSettingsRef.current || isLoading) {
        return;
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }

      skipNextAutosaveRef.current = true;
      const saveId = ++saveSequenceRef.current;
      setStatusMessage("Saving…");
      void persistSettingsSnapshot(snapshot, saveId);
    },
    [isLoading, persistSettingsSnapshot],
  );

  const applySettingsPatch = React.useCallback(
    (
      patch:
        | Partial<AppSettingsValues>
        | ((current: AppSettingsValues) => AppSettingsValues),
      options?: { immediate?: boolean },
    ) => {
      const current = settingsRef.current;
      const next: AppSettingsValues =
        typeof patch === "function" ? patch(current) : ({ ...current, ...patch } as AppSettingsValues);
      settingsRef.current = next;
      setSettings(next);
      if (options?.immediate) {
        saveImmediately(next);
      }
      return next;
    },
    [saveImmediately],
  );

  const handleTextChange = React.useCallback(
    (key: string, value: string) => {
      applySettingsPatch({ [key]: value });
    },
    [applySettingsPatch],
  );

  const handleCalendarIdChange = React.useCallback((value: string) => {
    applySettingsPatch({ TARGET_CALENDAR_ID: value });
    setSettingsMetadata((current) => {
      if (!current.target_calendar_label) {
        return current;
      }

      const { target_calendar_label: _, ...rest } = current;
      return rest;
    });
  }, [applySettingsPatch]);

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

      applySettingsPatch(
        {
          [key]: formatTimeForBackend(selectedDate),
        },
        { immediate: true },
      );
    },
    [applySettingsPatch],
  );

  const handleToggleChange = React.useCallback(
    (key: string, value: boolean) => {
      applySettingsPatch({ [key]: value }, { immediate: true });
    },
    [applySettingsPatch],
  );

  const handleConnectedAgentChange = React.useCallback((nextValue: string) => {
    setConnectedAgent(nextValue);
    applySettingsPatch({ CONNECTION_AGENT: nextValue }, { immediate: true });
    void saveConnectionPreferences({ connectedAgent: nextValue });
  }, [applySettingsPatch]);

  const handleBackendTargetChange = React.useCallback((nextValue: string) => {
    const normalizedTarget = nextValue === "Hosted" ? "Hosted" : "Self-hosted";
    setBackendTarget(normalizedTarget);
    applySettingsPatch({ BACKEND_TARGET: normalizedTarget }, { immediate: true });
    void saveConnectionPreferences({ backendTarget: normalizedTarget });
  }, [applySettingsPatch]);

  const handleVercelBaseUrlChange = React.useCallback((value: string) => {
    setVercelBaseUrl(value);
    applySettingsPatch({ VERCEL_BASE_URL: value });
  }, [applySettingsPatch]);

  const handleVercelBaseUrlBlur = React.useCallback(() => {
    void saveConnectionPreferences({ vercelBaseUrl });
    saveImmediately(settingsRef.current);
  }, [saveImmediately, vercelBaseUrl]);

  const openTimezonePicker = React.useCallback(() => {
    setPendingTimezone(String(settings.TIMEZONE ?? "") || "America/Chicago");
    setIsTimezonePickerVisible(true);
  }, [settings.TIMEZONE]);

  const openOptionPicker = React.useCallback(
    (kind: OptionSheetKind) => {
      setActiveOptionPicker(kind);
      if (kind === "agent") {
        setPendingOptionValue(connectedAgent || "Ollama");
      } else if (kind === "MESSAGE_CHANNEL") {
        setPendingOptionValue(String(settings.MESSAGE_CHANNEL ?? "") || "Telegram");
      } else if (kind === "AGENT_MODE") {
        setPendingOptionValue(String(settings.AGENT_MODE ?? "") || "off");
      } else if (kind === "ACTIVE_LLM_PROVIDER") {
        setPendingOptionValue(String(settings.ACTIVE_LLM_PROVIDER ?? "") || "gemini");
      } else if (kind === "TRANSCRIPT_TITLE_DEVICE") {
        setPendingOptionValue(String(settings.TRANSCRIPT_TITLE_DEVICE ?? "") || "auto");
      } else if (kind === "LOG_LEVEL") {
        setPendingOptionValue(String(settings.LOG_LEVEL ?? "") || "INFO");
      } else if (kind === "transcription-model") {
        setPendingOptionValue(transcriptionModel || "ggml-large-v3-turbo-q5_0");
      } else {
        setPendingOptionValue(summarizationModel || "qwen2.5-0.5b-instruct");
      }
      setIsOptionPickerVisible(true);
    },
    [
      connectedAgent,
      settings.ACTIVE_LLM_PROVIDER,
      settings.MESSAGE_CHANNEL,
      settings.LOG_LEVEL,
      settings.TRANSCRIPT_TITLE_DEVICE,
      summarizationModel,
      transcriptionModel,
    ],
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
      handleConnectedAgentChange(pendingOptionValue || "Ollama");
    } else if (activeOptionPicker === "MESSAGE_CHANNEL") {
      handleTextChange("MESSAGE_CHANNEL", pendingOptionValue || "Telegram");
    } else if (activeOptionPicker === "AGENT_MODE") {
      handleTextChange("AGENT_MODE", pendingOptionValue || "off");
    } else if (activeOptionPicker === "ACTIVE_LLM_PROVIDER") {
      handleTextChange("ACTIVE_LLM_PROVIDER", pendingOptionValue || "gemini");
    } else if (activeOptionPicker === "TRANSCRIPT_TITLE_DEVICE") {
      handleTextChange("TRANSCRIPT_TITLE_DEVICE", pendingOptionValue || "auto");
    } else if (activeOptionPicker === "LOG_LEVEL") {
      handleTextChange("LOG_LEVEL", pendingOptionValue || "INFO");
    } else if (activeOptionPicker === "transcription-model") {
      const nextValue = pendingOptionValue || "ggml-large-v3-turbo-q5_0";
      setTranscriptionModel(nextValue);
      handleTextChange("TRANSCRIPTION_MODEL_PATH", nextValue);
    } else if (activeOptionPicker === "summarization-model") {
      const nextValue = pendingOptionValue || "qwen2.5-0.5b-instruct";
      setSummarizationModel(nextValue);
      handleTextChange("TRANSCRIPT_TITLE_MODEL_PATH", nextValue);
    }
    setIsOptionPickerVisible(false);
  }, [activeOptionPicker, handleConnectedAgentChange, handleTextChange, pendingOptionValue]);

  const handlePhoneLocationToggle = React.useCallback(async (nextValue: boolean) => {
    setErrorMessage(null);

    if (!nextValue) {
      setIsPhoneLocationEnabled(false);
      setPhoneLocationLabel(null);
      await setPhoneLocationEnabledPreference(false);
      return;
    }

    try {
      const permission = await requestPhoneLocationAccess();
      if (permission.granted) {
        setIsPhoneLocationEnabled(true);
        await setPhoneLocationEnabledPreference(true);

        // Fetch current position and reverse geocode
        try {
          const position = await getCurrentPositionAsync({ accuracy: 4 });
          const result = await reverseGeocodeLocation(
            position.coords.latitude,
            position.coords.longitude,
          );
          setPhoneLocationLabel(result.label || `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
        } catch {
          setPhoneLocationLabel("Location detected");
        }
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
    applySettingsPatch((current) => {
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
    }, { immediate: true });
  }, [applySettingsPatch]);

  const handleLocationSelected = React.useCallback(
    (group: LocationSettingGroup, selection: SelectedLocation) => {
      applySettingsPatch({
        [group.locationKey]: selection.label,
        [group.latitudeKey]: selection.latitude.toFixed(6),
        [group.longitudeKey]: selection.longitude.toFixed(6),
      }, { immediate: true });
      setActiveLocationGroupId(null);
    },
    [applySettingsPatch],
  );

  const flushPendingSave = React.useCallback(() => {
    if (isLoading || !hasLoadedSettingsRef.current) {
      return;
    }

    const snapshot = settingsRef.current;
    if (serializeSettings(snapshot) === lastSavedSettingsRef.current) {
      return;
    }

    saveImmediately(snapshot);
  }, [isLoading, saveImmediately]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        flushPendingSave();
      }
    });

    return () => {
      subscription.remove();
      flushPendingSave();
    };
  }, [flushPendingSave]);

  React.useEffect(() => {
    if (isLoading || !hasLoadedSettingsRef.current) {
      return;
    }

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
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

      void persistSettingsSnapshot(snapshot, saveId);
    }, AUTOSAVE_DELAY_MS);
  }, [
    isLoading,
    persistSettingsSnapshot,
    settings,
    summarizationModel,
    transcriptionModel,
  ]);

  const activeLocationGroup = React.useMemo(
    () =>
      LOCATION_SETTING_GROUPS.find((group) => group.id === activeLocationGroupId) ?? null,
    [activeLocationGroupId],
  );
  const timeZoneOptions = React.useMemo(() => getTimeZoneOptions(), []);
  const orderedStandardSections = React.useMemo(() => {
    const sectionLookup = new Map(SETTINGS_SECTIONS.map((section) => [section.title, section]));
    return STANDARD_SECTION_ORDER.map((title) => sectionLookup.get(title)).filter(
      (section): section is SettingSection => section != null,
    );
  }, []);
  const topSections = React.useMemo(
    () => orderedStandardSections.filter((section) => TOP_SECTION_TITLES.has(section.title)),
    [orderedStandardSections],
  );
  const lowerSections = React.useMemo(
    () => orderedStandardSections.filter((section) => !TOP_SECTION_TITLES.has(section.title)),
    [orderedStandardSections],
  );
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
  const activeConnectionField = React.useMemo(
    () => getConnectionFieldConfig(connectedAgent),
    [connectedAgent],
  );
  const activeConnectionValue = String(settings[activeConnectionField.key] ?? "");
  const connectionDisplayText = activeConnectionValue.trim() || activeConnectionField.placeholder;
  const connectionInputWidth =
    connectionMeasureWidth > 0
      ? Math.min(220, Math.max(56, Math.ceil(connectionMeasureWidth + 24)))
      : undefined;
  const validationState = React.useMemo(
    () => buildValidationState(errors, warnings),
    [errors, warnings],
  );

  const renderFieldValidation = React.useCallback(
    (keys: string | string[]) => {
      const resolvedKeys = resolveValidationKeys(Array.isArray(keys) ? keys : [keys]);
      const fieldErrors = dedupeStrings(
        resolvedKeys.flatMap((key) => validationState.byKey[key]?.errors ?? []),
      );
      const fieldWarnings = dedupeStrings(
        resolvedKeys.flatMap((key) => validationState.byKey[key]?.warnings ?? []),
      );

      if (fieldErrors.length === 0 && fieldWarnings.length === 0) {
        return null;
      }

      return (
        <View style={styles.fieldValidationGroup}>
          {fieldErrors.map((message) => (
            <Text key={`error-${resolvedKeys.join("-")}-${message}`} style={styles.validationText}>
              {message}
            </Text>
          ))}
          {fieldWarnings.map((message) => (
            <Text key={`warning-${resolvedKeys.join("-")}-${message}`} style={styles.warningText}>
              {message}
            </Text>
          ))}
        </View>
      );
    },
    [validationState],
  );

  const optionPickerConfig = React.useMemo(() => {
    if (activeOptionPicker === "agent") {
      return {
        title: "Agent",
        options: CONNECTED_AGENT_OPTIONS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "MESSAGE_CHANNEL") {
      return {
        title: "Message Channel",
        options: MESSAGE_CHANNEL_OPTIONS,
        optionLabels: MESSAGE_CHANNEL_LABELS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "AGENT_MODE") {
      return {
        title: "Intelligence Mode",
        options: AGENT_MODE_OPTIONS,
        optionLabels: AGENT_MODE_LABELS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "ACTIVE_LLM_PROVIDER") {
      return {
        title: "LLM Provider",
        options: LLM_PROVIDER_OPTIONS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "TRANSCRIPT_TITLE_DEVICE") {
      return {
        title: "Summary Device",
        options: TITLE_DEVICE_OPTIONS,
        recommendedOption: null,
      };
    }
    if (activeOptionPicker === "LOG_LEVEL") {
      return {
        title: "Log Level",
        options: LOG_LEVEL_OPTIONS,
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

  const toggleSectionCollapse = React.useCallback((title: string) => {
    if (!COLLAPSIBLE_SECTION_TITLES.has(title)) {
      return;
    }
    LayoutAnimation.configureNext({
      duration: 180,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
    setCollapsedSections((current) => ({
      ...current,
      [title]: !current[title],
    }));
  }, []);

  const renderSectionHeader = React.useCallback(
    (section: SettingSection) => {
      const collapsible = COLLAPSIBLE_SECTION_TITLES.has(section.title);
      const collapsed = Boolean(collapsedSections[section.title]);

      if (!collapsible) {
        return (
          <View style={styles.sectionHeader}>
            <Text
              style={[
                styles.sectionTitle,
                section.tone === "danger" && styles.sectionTitleDanger,
              ]}
            >
              {section.title}
            </Text>
          </View>
        );
      }

      return (
        <Pressable onPress={() => toggleSectionCollapse(section.title)} style={styles.sectionHeader}>
          <Text
            style={[
              styles.sectionTitle,
              section.tone === "danger" && styles.sectionTitleDanger,
            ]}
          >
            {section.title}
          </Text>
          <View style={styles.sectionChevronWrap}>
            {collapsed ? (
              <SectionChevronRightIcon color={section.tone === "danger" ? "#ff8f8f" : "#e3e3e3"} />
            ) : (
              <SectionChevronDownIcon color={section.tone === "danger" ? "#ff8f8f" : "#e3e3e3"} />
            )}
          </View>
        </Pressable>
      );
    },
    [collapsedSections, toggleSectionCollapse],
  );

  const renderSettingsSection = React.useCallback(
    (section: SettingSection) => {
      const isCollapsed = Boolean(collapsedSections[section.title]);
      const visibleFields = section.fields.filter((field) => {
        if (section.title !== "Messaging") {
          return true;
        }

        const channel = String(settings.MESSAGE_CHANNEL ?? "").trim() || "Telegram";
        if (field.key === "IMESSAGE_ENABLED") {
          return false;
        }
        if (field.key === "IMESSAGE_RECIPIENT") {
          return channel === "iMessage";
        }
        if (field.key === "TELEGRAM_BOT_TOKEN" || field.key === "TELEGRAM_CHAT_ID") {
          return channel === "Telegram";
        }
        if (
          field.key === "WHATSAPP_ACCESS_TOKEN"
          || field.key === "WHATSAPP_PHONE_NUMBER_ID"
          || field.key === "WHATSAPP_RECIPIENT"
        ) {
          return channel === "WhatsApp";
        }
        return true;
      });

      return (
        <View key={section.title} style={styles.section}>
          {renderSectionHeader(section)}
          {isCollapsed ? null : (
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
                              styles.fieldRowBorder,
                              styles.locationFieldRow,
                            ]}
                          >
                            <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
                              <View
                                style={[
                                  styles.fieldHeader,
                                  styles.fieldHeaderInline,
                                  styles.locationFieldHeader,
                                ]}
                              >
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
                            {renderFieldValidation(group.locationKey)}
                          </View>
                        );
                      })}
                      <View style={styles.fieldRow}>
                        <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
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
                        {isPhoneLocationEnabled && phoneLocationLabel ? (
                          <Text style={styles.phoneLocationLabel}>{phoneLocationLabel}</Text>
                        ) : null}
                      </View>
                    </>
                  )
                : visibleFields.map((field, index) => renderFieldRow(field, index, visibleFields.length))}
            </View>
          )}
        </View>
      );
    },
    [
      calendarEditorProgress,
      collapsedSections,
      handleCalendarIdChange,
      handlePhoneLocationToggle,
      isPhoneLocationEnabled,
      phoneLocationLabel,
      settings.MESSAGE_CHANNEL,
      renderSectionHeader,
      renderFieldRow,
      renderFieldValidation,
      settings,
    ],
  );

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

  function renderFieldRow(field: SettingField, index: number, totalFields: number) {
      const rawValue = settings[field.key];
      const stringValue = typeof rawValue === "boolean" ? "" : String(rawValue ?? "");
      const boolValue = rawValue === true;
      const isInline =
        field.kind === "boolean" ||
        field.kind === "select" ||
        field.key === "TARGET_CALENDAR_ID" ||
        isNumericPickerKey(field.key) ||
        isTimeSettingKey(field.key) ||
        field.key === "TIMEZONE";

    return (
        <View
          key={field.key}
          style={[
            styles.fieldRow,
            index !== totalFields - 1 && styles.fieldRowBorder,
          ]}
        >
          <View style={[styles.fieldRowMain, isInline && styles.fieldRowMainInline]}>
            <View style={[styles.fieldHeader, isInline && styles.fieldHeaderInline]}>
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
                  style={[styles.calendarMeasureText, styles.selectTriggerText]}
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
            ) : field.key === "MESSAGE_CHANNEL" ? (
              <Pressable
                onPress={() => openOptionPicker("MESSAGE_CHANNEL")}
                style={styles.selectTrigger}
              >
                <Text numberOfLines={1} style={styles.selectTriggerText}>
                  {MESSAGE_CHANNEL_LABELS[stringValue] || stringValue || "Select"}
                </Text>
              </Pressable>
            ) : field.kind === "select" ? (
              <Pressable
                onPress={() => openOptionPicker(field.key as OptionSheetKind)}
                style={styles.selectTrigger}
              >
                <Text numberOfLines={1} style={styles.selectTriggerText}>
                  {stringValue || field.placeholder || "Select"}
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
                secureTextEntry={field.kind === "secret"}
                style={styles.input}
                value={stringValue}
              />
            )}
          </View>
          {renderFieldValidation(field.key)}
        </View>
      );
  }

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
          {topSections.map(renderSettingsSection)}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connection</Text>
            <View style={styles.sectionPanel}>
              <View style={[styles.fieldRow, styles.fieldRowBorder]}>
                <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
                  <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                    <Text numberOfLines={1} style={styles.fieldLabel}>Agent</Text>
                  </View>
                  <Pressable onPress={() => openOptionPicker("agent")} style={styles.selectTrigger}>
                    <Text numberOfLines={1} style={styles.selectTriggerText}>{connectedAgent}</Text>
                  </Pressable>
                </View>
                {renderFieldValidation("CONNECTION_AGENT")}
              </View>

              <View style={[styles.fieldRow, styles.fieldRowBorder]}>
                <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
                  <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                    <Text numberOfLines={1} style={styles.fieldLabel}>{activeConnectionField.label}</Text>
                  </View>
                  <Text
                    key={`${activeConnectionField.key}-${connectionDisplayText}`}
                    onLayout={(event) => setConnectionMeasureWidth(event.nativeEvent.layout.width)}
                    style={styles.connectionMeasureText}
                  >
                    {connectionDisplayText}
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardAppearance="dark"
                    onChangeText={(value) => handleTextChange(activeConnectionField.key, value)}
                    onFocus={(event) => handleTextInputFocus(event.nativeEvent.target)}
                    placeholder={activeConnectionField.placeholder}
                    placeholderTextColor="#6f6f6f"
                    secureTextEntry={activeConnectionField.secure}
                    style={[
                      styles.input,
                      styles.connectionInput,
                      connectionInputWidth ? { width: connectionInputWidth } : null,
                    ]}
                    value={activeConnectionValue}
                  />
                </View>
                {renderFieldValidation(activeConnectionField.key)}
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.fieldRowMain}>
                  <View style={styles.fieldHeader}>
                    <Text numberOfLines={1} style={styles.fieldLabel}>Backend</Text>
                  </View>
                  <TextSegmentedSelector
                    options={BACKEND_OPTIONS}
                    value={backendTarget}
                    onChange={handleBackendTargetChange}
                  />
                </View>
                {renderFieldValidation("BACKEND_TARGET")}
              </View>

              {backendTarget === "Hosted" ? (
                <View style={styles.fieldRow}>
                  <View style={styles.fieldRowMain}>
                    <View style={styles.fieldHeader}>
                      <Text numberOfLines={1} style={styles.fieldLabel}>Hosted backend URL</Text>
                    </View>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardAppearance="dark"
                      keyboardType="url"
                      onBlur={handleVercelBaseUrlBlur}
                      onChangeText={handleVercelBaseUrlChange}
                      onFocus={(event) => handleTextInputFocus(event.nativeEvent.target)}
                      placeholder="https://your-backend.railway.app"
                      placeholderTextColor="#6f6f6f"
                      style={styles.input}
                      value={vercelBaseUrl}
                    />
                  </View>
                  {renderFieldValidation("VERCEL_BASE_URL")}
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Models</Text>
            <View style={styles.sectionPanel}>
              <View style={[styles.fieldRow, styles.fieldRowBorder]}>
                <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
                  <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                    <Text numberOfLines={1} style={styles.fieldLabel}>Transcription</Text>
                  </View>
                  <Pressable
                    onPress={() => openOptionPicker("transcription-model")}
                    style={styles.selectTrigger}
                  >
                    <Text numberOfLines={1} style={styles.selectTriggerText}>{transcriptionModel}</Text>
                  </Pressable>
                </View>
                {renderFieldValidation("TRANSCRIPTION_MODEL_PATH")}
              </View>

              <View style={styles.fieldRow}>
                <View style={[styles.fieldRowMain, styles.fieldRowMainInline]}>
                  <View style={[styles.fieldHeader, styles.fieldHeaderInline]}>
                    <Text numberOfLines={1} style={styles.fieldLabel}>Summarization</Text>
                  </View>
                  <Pressable
                    onPress={() => openOptionPicker("summarization-model")}
                    style={styles.selectTrigger}
                  >
                    <Text numberOfLines={1} style={styles.selectTriggerText}>{summarizationModel}</Text>
                  </Pressable>
                </View>
                {renderFieldValidation("TRANSCRIPT_TITLE_MODEL_PATH")}
              </View>
            </View>
          </View>
          {lowerSections.map(renderSettingsSection)}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          {validationState.unmatchedErrors.map((error) => (
            <Text key={`error-${error}`} style={styles.validationText}>
              {error}
            </Text>
          ))}
          {validationState.unmatchedWarnings.map((warning) => (
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
                  {optionPickerConfig.options.map((option) => {
                    const labels = (optionPickerConfig as { optionLabels?: Record<string, string> }).optionLabels;
                    const label = labels?.[option] ?? formatModelOptionLabel(option, optionPickerConfig.recommendedOption);
                    return (
                      <Picker.Item
                        key={option}
                        label={label}
                        value={option}
                        color="#ffffff"
                      />
                    );
                  })}
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
  sectionHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#ffffff",
    fontFamily: FONTS.semibold,
    fontSize: 18,
  },
  sectionHint: {
    color: MUTED,
    fontFamily: FONTS.regular,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  sectionTitleDanger: {
    color: "#ff8f8f",
  },
  sectionChevronWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
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
  fieldRowMain: {
    gap: 8,
  },
  fieldRowMainInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  connectionInput: {
    minWidth: 0,
    maxWidth: 220,
    textAlign: "right",
    alignSelf: "flex-end",
  },
  connectionMeasureText: {
    position: "absolute",
    opacity: 0,
    left: -9999,
    color: "#6f6f6f",
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
  phoneLocationLabel: {
    color: MUTED,
    fontFamily: FONTS.regular,
    fontSize: 13,
    marginTop: 6,
    paddingHorizontal: 2,
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
  fieldValidationGroup: {
    gap: 4,
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
