import { useState } from "react";
import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { parseCSV, ParseResult } from "@/lib/report-parser";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export default function ProfileScreen() {
  const router = useRouter();
  const colors = useColors();
  const { user, isAuthenticated, logout } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  const isAdmin = user?.role === "admin" || false;

  // Admin queries
  const { data: teamSummary, isLoading: teamLoading, refetch: refetchTeam } = trpc.admin.teamSummary.useQuery(
    { period: "month" },
    { enabled: isAuthenticated && isAdmin }
  );

  const { data: allUsers } = trpc.admin.users.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin }
  );

  // Import mutation
  const importMutation = trpc.admin.importSales.useMutation({
    onSuccess: (data) => {
      Alert.alert("Success", `Imported ${data.importedCount} sales records`);
      setParseResult(null);
      refetchTeam();
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  const handleLogout = async () => {
    if (Platform.OS === "web") {
      await logout();
      router.replace("/login");
    } else {
      Alert.alert("Logout", "Are you sure you want to logout?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/login");
          },
        },
      ]);
    }
  };

  const handleUploadReport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/plain", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setUploading(true);
      const asset = result.assets[0];

      // Read file content
      const response = await fetch(asset.uri);
      const content = await response.text();

      // Create user mapping from allUsers
      const userMapping: Record<string, number> = {};
      allUsers?.forEach((u) => {
        if (u.name) {
          userMapping[u.name.toLowerCase()] = u.id;
        }
        if (u.email) {
          userMapping[u.email.toLowerCase()] = u.id;
        }
      });

      // Parse the CSV
      const parsed = parseCSV(content, userMapping);
      setParseResult(parsed);
      setUploading(false);
    } catch (error) {
      setUploading(false);
      Alert.alert("Error", "Failed to read the file");
      console.error(error);
    }
  };

  const handleConfirmImport = () => {
    if (!parseResult || parseResult.records.length === 0) return;

    importMutation.mutate({
      sales: parseResult.records,
    });
  };

  const formatCurrency = (value: number | string | null) => {
    if (value === null) return "HK$0";
    const num = typeof value === "string" ? parseFloat(value) : value;
    return `HK$${num.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="px-5 pt-4 pb-2">
          <Text className="text-2xl font-bold text-foreground">Profile</Text>
        </View>

        {/* User Info Card */}
        <View className="px-5 py-3">
          <View className="bg-surface rounded-2xl border border-border p-5">
            <View className="flex-row items-center">
              <View className="w-16 h-16 rounded-full bg-primary items-center justify-center">
                <Text className="text-2xl text-background font-bold">
                  {user?.name?.charAt(0)?.toUpperCase() || "U"}
                </Text>
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-xl font-semibold text-foreground">{user?.name || "User"}</Text>
                <Text className="text-sm text-muted">{user?.email || ""}</Text>
                {isAdmin && (
                  <View className="flex-row items-center mt-1">
                    <MaterialIcons name="verified" size={14} color={colors.primary} />
                    <Text className="text-sm text-primary ml-1">Administrator</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Admin Section */}
        {isAdmin && (
          <>
            {/* Upload Report */}
            <View className="px-5 py-3">
              <Text className="text-lg font-semibold text-foreground mb-3">Admin Panel</Text>
              
              <TouchableOpacity
                onPress={handleUploadReport}
                disabled={uploading}
                className="bg-primary rounded-xl p-4 flex-row items-center justify-center active:opacity-80"
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <>
                    <MaterialIcons name="upload-file" size={24} color={colors.background} />
                    <Text className="text-background font-semibold ml-2">Upload Sales Report</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text className="text-xs text-muted mt-2 text-center">
                Supported formats: CSV with columns for Date, Salesperson, Product, Quantity, Price, Total
              </Text>
            </View>

            {/* Parse Result Preview */}
            {parseResult && (
              <View className="px-5 py-3">
                <View className="bg-surface rounded-2xl border border-border p-4">
                  <Text className="font-semibold text-foreground mb-2">Import Preview</Text>
                  
                  {parseResult.success ? (
                    <>
                      <View className="flex-row items-center mb-2">
                        <MaterialIcons name="check-circle" size={20} color={colors.success} />
                        <Text className="text-success ml-2">
                          {parseResult.records.length} records ready to import
                        </Text>
                      </View>
                      
                      {parseResult.warnings.length > 0 && (
                        <View className="mb-2">
                          <Text className="text-sm text-warning">Warnings:</Text>
                          {parseResult.warnings.slice(0, 3).map((w, i) => (
                            <Text key={i} className="text-xs text-muted">• {w}</Text>
                          ))}
                          {parseResult.warnings.length > 3 && (
                            <Text className="text-xs text-muted">
                              ...and {parseResult.warnings.length - 3} more
                            </Text>
                          )}
                        </View>
                      )}

                      <View className="flex-row gap-2 mt-3">
                        <TouchableOpacity
                          onPress={() => setParseResult(null)}
                          className="flex-1 py-3 rounded-lg bg-border items-center"
                        >
                          <Text className="font-medium text-foreground">Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleConfirmImport}
                          disabled={importMutation.isPending}
                          className="flex-1 py-3 rounded-lg bg-primary items-center"
                        >
                          {importMutation.isPending ? (
                            <ActivityIndicator size="small" color={colors.background} />
                          ) : (
                            <Text className="font-medium text-background">Import</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <View className="flex-row items-center mb-2">
                        <MaterialIcons name="error" size={20} color={colors.error} />
                        <Text className="text-error ml-2">Failed to parse file</Text>
                      </View>
                      {parseResult.errors.map((e, i) => (
                        <Text key={i} className="text-xs text-muted">• {e}</Text>
                      ))}
                      <TouchableOpacity
                        onPress={() => setParseResult(null)}
                        className="mt-3 py-2 rounded-lg bg-border items-center"
                      >
                        <Text className="font-medium text-foreground">Dismiss</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            )}

            {/* Team Performance */}
            <View className="px-5 py-3">
              <Text className="text-lg font-semibold text-foreground mb-3">Team Performance (This Month)</Text>
              
              {teamLoading ? (
                <View className="py-8 items-center">
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : teamSummary && teamSummary.length > 0 ? (
                <View className="bg-surface rounded-2xl border border-border overflow-hidden">
                  {teamSummary.map((member, index) => (
                    <View
                      key={member.userId}
                      className={`p-4 flex-row justify-between items-center ${
                        index < teamSummary.length - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <View className="flex-row items-center flex-1">
                        <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center">
                          <Text className="text-primary font-semibold">
                            {member.userName?.charAt(0)?.toUpperCase() || "?"}
                          </Text>
                        </View>
                        <View className="ml-3">
                          <Text className="font-medium text-foreground">{member.userName || "Unknown"}</Text>
                          <Text className="text-sm text-muted">{member.orderCount} orders</Text>
                        </View>
                      </View>
                      <Text className="font-semibold text-foreground">
                        {formatCurrency(member.totalSales)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View className="bg-surface rounded-2xl border border-border p-8 items-center">
                  <MaterialIcons name="groups" size={48} color={colors.muted} />
                  <Text className="text-muted mt-2">No team data available</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Logout Button */}
        <View className="px-5 py-6">
          <TouchableOpacity
            onPress={handleLogout}
            className="bg-error/10 rounded-xl p-4 flex-row items-center justify-center active:opacity-80"
          >
            <MaterialIcons name="logout" size={24} color={colors.error} />
            <Text className="text-error font-semibold ml-2">Logout</Text>
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View className="px-5 pb-8 items-center">
          <Text className="text-xs text-muted">Ms. Chu Sales Tracker</Text>
          <Text className="text-xs text-muted">Version 1.0.0</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
