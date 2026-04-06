import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PageCoachOverlay, useDelayedCoach } from "../components/PageCoachOverlay";
import { demoLogin, logIn, signUp } from "../lib/auth";

const BG = "#121212";
const CARD = "#1b1b1b";
const ACCENT = "#ffffff";
const MUTED = "#888";
const BORDER = "#2a2a2a";
const ERROR_COLOR = "#eb4034";

type Tab = "signup" | "login";

type Props = {
  onAuth: (token: string, isDemo: boolean, demoEntries?: object[]) => void;
};

export function AuthScreen({ onAuth }: Props) {
  const [tab, setTab] = React.useState<Tab>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const { visible: isCoachVisible, dismiss: dismissCoach } = useDelayedCoach(!loading);

  const handleSubmit = React.useCallback(async () => {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const res = tab === "signup"
        ? await signUp(email.trim(), password)
        : await logIn(email.trim(), password);
      onAuth(res.token, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [tab, email, password, onAuth]);

  const handleDemo = React.useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await demoLogin();
      onAuth(res.token, true, res.demo_entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo unavailable.");
    } finally {
      setLoading(false);
    }
  }, [onAuth]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoRow}>
            <Text style={styles.logoText}>Sunday</Text>
            <Text style={styles.tagline}>
              Log in or start the guided demo walkthrough with one tap.
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Tab bar */}
            <View style={styles.tabBar}>
              {(["signup", "login"] as Tab[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.tab, tab === t && styles.tabActive]}
                  onPress={() => { setTab(t); setError(""); }}
                >
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                    {t === "signup" ? "Sign Up" : "Log In"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Inputs */}
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              onSubmitEditing={handleSubmit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={BG} />
              ) : (
                <Text style={styles.btnText}>
                  {tab === "signup" ? "Create Account" : "Log In"}
                </Text>
              )}
            </Pressable>

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Demo */}
            <Pressable
              style={[styles.demoBtn, loading && styles.btnDisabled]}
              onPress={handleDemo}
              disabled={loading}
            >
              <Text style={styles.demoBtnText}>Try Demo  →</Text>
            </Pressable>
            <Text style={styles.demoHint}>
              No sign-up needed — jump straight into the guided walkthrough with sample data
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <PageCoachOverlay
        visible={isCoachVisible}
        eyebrow="Start here"
        title="Choose how you want to enter Sunday"
        body="If you want the quickest walkthrough, use the Try Demo button. If you already have an account, stay on Log In and continue there."
        steps={[
          "1. Tap “Try Demo” to load the guided sample flow.",
          "2. Or stay on “Log In” and enter your own account details.",
          "3. After demo starts, Sunday will guide you through Entries and Today.",
        ]}
        primaryAction={{ label: "Start demo walkthrough", onPress: () => void handleDemo() }}
        secondaryAction={{ label: "Use Log In", onPress: () => setTab("login") }}
        onDismiss={dismissCoach}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    gap: 32,
  },
  logoRow: {
    alignItems: "center",
    gap: 8,
  },
  logoText: {
    fontSize: 42,
    fontFamily: "GoogleSans-Bold",
    color: ACCENT,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 15,
    fontFamily: "GoogleSans-Regular",
    color: MUTED,
    textAlign: "center",
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 24,
    gap: 14,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: BG,
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: "center",
  },
  tabActive: { backgroundColor: CARD },
  tabText: {
    fontFamily: "GoogleSans-Medium",
    fontSize: 14,
    color: MUTED,
  },
  tabTextActive: { color: ACCENT },
  input: {
    backgroundColor: BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "GoogleSans-Regular",
    color: ACCENT,
  },
  error: {
    fontSize: 13,
    fontFamily: "GoogleSans-Regular",
    color: ERROR_COLOR,
    textAlign: "center",
  },
  btn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: {
    fontFamily: "GoogleSans-SemiBold",
    fontSize: 16,
    color: BG,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: {
    fontFamily: "GoogleSans-Regular",
    fontSize: 13,
    color: MUTED,
  },
  demoBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  demoBtnText: {
    fontFamily: "GoogleSans-SemiBold",
    fontSize: 16,
    color: ACCENT,
  },
  demoHint: {
    fontFamily: "GoogleSans-Regular",
    fontSize: 12,
    color: MUTED,
    textAlign: "center",
    marginTop: -4,
  },
});
