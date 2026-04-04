import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { MapPressEvent, Marker, Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { FONTS } from "../constants/fonts";
import { reverseGeocodeLocation } from "../lib/settings";

const BACKGROUND = "#121212";
const PANEL = "#1f1f1f";
const PANEL_ALT = "#262626";
const BORDER = "#323232";
const TEXT = "#ffffff";
const MUTED = "#8b8b8b";
const ACCENT = "#ffffff";

export type SelectedLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

type Coordinate = {
  latitude: number;
  longitude: number;
};

type LocationPickerModalProps = {
  visible: boolean;
  title: string;
  initialCoordinate: Coordinate;
  initialLabel?: string;
  onClose: () => void;
  onConfirm: (selection: SelectedLocation) => void;
};

const DEFAULT_DELTA = {
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export function LocationPickerModal({
  visible,
  title,
  initialCoordinate,
  initialLabel,
  onClose,
  onConfirm,
}: LocationPickerModalProps) {
  const [selectedCoordinate, setSelectedCoordinate] = React.useState<Coordinate>(initialCoordinate);
  const [region, setRegion] = React.useState<Region>({
    ...initialCoordinate,
    ...DEFAULT_DELTA,
  });
  const [resolvedLabel, setResolvedLabel] = React.useState(initialLabel || "");
  const [isResolving, setIsResolving] = React.useState(false);
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const lookupSequenceRef = React.useRef(0);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    setSelectedCoordinate(initialCoordinate);
    setRegion({
      ...initialCoordinate,
      ...DEFAULT_DELTA,
    });
    setResolvedLabel(initialLabel || "");
    setResolveError(null);
  }, [initialCoordinate, initialLabel, visible]);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    const lookupId = ++lookupSequenceRef.current;
    setIsResolving(true);
    setResolveError(null);

    const timeoutId = setTimeout(() => {
      void (async () => {
        try {
          const result = await reverseGeocodeLocation(
            selectedCoordinate.latitude,
            selectedCoordinate.longitude,
          );
          if (lookupId !== lookupSequenceRef.current) {
            return;
          }
          setResolvedLabel(result.label);
        } catch (error) {
          if (lookupId !== lookupSequenceRef.current) {
            return;
          }
          setResolveError(
            error instanceof Error ? error.message : "Failed to look up this point.",
          );
        } finally {
          if (lookupId === lookupSequenceRef.current) {
            setIsResolving(false);
          }
        }
      })();
    }, 250);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedCoordinate.latitude, selectedCoordinate.longitude, visible]);

  const handleMapPress = React.useCallback((event: MapPressEvent) => {
    setSelectedCoordinate(event.nativeEvent.coordinate);
  }, []);

  const handleConfirm = React.useCallback(() => {
    const label = resolvedLabel.trim() || `${selectedCoordinate.latitude.toFixed(6)}, ${selectedCoordinate.longitude.toFixed(6)}`;
    onConfirm({
      label,
      latitude: selectedCoordinate.latitude,
      longitude: selectedCoordinate.longitude,
    });
  }, [onConfirm, resolvedLabel, selectedCoordinate.latitude, selectedCoordinate.longitude]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={[styles.headerButton, styles.headerButtonGhost]}>
            <Text style={styles.headerButtonText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          <Pressable onPress={handleConfirm} style={[styles.headerButton, styles.headerButtonFilled]}>
            <Text style={styles.headerButtonFilledText}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.mapShell}>
          <MapView
            style={styles.map}
            initialRegion={region}
            onPress={handleMapPress}
          >
            <Marker
              coordinate={selectedCoordinate}
              draggable
              onDragEnd={(event) => setSelectedCoordinate(event.nativeEvent.coordinate)}
            />
          </MapView>
        </View>

        <View style={styles.footer}>
          <View style={styles.resolvedRow}>
            {isResolving ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text style={styles.resolvedText}>
              {isResolving
                ? "Looking up address…"
                : resolveError
                  ? resolveError
                  : resolvedLabel || "Address will appear here."}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: TEXT,
    fontSize: 18,
    textAlign: "center",
    fontFamily: FONTS.semibold,
  },
  headerButton: {
    minWidth: 72,
    paddingVertical: 10,
  },
  headerButtonFilled: {
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: ACCENT,
    paddingHorizontal: 14,
  },
  headerButtonGhost: {
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: BACKGROUND,
    paddingHorizontal: 14,
  },
  headerButtonText: {
    color: MUTED,
    fontSize: 15,
    fontFamily: FONTS.semibold,
  },
  headerButtonFilledText: {
    color: BACKGROUND,
    fontSize: 15,
    fontFamily: FONTS.semibold,
  },
  mapShell: {
    flex: 1,
    marginHorizontal: 18,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
  },
  map: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  resolvedRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    backgroundColor: PANEL,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  resolvedText: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
  },
});
