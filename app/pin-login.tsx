import { useState, useRef } from "react";
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

  const handlePinChange = (value: string, index: number) => {
    if (value.length > 1) {
      // Handle paste - distribute digits across inputs
      const digits = value.replace(/\D/g, "").slice(0, 4);
      const newPin = [...pin];
      for (let i = 0; i < digits.length && index + i < 4; i++) {
        newPin[index + i] = digits[i];
      }
      setPin(newPin);
      
      // Focus last filled input or next empty
      const nextIndex = Math.min(index + digits.length, 3);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    const newPin = [...pin];
    newPin[index] = value.replace(/\D/g, "");
    setPin(newPin);
    setError(null);

    // Auto-focus next input
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleLogin = async () => {
    const fullPin = pin.join("");
    if (fullPin.length !== 4) {
      setError("Please enter your 4-digit PIN");
      return;
    }

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
        inputRefs.current[0]?.focus();
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
    } finally {
      setLoading(false);
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
                  borderColor: error ? colors.error : colors.border,
                  color: colors.foreground,
                },
              ]}
              value={digit}
              onChangeText={(value) => handlePinChange(value, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              selectTextOnFocus
              autoFocus={index === 0}
            />
          ))}
        </View>

        {error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}

        {/* Login Button */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            { backgroundColor: colors.primary },
            loading && styles.loginButtonDisabled,
          ]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[styles.loginButtonText, { color: colors.background }]}>
              Sign In
            </Text>
          )}
        </TouchableOpacity>

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
