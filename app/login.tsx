import { useEffect } from "react";
import { Text, View, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { startOAuthLogin } from "@/constants/oauth";

export default function LoginScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !loading) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, loading, router]);

  const handleLogin = async () => {
    try {
      await startOAuthLogin();
    } catch (error) {
      console.error("[Login] Error:", error);
    }
  };

  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View className="flex-1 items-center justify-center px-6">
        {/* Logo/Brand Section */}
        <View className="items-center mb-12">
          <View className="w-24 h-24 rounded-full bg-primary items-center justify-center mb-6">
            <Text className="text-4xl text-background font-bold">MC</Text>
          </View>
          <Text className="text-3xl font-bold text-foreground text-center">
            Ms. Chu Sales Tracker
          </Text>
          <Text className="text-base text-muted text-center mt-2">
            Track your sales performance
          </Text>
        </View>

        {/* Login Button */}
        <TouchableOpacity
          onPress={handleLogin}
          className="w-full max-w-sm bg-primary py-4 rounded-xl items-center active:opacity-80"
        >
          <Text className="text-background font-semibold text-lg">
            Sign In with Manus
          </Text>
        </TouchableOpacity>

        {/* Footer */}
        <View className="absolute bottom-8 items-center">
          <Text className="text-sm text-muted text-center">
            Ms. Chu Soap & Beaut
          </Text>
          <Text className="text-xs text-muted text-center mt-1">
            Natural skincare for all skin types
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}
