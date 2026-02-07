import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { setUserInfo, setSessionToken, type User } from "@/lib/_core/auth";

const API_BASE = Platform.OS === "web" 
  ? "" 
  : process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export default function PinLoginScreen() {
  const colors = useColors();
  const [pin, setPin] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const loginTriggered = useRef(false);

  const handleLogin = useCallback(async (fullPin: string) => {
    if (fullPin.length !== 4) {
      setError("Please enter your 4-digit PIN");
      return;
    }

    // Prevent double-trigger
    if (loginTriggered.current) return;
    loginTriggered.current = true;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/auth/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ pin: fullPin }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        setError(data.error || "Invalid PIN");
        setPin(["", "", "", ""]);
        loginTriggered.current = false;
        // Focus first input after a short delay
        setTimeout(() => {
          inputRefs.current[0]?.focus();
        }, 100);
        return;
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Store session token for native
      if (data.sessionToken) {
        await setSessionToken(data.sessionToken);
      }

      // Store user info
      if (data.user) {
        const user: User = {
          id: data.user.id,
          openId: data.user.openId,
          name: data.user.name,
          email: data.user.email,
          loginMethod: "pin",
          role: data.user.role || "user",
          lastSignedIn: new Date(data.user.lastSignedIn),
        };
        await setUserInfo(user);
      }

      // Navigate to main app
      router.replace("/(tabs)");
    } catch (err) {
      console.error("[PIN Login] Error:", err);
      setError("Connection error. Please try again.");
      loginTriggered.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-login when all 4 digits are entered
  useEffect(() => {
    const fullPin = pin.join("");
    if (fullPin.length === 4 && !loading && !loginTriggered.current) {
      handleLogin(fullPin);
    }
  }, [pin, loading, handleLogin]);

  const handlePinChange = (value: string, index: number) => {
    // Strip non-digits
    const cleanValue = value.replace(/\D/g, "");
    
    if (cleanValue.length === 0) {
      // Clearing the input
      const newPin = [...pin];
      newPin[index] = "";
      setPin(newPin);
      setError(null);
      return;
    }

    if (cleanValue.length > 1) {
      // Handle paste - distribute digits across inputs starting from current index
      const digits = cleanValue.slice(0, 4 - index);
      const newPin = [...pin];
      for (let i = 0; i < digits.length && index + i < 4; i++) {
        newPin[index + i] = digits[i];
      }
      setPin(newPin);
      setError(null);
      loginTriggered.current = false;
      
      // Focus the next empty input or last filled
      const nextIndex = Math.min(index + digits.length, 3);
      if (nextIndex < 4) {
        inputRefs.current[nextIndex]?.focus();
      }
      return;
    }

    // Single digit entered
    const newPin = [...pin];
    newPin[index] = cleanValue;
    setPin(newPin);
    setError(null);
    loginTriggered.current = false;

    // Auto-focus next input
    if (cleanValue && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace") {
      if (!pin[index] && index > 0) {
        // If current input is empty, go back and clear previous
        const newPin = [...pin];
        newPin[index - 1] = "";
        setPin(newPin);
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleManusLogin = () => {
    router.replace("/login");
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.container}>
        {/* Logo */}
        <View style={[styles.logoContainer, { backgroundColor: colors.primary }]}>
          <Text style={styles.logoText}>MC</Text>
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          Staff Login
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Enter your 4-digit POS PIN
        </Text>

        {/* PIN Input */}
        <View style={styles.pinContainer}>
          {pin.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[
                styles.pinInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: digit
                    ? colors.primary
                    : error
                    ? colors.error
                    : colors.border,
                  color: colors.foreground,
                },
              ]}
              value={digit}
              onChangeText={(value) => handlePinChange(value, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              secureTextEntry
              selectTextOnFocus
              autoFocus={index === 0}
              editable={!loading}
            />
          ))}
        </View>

        {error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}

        {/* Loading indicator or Login Button */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Signing in...
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.loginButton,
              { backgroundColor: colors.primary },
            ]}
            onPress={() => handleLogin(pin.join(""))}
            activeOpacity={0.8}
          >
            <Text style={[styles.loginButtonText, { color: colors.background }]}>
              Sign In
            </Text>
          </TouchableOpacity>
        )}

        {/* Help text */}
        <View style={styles.helpContainer}>
          <Text style={[styles.helpText, { color: colors.muted }]}>
            Enter your 4-digit staff PIN to access your sales dashboard
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.muted }]}>
            Ms. Chu Soap & Beaut
          </Text>
          <Text style={[styles.footerSubtext, { color: colors.muted }]}>
            Natural skincare for all skin types
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  logoText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
  },
  pinContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  pinInput: {
    width: 56,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  error: {
    fontSize: 14,
    marginBottom: 16,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
  },
  loginButton: {
    width: "100%",
    maxWidth: 280,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 16,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 280,
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  helpContainer: {
    width: "100%",
    maxWidth: 280,
    marginTop: 24,
    alignItems: "center",
  },
  helpText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  footer: {
    position: "absolute",
    bottom: 40,
    alignItems: "center",
  },
  footerText: {
    fontSize: 14,
  },
  footerSubtext: {
    fontSize: 12,
    marginTop: 4,
  },
});
