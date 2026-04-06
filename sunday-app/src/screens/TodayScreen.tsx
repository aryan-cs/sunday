import React from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "../constants/fonts";
import {
  CalendarPreferences,
  loadCalendarPreferences,
  saveCalendarPreferences,
} from "../lib/calendarPreferences";
import { fetchApi } from "../lib/api";
import { geocodeLocationSearch, type GeocodeSearchResponse } from "../lib/settings";
import { LinearGradient } from "expo-linear-gradient";

const BACKGROUND = "#121212";
const CARD = "#1f1f1f";
const CARD_ALT = "#252525";
const MUTED = "#8b8b8b";
const ACCENT = "#ffffff";
const ONLINE_TAG = "#3a3a3a";
const PANEL = "#1f1f1f";
const PANEL_BORDER = "#2b2b2b";
const TOGGLE_OFF = "#1a1a1a";
const TOGGLE_ON = "#5f5f5f";
const REFRESH_INTERVAL_MS = 60_000;
const APPLE_MAPS_ICON = require("../../assets/apple-maps-icon.png");
const GOOGLE_MAPS_ICON = require("../../assets/google-maps-icon.png");
const WAZE_ICON = require("../../assets/waze-icon.png");
const CALENDAR_COLOR_FALLBACKS = [
  "#ffffff",
  "#7ec8ff",
  "#8af0c1",
  "#fbbf24",
  "#f87171",
  "#c084fc",
  "#fb7185",
  "#60a5fa",
] as const;

type CalendarDescriptor = {
  id: string;
  name: string;
  default_color: string | null;
};

type CalendarEvent = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  calendar_default_color: string | null;
  title: string;
  location: string | null;
  start_iso: string;
  end_iso: string;
  travel_minutes: number | null;
  travel_mode: string;
  leave_by_iso: string | null;
  is_online: boolean;
  is_all_day: boolean;
  meeting_link: string | null;
  description: string | null;
  attendees: Array<{
    name: string;
    email: string | null;
    response_status: string | null;
  }>;
  notes: string | null;
  travel: Record<string, { minutes: number; text: string } | null> | null;
};

type EventsResponse = {
  events?: CalendarEvent[];
  calendars?: CalendarDescriptor[];
};

type MapsProvider = "apple" | "google" | "waze";

const MAP_PREVIEW_DELTA = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  hiddenCalendarIds: [],
  colorsById: {},
};

function LocationPinIcon({ size = 16, color = MUTED }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Z"
        fill={color}
      />
    </Svg>
  );
}

function VideoCamIcon({ size = 16, color = MUTED }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v440L720-420v180q0 33-23.5 56.5T640-160H160Z"
        fill={color}
      />
    </Svg>
  );
}

function EventListIcon({ size = 20, color = "#e3e3e3" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M640-120q-33 0-56.5-23.5T560-200v-160q0-33 23.5-56.5T640-440h160q33 0 56.5 23.5T880-360v160q0 33-23.5 56.5T800-120H640Zm0-80h160v-160H640v160ZM80-240v-80h360v80H80Zm560-280q-33 0-56.5-23.5T560-600v-160q0-33 23.5-56.5T640-840h160q33 0 56.5 23.5T880-760v160q0 33-23.5 56.5T800-520H640Zm0-80h160v-160H640v160ZM80-640v-80h360v80H80Zm640 360Zm0-400Z"
        fill={color}
      />
    </Svg>
  );
}

function normalizeHexColor(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function parseCalendarDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const allDayMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (allDayMatch) {
    const year = Number.parseInt(allDayMatch[1], 10);
    const month = Number.parseInt(allDayMatch[2], 10);
    const day = Number.parseInt(allDayMatch[3], 10);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatClockLabel(value: string) {
  const date = parseCalendarDate(value);
  if (!date) {
    return "TBD";
  }

  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDayLabel(value: string) {
  const date = parseCalendarDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatEventDateLabel(value: string) {
  const date = parseCalendarDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatLeaveBy(isoString: string) {
  const date = parseCalendarDate(isoString);
  if (!date) {
    return "";
  }

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60_000);

  if (diffMins < 0) return "Should have left";
  if (diffMins === 0) return "Leave now";
  if (diffMins <= 60) return `Leave in ${diffMins} min`;
  return `Leave at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function buildMapUrls(
  provider: MapsProvider,
  destinationLabel: string,
  destinationCoords?: { latitude: number; longitude: number } | null,
) {
  const encodedLabel = encodeURIComponent(destinationLabel.trim());
  const latLng = destinationCoords
    ? `${destinationCoords.latitude},${destinationCoords.longitude}`
    : "";

  if (provider === "apple") {
    return {
      primary: latLng
        ? `http://maps.apple.com/?ll=${latLng}&q=${encodedLabel}`
        : `http://maps.apple.com/?q=${encodedLabel}`,
      fallback: null,
    };
  }

  if (provider === "google") {
    const primary = latLng
      ? `comgooglemaps://?q=${encodedLabel}&center=${latLng}`
      : `comgooglemaps://?q=${encodedLabel}`;
    const fallback = latLng
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latLng)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedLabel}`;
    return { primary, fallback };
  }

  const primary = latLng
    ? `waze://?ll=${latLng}&navigate=yes`
    : `waze://?q=${encodedLabel}&navigate=yes`;
  const fallback = latLng
    ? `https://waze.com/ul?ll=${latLng}&navigate=yes`
    : `https://waze.com/ul?q=${encodedLabel}&navigate=yes`;
  return { primary, fallback };
}

function isEventSoon(event: CalendarEvent) {
  if (event.is_all_day) {
    return false;
  }
  const start = parseCalendarDate(event.start_iso);
  if (!start) {
    return false;
  }
  const diffMs = start.getTime() - Date.now();
  return diffMs > 0 && diffMs <= 60 * 60_000;
}

function isEventNow(event: CalendarEvent) {
  if (event.is_all_day) {
    return false;
  }
  const start = parseCalendarDate(event.start_iso);
  const end = parseCalendarDate(event.end_iso);
  if (!start || !end) {
    return false;
  }

  const now = Date.now();
  return start.getTime() <= now && end.getTime() > now;
}

function getPrimaryTimeLabel(event: CalendarEvent) {
  return event.is_all_day ? "All day" : formatClockLabel(event.start_iso);
}

function getSecondaryTimeLabel(event: CalendarEvent) {
  return event.is_all_day ? formatDayLabel(event.start_iso) : formatClockLabel(event.end_iso);
}

function EventCard({
  event,
  calendarColor,
  onPress,
}: {
  event: CalendarEvent;
  calendarColor: string;
  onPress: () => void;
}) {
  const primaryTime = getPrimaryTimeLabel(event);
  const secondaryTime = getSecondaryTimeLabel(event);
  const now = isEventNow(event);
  const detailLabel = event.is_online ? "Online" : event.location?.trim() || "";

  return (
    <Pressable onPress={onPress} style={[styles.card, now && styles.cardNow]}>
      <View style={[styles.calendarRail, { backgroundColor: calendarColor }]} />

      <View style={styles.cardRow}>
        <View style={styles.cardBody}>
          <Text numberOfLines={2} style={styles.eventTitle}>
            {event.title}
          </Text>

          {detailLabel ? (
            <View style={styles.locationRow}>
              {event.is_online ? (
                <VideoCamIcon size={14} color={MUTED} />
              ) : (
                <LocationPinIcon size={14} />
              )}
              <Text numberOfLines={1} style={styles.locationText}>
                {detailLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.timeColumn}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={[styles.timeText, now && styles.timeTextHighlight]}
          >
            {primaryTime}
          </Text>
          {secondaryTime ? (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              style={styles.timeTextEnd}
            >
              {secondaryTime}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const headerTopInset = insets.top + 8;
  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = React.useState<CalendarDescriptor[]>([]);
  const [preferences, setPreferences] = React.useState<CalendarPreferences>(
    DEFAULT_CALENDAR_PREFERENCES,
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isCalendarSettingsVisible, setIsCalendarSettingsVisible] = React.useState(false);
  const [selectedEvent, setSelectedEvent] = React.useState<CalendarEvent | null>(null);
  const [isEventSheetMounted, setIsEventSheetMounted] = React.useState(false);
  const [selectedEventMapPreview, setSelectedEventMapPreview] =
    React.useState<GeocodeSearchResponse | null>(null);
  const [isResolvingSelectedEventMapPreview, setIsResolvingSelectedEventMapPreview] =
    React.useState(false);
  const eventLocationPreviewCacheRef = React.useRef<Record<string, GeocodeSearchResponse | null>>(
    {},
  );
  const eventBackdropOpacity = React.useRef(new Animated.Value(0)).current;
  const eventSheetHeight = React.useRef(new Animated.Value(0)).current;
  const eventSheetHeightRef = React.useRef(0);
  const eventSheetGestureStartRef = React.useRef(0);
  const eventSheetModeRef = React.useRef<"half" | "full">("half");

  const loadEvents = React.useCallback(async () => {
    try {
      const response = await fetchApi(
        "/api/events",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
        { timeoutMs: 15_000 },
      );

      if (!response.ok) {
        throw new Error(`Server error (${response.status})`);
      }

      const data = (await response.json()) as EventsResponse;
      setEvents(Array.isArray(data.events) ? data.events : []);
      setCalendars(Array.isArray(data.calendars) ? data.calendars : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadEvents();
    const interval = setInterval(() => void loadEvents(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadEvents]);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedPreferences = await loadCalendarPreferences();
      if (!cancelled) {
        setPreferences(storedPreferences);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistPreferences = React.useCallback(async (nextPreferences: CalendarPreferences) => {
    setPreferences(nextPreferences);
    await saveCalendarPreferences(nextPreferences);
  }, []);

  const handleCalendarVisibilityToggle = React.useCallback(
    (calendarId: string, enabled: boolean) => {
      const nextHiddenIds = enabled
        ? preferences.hiddenCalendarIds.filter((id) => id !== calendarId)
        : [...new Set([...preferences.hiddenCalendarIds, calendarId])];

      void persistPreferences({
        ...preferences,
        hiddenCalendarIds: nextHiddenIds,
      });
    },
    [persistPreferences, preferences],
  );

  const handleCalendarColorChange = React.useCallback(
    (calendarId: string, color: string) => {
      void persistPreferences({
        ...preferences,
        colorsById: {
          ...preferences.colorsById,
          [calendarId]: color,
        },
      });
    },
    [persistPreferences, preferences],
  );

  const calendarColorLookup = React.useMemo(() => {
    const lookup: Record<string, string> = {};

    calendars.forEach((calendar, index) => {
      const fallbackColor =
        normalizeHexColor(calendar.default_color) ??
        CALENDAR_COLOR_FALLBACKS[index % CALENDAR_COLOR_FALLBACKS.length];
      lookup[calendar.id] = preferences.colorsById[calendar.id] || fallbackColor;
    });

    return lookup;
  }, [calendars, preferences.colorsById]);

  const filteredEvents = React.useMemo(() => {
    const hidden = new Set(preferences.hiddenCalendarIds);
    return events.filter((event) => !hidden.has(event.calendar_id));
  }, [events, preferences.hiddenCalendarIds]);
  const selectedEventCalendarColor = React.useMemo(() => {
    if (!selectedEvent) {
      return ACCENT;
    }

    return calendarColorLookup[selectedEvent.calendar_id] || ACCENT;
  }, [calendarColorLookup, selectedEvent]);

  const selectedEventTravel = React.useMemo(() => {
    if (!selectedEvent) {
      return null;
    }

    const travelMode = selectedEvent.travel_mode || "driving";
    return selectedEvent.travel?.[travelMode] ?? null;
  }, [selectedEvent]);
  const selectedEventDestination = React.useMemo(() => {
    if (!selectedEvent?.location?.trim()) {
      return null;
    }

    return {
      label: selectedEvent.location.trim(),
      coords: selectedEventMapPreview
        ? {
            latitude: selectedEventMapPreview.latitude,
            longitude: selectedEventMapPreview.longitude,
          }
        : null,
    };
  }, [selectedEvent, selectedEventMapPreview]);
  const eventSheetFullHeight = Math.min(windowHeight - Math.max(insets.top + 18, 72), 720);
  const eventSheetHalfHeight = Math.min(
    Math.max(360, Math.round(windowHeight * 0.54)),
    eventSheetFullHeight,
  );

  React.useEffect(() => {
    const id = eventSheetHeight.addListener(({ value }) => {
      eventSheetHeightRef.current = value;
    });

    return () => {
      eventSheetHeight.removeListener(id);
    };
  }, [eventSheetHeight]);

  const animateEventSheetToMode = React.useCallback(
    (mode: "half" | "full") => {
      const toValue = mode === "full" ? eventSheetFullHeight : eventSheetHalfHeight;
      eventSheetModeRef.current = mode;
      eventSheetHeight.stopAnimation();
      Animated.spring(eventSheetHeight, {
        toValue,
        damping: 24,
        stiffness: 260,
        mass: 0.95,
        overshootClamping: true,
        useNativeDriver: false,
      }).start();
    },
    [eventSheetFullHeight, eventSheetHalfHeight, eventSheetHeight],
  );

  const closeSelectedEvent = React.useCallback(() => {
    if (!isEventSheetMounted) {
      setSelectedEvent(null);
      return;
    }

    eventBackdropOpacity.stopAnimation();
    eventSheetHeight.stopAnimation();
    Animated.parallel([
      Animated.timing(eventBackdropOpacity, {
        toValue: 0,
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(eventSheetHeight, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsEventSheetMounted(false);
        setSelectedEvent(null);
      }
    });
  }, [eventBackdropOpacity, eventSheetHeight, isEventSheetMounted]);

  React.useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    setIsEventSheetMounted(true);
    eventSheetModeRef.current = "half";
    eventBackdropOpacity.stopAnimation();
    eventSheetHeight.stopAnimation();
    eventBackdropOpacity.setValue(0);
    eventSheetHeight.setValue(0);
    eventSheetHeightRef.current = 0;
    Animated.parallel([
      Animated.timing(eventBackdropOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(eventSheetHeight, {
        toValue: eventSheetHalfHeight,
        damping: 24,
        stiffness: 260,
        mass: 0.95,
        overshootClamping: true,
        useNativeDriver: false,
      }),
    ]).start();
  }, [eventBackdropOpacity, eventSheetHalfHeight, eventSheetHeight, selectedEvent]);

  const eventSheetPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderGrant: () => {
          eventSheetHeight.stopAnimation();
          eventSheetGestureStartRef.current = eventSheetHeightRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextValue = Math.min(
            eventSheetFullHeight,
            Math.max(eventSheetHalfHeight, eventSheetGestureStartRef.current - gestureState.dy),
          );
          eventSheetHeight.setValue(nextValue);
        },
        onPanResponderRelease: (_, gestureState) => {
          const currentValue = Math.min(
            eventSheetFullHeight,
            Math.max(eventSheetHalfHeight, eventSheetHeightRef.current),
          );

          if (gestureState.vy <= -0.2) {
            animateEventSheetToMode("full");
            return;
          }

          if (gestureState.vy >= 0.2) {
            animateEventSheetToMode("half");
            return;
          }

          animateEventSheetToMode(
            currentValue >= (eventSheetHalfHeight + eventSheetFullHeight) / 2 ? "full" : "half",
          );
        },
        onPanResponderTerminate: (_, gestureState) => {
          const currentValue = Math.min(
            eventSheetFullHeight,
            Math.max(eventSheetHalfHeight, eventSheetGestureStartRef.current - gestureState.dy),
          );
          animateEventSheetToMode(
            currentValue >= (eventSheetHalfHeight + eventSheetFullHeight) / 2 ? "full" : "half",
          );
        },
      }),
    [animateEventSheetToMode, eventSheetFullHeight, eventSheetHalfHeight, eventSheetHeight],
  );

  React.useEffect(() => {
    const locationQuery = selectedEvent?.location?.trim();

    if (!selectedEvent || selectedEvent.is_online || !locationQuery) {
      setSelectedEventMapPreview(null);
      setIsResolvingSelectedEventMapPreview(false);
      return;
    }

    const cached = eventLocationPreviewCacheRef.current[locationQuery];
    if (cached !== undefined) {
      setSelectedEventMapPreview(cached);
      setIsResolvingSelectedEventMapPreview(false);
      return;
    }

    let cancelled = false;
    setSelectedEventMapPreview(null);
    setIsResolvingSelectedEventMapPreview(true);

    void (async () => {
      try {
        const result = await geocodeLocationSearch(locationQuery);
        eventLocationPreviewCacheRef.current[locationQuery] = result;
        if (!cancelled) {
          setSelectedEventMapPreview(result);
        }
      } catch {
        eventLocationPreviewCacheRef.current[locationQuery] = null;
        if (!cancelled) {
          setSelectedEventMapPreview(null);
        }
      } finally {
        if (!cancelled) {
          setIsResolvingSelectedEventMapPreview(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEvent]);

  const openMapsDestination = React.useCallback(
    async (provider: MapsProvider) => {
      if (!selectedEventDestination) {
        return;
      }

      const { primary, fallback } = buildMapUrls(
        provider,
        selectedEventDestination.label,
        selectedEventDestination.coords,
      );

      try {
        await Linking.openURL(primary);
      } catch {
        if (fallback) {
          await Linking.openURL(fallback);
        }
      }
    },
    [selectedEventDestination],
  );

  const now = new Date();
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <SafeAreaView edges={[]} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={filteredEvents}
        keyExtractor={(item) => `${item.calendar_id}:${item.id}`}
        contentContainerStyle={filteredEvents.length ? styles.listContent : styles.emptyContent}
        showsVerticalScrollIndicator={false}
        bounces
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="never"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={[styles.header, { paddingTop: headerTopInset }]}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Today</Text>
              <Pressable
                onPress={() => setIsCalendarSettingsVisible(true)}
                style={styles.headerButton}
              >
                <EventListIcon size={20} color="#e3e3e3" />
              </Pressable>
            </View>
            <Text style={styles.greeting}>{greeting}</Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.stateText}>Loading schedule...</Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable
                onPress={() => {
                  setIsLoading(true);
                  void loadEvents();
                }}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.centerState}>
              <Text style={styles.emptyTitle}>Nothing scheduled</Text>
              <Text style={styles.stateText}>Your upcoming events will appear here.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <EventCard
            event={item}
            calendarColor={calendarColorLookup[item.calendar_id] || ACCENT}
            onPress={() => setSelectedEvent(item)}
          />
        )}
      />

      <Modal
        animationType="fade"
        transparent
        visible={isCalendarSettingsVisible}
        onRequestClose={() => setIsCalendarSettingsVisible(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsCalendarSettingsVisible(false)}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 18) + 8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Calendars</Text>
              <Pressable
                onPress={() => setIsCalendarSettingsVisible(false)}
                style={styles.modalDoneButton}
              >
                <Text style={styles.modalDoneText}>Done</Text>
              </Pressable>
            </View>

            <ScrollView
              bounces
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalContent}
            >
              {calendars.map((calendar, index) => {
                const selectedColor =
                  calendarColorLookup[calendar.id] ||
                  CALENDAR_COLOR_FALLBACKS[index % CALENDAR_COLOR_FALLBACKS.length];
                const defaultColor =
                  normalizeHexColor(calendar.default_color) ||
                  CALENDAR_COLOR_FALLBACKS[index % CALENDAR_COLOR_FALLBACKS.length];
                const enabled = !preferences.hiddenCalendarIds.includes(calendar.id);
                const colorOptions = [
                  defaultColor,
                  ...CALENDAR_COLOR_FALLBACKS.filter((color) => color !== defaultColor),
                ].slice(0, 6);

                return (
                  <View key={calendar.id} style={styles.calendarSettingsRow}>
                    <View style={styles.calendarSettingsTopRow}>
                      <Text numberOfLines={1} style={styles.calendarSettingsName}>
                        {calendar.name}
                      </Text>
                      <Switch
                        value={enabled}
                        onValueChange={(value) =>
                          handleCalendarVisibilityToggle(calendar.id, value)
                        }
                        ios_backgroundColor={TOGGLE_OFF}
                        trackColor={{ false: TOGGLE_OFF, true: TOGGLE_ON }}
                        thumbColor={enabled ? "#ffffff" : "#d6d6d6"}
                      />
                    </View>

                    <View style={styles.calendarColorOptions}>
                      {colorOptions.map((color) => {
                        const selected = color === selectedColor;
                        return (
                          <Pressable
                            key={`${calendar.id}-${color}`}
                            onPress={() => handleCalendarColorChange(calendar.id, color)}
                            style={[
                              styles.calendarColorChip,
                              selected && styles.calendarColorChipSelected,
                            ]}
                          >
                            <View
                              style={[
                                styles.calendarColorChipFill,
                                { backgroundColor: color },
                              ]}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {isEventSheetMounted ? (
        <Modal
          animationType="none"
          transparent
          visible
          onRequestClose={closeSelectedEvent}
        >
          <View style={styles.modalRoot}>
            <Animated.View
              pointerEvents="none"
              style={[styles.modalBackdrop, { opacity: eventBackdropOpacity }]}
            />
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSelectedEvent} />
            {selectedEvent ? (
              <Animated.View
                style={[
                  styles.eventModalSheet,
                  {
                    paddingBottom: Math.max(insets.bottom, 18) + 12,
                    height: eventSheetHeight,
                  },
                ]}
              >
                <View {...eventSheetPanResponder.panHandlers} style={styles.eventModalDragArea}>
                  <View style={styles.eventModalHandleArea}>
                    <View style={styles.eventModalGrabber} />
                  </View>
                  <View style={styles.eventModalHeader}>
                    <View style={styles.eventModalTitleRow}>
                      <View style={styles.eventModalTitleWrap}>
                        <Text numberOfLines={3} style={styles.eventModalTitle}>
                          {selectedEvent.title}
                        </Text>
                        <Text style={styles.eventMetaText}>
                          {selectedEvent.is_all_day
                            ? `${formatEventDateLabel(selectedEvent.start_iso)} • All day`
                            : `${formatEventDateLabel(selectedEvent.start_iso)} • ${formatClockLabel(selectedEvent.start_iso)} - ${formatClockLabel(selectedEvent.end_iso)}`}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.eventModalCalendarChip,
                          { backgroundColor: selectedEventCalendarColor },
                        ]}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.eventModalScrollShell}>
                  <ScrollView
                    bounces
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[
                      styles.eventModalContent,
                      { paddingBottom: Math.max(insets.bottom, 18) + 28 },
                    ]}
                  >
                    {selectedEvent.description ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Description</Text>
                        <Text style={styles.detailSectionText}>{selectedEvent.description}</Text>
                      </View>
                    ) : null}

                    {selectedEvent.location ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Location</Text>
                        <Text style={styles.detailSectionText}>{selectedEvent.location}</Text>
                        {selectedEventMapPreview ? (
                          <View style={styles.locationPreviewWrap}>
                            <MapView
                              style={styles.locationPreviewMap}
                              pointerEvents="none"
                              scrollEnabled={false}
                              zoomEnabled={false}
                              rotateEnabled={false}
                              pitchEnabled={false}
                              initialRegion={{
                                latitude: selectedEventMapPreview.latitude,
                                longitude: selectedEventMapPreview.longitude,
                                ...MAP_PREVIEW_DELTA,
                              }}
                              region={{
                                latitude: selectedEventMapPreview.latitude,
                                longitude: selectedEventMapPreview.longitude,
                                ...MAP_PREVIEW_DELTA,
                              }}
                            >
                              <Marker
                                coordinate={{
                                  latitude: selectedEventMapPreview.latitude,
                                  longitude: selectedEventMapPreview.longitude,
                                }}
                              />
                            </MapView>
                            <View style={styles.locationActionOverlay}>
                              <Pressable
                                onPress={() => void openMapsDestination("apple")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={APPLE_MAPS_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                              <Pressable
                                onPress={() => void openMapsDestination("google")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={GOOGLE_MAPS_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                              <Pressable
                                onPress={() => void openMapsDestination("waze")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={WAZE_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                            </View>
                          </View>
                        ) : isResolvingSelectedEventMapPreview ? (
                          <View style={styles.locationPreviewLoading}>
                            <ActivityIndicator color={ACCENT} />
                            <View style={styles.locationActionOverlay}>
                              <Pressable
                                onPress={() => void openMapsDestination("apple")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={APPLE_MAPS_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                              <Pressable
                                onPress={() => void openMapsDestination("google")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={GOOGLE_MAPS_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                              <Pressable
                                onPress={() => void openMapsDestination("waze")}
                                style={styles.locationActionButton}
                              >
                                <Image
                                  source={WAZE_ICON}
                                  style={styles.locationActionIcon}
                                  resizeMode="contain"
                                />
                              </Pressable>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {selectedEventTravel ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Travel</Text>
                        <Text style={styles.detailSectionText}>
                          {selectedEventTravel.text}
                          {selectedEvent.leave_by_iso
                            ? ` • ${formatLeaveBy(selectedEvent.leave_by_iso)}`
                            : ""}
                        </Text>
                      </View>
                    ) : null}

                    {selectedEvent.attendees.length > 0 ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>People</Text>
                        {selectedEvent.attendees.map((attendee) => (
                          <Text
                            key={`${attendee.name}-${attendee.email ?? ""}`}
                            style={styles.detailSectionText}
                          >
                            {attendee.name}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {selectedEvent.notes ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Notes</Text>
                        <Text style={styles.detailSectionText}>{selectedEvent.notes}</Text>
                      </View>
                    ) : null}

                    {!selectedEvent.location &&
                    !selectedEvent.description &&
                    !selectedEventTravel &&
                    selectedEvent.attendees.length === 0 &&
                    !selectedEvent.notes ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTextMuted}>
                          No additional details for this event yet.
                        </Text>
                      </View>
                    ) : null}
                  </ScrollView>
                  <LinearGradient
                    pointerEvents="none"
                    colors={[PANEL, "rgba(31, 31, 31, 0)"]}
                    style={[styles.eventModalFade, styles.eventModalFadeTop]}
                  />
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(31, 31, 31, 0)", PANEL]}
                    style={[styles.eventModalFade, styles.eventModalFadeBottom]}
                  />
                </View>
              </Animated.View>
            ) : null}
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
  listContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
  emptyContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },
  title: {
    color: ACCENT,
    fontSize: 28,
    fontFamily: FONTS.semibold,
  },
  greeting: {
    color: MUTED,
    fontSize: 15,
    fontFamily: FONTS.regular,
    marginTop: 4,
  },
  separator: {
    height: 10,
  },
  card: {
    marginHorizontal: 18,
    borderRadius: 18,
    backgroundColor: CARD,
    padding: 16,
    overflow: "hidden",
  },
  cardNow: {
    backgroundColor: CARD_ALT,
  },
  calendarRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  timeColumn: {
    width: 78,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    alignSelf: "stretch",
    gap: 2,
  },
  timeText: {
    width: "100%",
    color: ACCENT,
    fontSize: 15,
    textAlign: "right",
    fontFamily: FONTS.semibold,
  },
  timeTextHighlight: {
    color: "#ffffff",
  },
  timeTextEnd: {
    width: "100%",
    color: MUTED,
    fontSize: 13,
    textAlign: "right",
    fontFamily: FONTS.regular,
  },
  cardBody: {
    flex: 1,
    gap: 6,
    minHeight: 46,
  },
  eventTitle: {
    color: ACCENT,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: FONTS.medium,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  locationText: {
    flex: 1,
    color: MUTED,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 10,
  },
  emptyTitle: {
    color: ACCENT,
    fontSize: 22,
    fontFamily: FONTS.semibold,
  },
  stateText: {
    color: MUTED,
    fontSize: 15,
    fontFamily: FONTS.regular,
    textAlign: "center",
    maxWidth: 260,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: CARD_ALT,
  },
  retryText: {
    color: ACCENT,
    fontSize: 15,
    fontFamily: FONTS.medium,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalSheet: {
    backgroundColor: PANEL,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingTop: 18,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  modalTitle: {
    color: ACCENT,
    fontSize: 22,
    fontFamily: FONTS.semibold,
  },
  modalDoneButton: {
    minWidth: 72,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
  },
  modalDoneText: {
    color: BACKGROUND,
    fontSize: 15,
    fontFamily: FONTS.semibold,
  },
  modalContent: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  eventModalSheet: {
    backgroundColor: PANEL,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
  },
  eventModalDragArea: {
    paddingTop: 4,
  },
  eventModalHandleArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    paddingBottom: 6,
  },
  eventModalGrabber: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#555555",
  },
  eventModalHeader: {
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  eventModalTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  eventModalTitleWrap: {
    flex: 1,
    gap: 8,
  },
  eventModalTitle: {
    color: ACCENT,
    fontSize: 22,
    fontFamily: FONTS.semibold,
  },
  eventModalCalendarChip: {
    width: 20,
    height: 20,
    borderRadius: 7,
    marginTop: 3,
  },
  eventMetaText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  eventModalScrollShell: {
    position: "relative",
    flex: 1,
  },
  eventModalContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 14,
  },
  eventModalFade: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 18,
  },
  eventModalFadeTop: {
    top: 0,
  },
  eventModalFadeBottom: {
    bottom: 0,
  },
  detailSection: {
    gap: 6,
  },
  detailSectionTitle: {
    color: ACCENT,
    fontSize: 15,
    fontFamily: FONTS.semibold,
  },
  detailSectionText: {
    color: "#c8c8c8",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONTS.regular,
  },
  locationPreviewWrap: {
    marginTop: 8,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  locationPreviewMap: {
    flex: 1,
  },
  locationPreviewLoading: {
    marginTop: 8,
    height: 72,
    borderRadius: 14,
    backgroundColor: CARD_ALT,
    alignItems: "center",
    justifyContent: "center",
  },
  locationActionOverlay: {
    position: "absolute",
    bottom: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  locationActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(31, 31, 31, 0.94)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  locationActionIcon: {
    width: 22,
    height: 22,
  },
  detailSectionTextMuted: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONTS.regular,
  },
  calendarSettingsRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PANEL_BORDER,
    paddingVertical: 14,
    gap: 10,
  },
  calendarSettingsTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  calendarSettingsName: {
    flex: 1,
    color: ACCENT,
    fontSize: 16,
    fontFamily: FONTS.medium,
  },
  calendarColorOptions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  calendarColorChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  calendarColorChipSelected: {
    borderColor: "#ffffff",
  },
  calendarColorChipFill: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
});
