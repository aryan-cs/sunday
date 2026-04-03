import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { usePushNotifications } from "./src/hooks/usePushNotifications";

function AppContent() {
  usePushNotifications();
  return <DashboardScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
