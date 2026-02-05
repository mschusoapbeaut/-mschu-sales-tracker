import { useState, useEffect } from "react";
import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, Alert, Platform, Linking, TextInput } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { parseCSV, ParseResult } from "@/lib/report-parser";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export default function ProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const colors = useColors();
  const { user, isAuthenticated, logout } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showStaffMapping, setShowStaffMapping] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<{ userId: number; staffId: string } | null>(null);
  const [unmappedStaffIds, setUnmappedStaffIds] = useState<string[]>([]);
  const [excelImportResult, setExcelImportResult] = useState<{
    success: boolean;
    importedCount: number;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const isAdmin = user?.role === "admin" || false;
  const utils = trpc.useUtils();

  // Admin queries
  const { data: teamSummary, isLoading: teamLoading, refetch: refetchTeam } = trpc.admin.teamSummary.useQuery(
    { period: "month" },
    { enabled: isAuthenticated && isAdmin }
  );

  const { data: allUsers, refetch: refetchUsers } = trpc.admin.users.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin }
  );

  // Google Drive queries
  const { data: driveStatus, refetch: refetchDriveStatus } = trpc.drive.status.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin }
  );

  const { data: authUrl } = trpc.drive.getAuthUrl.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin && !driveStatus?.connected }
  );

  const { data: driveFolders, isLoading: foldersLoading } = trpc.drive.listFolders.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin && driveStatus?.connected && showFolderPicker }
  );

  const { data: syncHistory, refetch: refetchSyncHistory } = trpc.drive.syncHistory.useQuery(
    undefined,
    { enabled: isAuthenticated && isAdmin && driveStatus?.connected }
  );

  // Google Drive mutations
  const saveCredentialsMutation = trpc.drive.saveCredentials.useMutation({
    onSuccess: () => {
      refetchDriveStatus();
      Alert.alert("Success", "Google Drive connected successfully!");
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  const setFolderMutation = trpc.drive.setFolder.useMutation({
    onSuccess: () => {
      setShowFolderPicker(false);
      refetchDriveStatus();
      Alert.alert("Success", "Folder selected successfully!");
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  const syncMutation = trpc.drive.sync.useMutation({
    onSuccess: (result) => {
      refetchSyncHistory();
      refetchTeam();
      if (result.success) {
        Alert.alert(
          "Sync Complete",
          `Processed ${result.filesProcessed} files, imported ${result.recordsImported} records`
        );
      } else {
        Alert.alert("Sync Issues", result.errors.join("\n"));
      }
    },
    onError: (error) => {
      Alert.alert("Sync Error", error.message);
    },
  });

  const disconnectMutation = trpc.drive.disconnect.useMutation({
    onSuccess: () => {
      refetchDriveStatus();
      Alert.alert("Disconnected", "Google Drive has been disconnected");
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  // Staff mapping mutation
  const updateStaffIdMutation = trpc.admin.updateStaffId.useMutation({
    onSuccess: () => {
      refetchUsers();
      setEditingStaffId(null);
      Alert.alert("Success", "Staff ID updated successfully");
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  // Excel import mutation
  const importExcelMutation = trpc.admin.importExcel.useMutation({
    onSuccess: (result) => {
      setExcelImportResult(result);
      if (result.success) {
        refetchTeam();
        Alert.alert("Success", `Imported ${result.importedCount} sales records`);
      } else if (result.unmappedStaffIds && result.unmappedStaffIds.length > 0) {
        setUnmappedStaffIds(result.unmappedStaffIds);
        setShowStaffMapping(true);
      }
    },
    onError: (error) => {
      Alert.alert("Error", error.message);
    },
  });

  // Handle OAuth callback code from URL params
  useEffect(() => {
    const code = params.code as string | undefined;
    if (code && isAdmin) {
      saveCredentialsMutation.mutate({ code });
      // Clear the URL params
      router.setParams({ code: undefined });
    }
  }, [params.code, isAdmin]);

  // Import mutation (for CSV)
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

  const handleConnectDrive = () => {
    if (authUrl?.authUrl) {
      Linking.openURL(authUrl.authUrl);
    }
  };

  const handleDisconnectDrive = () => {
    Alert.alert(
      "Disconnect Google Drive",
      "Are you sure you want to disconnect Google Drive? Auto-sync will stop.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => disconnectMutation.mutate(),
        },
      ]
    );
  };

  const handleSelectFolder = (folderId: string, folderName: string) => {
    setFolderMutation.mutate({ folderId, folderName });
  };

  const handleUploadReport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/plain",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setUploading(true);
      const asset = result.assets[0];
      const fileName = asset.name || "report";
      const isExcel = fileName.toLowerCase().endsWith(".xlsx") || fileName.toLowerCase().endsWith(".xls");

      if (isExcel) {
        // Handle Excel file
        let base64Data: string;
        
        if (Platform.OS === "web") {
          // For web, fetch and convert to base64
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]); // Remove data URL prefix
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } else {
          // For native, use FileSystem
          base64Data = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        // Import Excel file
        importExcelMutation.mutate({
          fileData: base64Data,
          fileName: fileName,
        });
      } else {
        // Handle CSV file
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
      }
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

  const handleSaveStaffId = (userId: number, staffId: string) => {
    updateStaffIdMutation.mutate({
      userId,
      staffId: staffId.trim() || null,
    });
  };

  const formatCurrency = (value: number | string | null) => {
    if (value === null) return "HK$0";
    const num = typeof value === "string" ? parseFloat(value) : value;
    return `HK$${num.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return "Never";
    const d = new Date(date);
    return d.toLocaleDateString("en-HK", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
            {/* Staff ID Mapping */}
            <View className="px-5 py-3">
              <TouchableOpacity
                onPress={() => setShowStaffMapping(!showStaffMapping)}
                className="flex-row items-center justify-between"
              >
                <Text className="text-lg font-semibold text-foreground">Staff ID Mapping</Text>
                <MaterialIcons
                  name={showStaffMapping ? "expand-less" : "expand-more"}
                  size={24}
                  color={colors.muted}
                />
              </TouchableOpacity>

              {showStaffMapping && (
                <View className="mt-3 bg-surface rounded-2xl border border-border overflow-hidden">
                  <View className="p-3 bg-primary/10 border-b border-border">
                    <Text className="text-sm text-foreground">
                      Map each user to their WVReferredByStaff ID from the sales report
                    </Text>
                  </View>

                  {unmappedStaffIds.length > 0 && (
                    <View className="p-3 bg-warning/10 border-b border-border">
                      <Text className="text-sm text-warning font-medium mb-1">Unmapped Staff IDs found:</Text>
                      <Text className="text-xs text-muted">{unmappedStaffIds.join(", ")}</Text>
                    </View>
                  )}

                  {allUsers?.map((u, index) => (
                    <View
                      key={u.id}
                      className={`p-3 flex-row items-center ${
                        index < (allUsers?.length || 0) - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <View className="flex-1">
                        <Text className="font-medium text-foreground">{u.name || "Unknown"}</Text>
                        <Text className="text-xs text-muted">{u.email}</Text>
                      </View>
                      
                      {editingStaffId?.userId === u.id ? (
                        <View className="flex-row items-center">
                          <TextInput
                            value={editingStaffId.staffId}
                            onChangeText={(text) => setEditingStaffId({ ...editingStaffId, staffId: text })}
                            placeholder="Staff ID"
                            keyboardType="numeric"
                            className="w-32 px-2 py-1 bg-background border border-border rounded text-foreground text-sm"
                            placeholderTextColor={colors.muted}
                          />
                          <TouchableOpacity
                            onPress={() => handleSaveStaffId(u.id, editingStaffId.staffId)}
                            disabled={updateStaffIdMutation.isPending}
                            className="ml-2 p-1"
                          >
                            <MaterialIcons name="check" size={20} color={colors.success} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setEditingStaffId(null)}
                            className="ml-1 p-1"
                          >
                            <MaterialIcons name="close" size={20} color={colors.error} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setEditingStaffId({ userId: u.id, staffId: u.staffId || "" })}
                          className="flex-row items-center"
                        >
                          {u.staffId ? (
                            <View className="flex-row items-center bg-primary/10 px-2 py-1 rounded">
                              <Text className="text-sm text-primary">{u.staffId}</Text>
                              <MaterialIcons name="edit" size={14} color={colors.primary} className="ml-1" />
                            </View>
                          ) : (
                            <View className="flex-row items-center bg-warning/10 px-2 py-1 rounded">
                              <Text className="text-sm text-warning">Not set</Text>
                              <MaterialIcons name="add" size={14} color={colors.warning} className="ml-1" />
                            </View>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Google Drive Integration */}
            <View className="px-5 py-3">
              <Text className="text-lg font-semibold text-foreground mb-3">Google Drive Sync</Text>
              
              <View className="bg-surface rounded-2xl border border-border p-4">
                {driveStatus?.connected ? (
                  <>
                    {/* Connected Status */}
                    <View className="flex-row items-center mb-3">
                      <MaterialIcons name="cloud-done" size={24} color={colors.success} />
                      <Text className="text-foreground font-medium ml-2">Connected to Google Drive</Text>
                    </View>

                    {/* Folder Selection */}
                    <View className="mb-3">
                      <Text className="text-sm text-muted mb-1">Sync Folder:</Text>
                      {driveStatus.folderName ? (
                        <View className="flex-row items-center justify-between">
                          <View className="flex-row items-center flex-1">
                            <MaterialIcons name="folder" size={20} color={colors.primary} />
                            <Text className="text-foreground ml-2">{driveStatus.folderName}</Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setShowFolderPicker(true)}
                            className="px-3 py-1 bg-primary/10 rounded-lg"
                          >
                            <Text className="text-primary text-sm">Change</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setShowFolderPicker(true)}
                          className="py-2 px-4 bg-primary/10 rounded-lg flex-row items-center justify-center"
                        >
                          <MaterialIcons name="folder-open" size={20} color={colors.primary} />
                          <Text className="text-primary ml-2">Select Folder</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Last Sync */}
                    <View className="mb-3">
                      <Text className="text-sm text-muted">
                        Last synced: {formatDate(driveStatus.lastSyncAt)}
                      </Text>
                    </View>

                    {/* Sync Button */}
                    <TouchableOpacity
                      onPress={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending || !driveStatus.folderId}
                      className={`py-3 rounded-xl flex-row items-center justify-center ${
                        driveStatus.folderId ? "bg-primary" : "bg-border"
                      }`}
                    >
                      {syncMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.background} />
                      ) : (
                        <>
                          <MaterialIcons name="sync" size={20} color={driveStatus.folderId ? colors.background : colors.muted} />
                          <Text className={`font-medium ml-2 ${driveStatus.folderId ? "text-background" : "text-muted"}`}>
                            Sync Now
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Disconnect */}
                    <TouchableOpacity
                      onPress={handleDisconnectDrive}
                      className="mt-3 py-2 items-center"
                    >
                      <Text className="text-error text-sm">Disconnect Google Drive</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Not Connected */}
                    <View className="items-center py-4">
                      <MaterialIcons name="cloud-off" size={48} color={colors.muted} />
                      <Text className="text-muted mt-2 text-center">
                        Connect Google Drive to automatically sync sales reports
                      </Text>
                      <TouchableOpacity
                        onPress={handleConnectDrive}
                        disabled={saveCredentialsMutation.isPending}
                        className="mt-4 py-3 px-6 bg-primary rounded-xl flex-row items-center"
                      >
                        {saveCredentialsMutation.isPending ? (
                          <ActivityIndicator size="small" color={colors.background} />
                        ) : (
                          <>
                            <MaterialIcons name="add-to-drive" size={20} color={colors.background} />
                            <Text className="text-background font-medium ml-2">Connect Google Drive</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* Folder Picker Modal */}
            {showFolderPicker && (
              <View className="px-5 py-3">
                <View className="bg-surface rounded-2xl border border-border p-4">
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="font-semibold text-foreground">Select Folder</Text>
                    <TouchableOpacity onPress={() => setShowFolderPicker(false)}>
                      <MaterialIcons name="close" size={24} color={colors.muted} />
                    </TouchableOpacity>
                  </View>
                  
                  {foldersLoading ? (
                    <View className="py-8 items-center">
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text className="text-muted mt-2">Loading folders...</Text>
                    </View>
                  ) : driveFolders && driveFolders.length > 0 ? (
                    <ScrollView style={{ maxHeight: 300 }}>
                      {driveFolders.map((folder) => (
                        <TouchableOpacity
                          key={folder.id}
                          onPress={() => handleSelectFolder(folder.id, folder.name)}
                          disabled={setFolderMutation.isPending}
                          className="py-3 px-2 flex-row items-center border-b border-border"
                        >
                          <MaterialIcons name="folder" size={24} color={colors.primary} />
                          <Text className="text-foreground ml-3 flex-1">{folder.name}</Text>
                          <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : (
                    <View className="py-8 items-center">
                      <Text className="text-muted">No folders found</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Sync History */}
            {driveStatus?.connected && syncHistory && syncHistory.length > 0 && (
              <View className="px-5 py-3">
                <Text className="text-sm font-medium text-muted mb-2">Recent Sync History</Text>
                <View className="bg-surface rounded-xl border border-border overflow-hidden">
                  {syncHistory.slice(0, 5).map((item, index) => (
                    <View
                      key={item.id}
                      className={`p-3 flex-row items-center ${
                        index < Math.min(syncHistory.length, 5) - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <MaterialIcons
                        name={item.status === "success" ? "check-circle" : item.status === "failed" ? "error" : "remove-circle"}
                        size={16}
                        color={item.status === "success" ? colors.success : item.status === "failed" ? colors.error : colors.muted}
                      />
                      <View className="ml-2 flex-1">
                        <Text className="text-sm text-foreground" numberOfLines={1}>{item.fileName}</Text>
                        <Text className="text-xs text-muted">{formatDate(item.syncedAt)}</Text>
                      </View>
                      {item.status === "success" && (
                        <Text className="text-xs text-muted">{item.recordsImported} records</Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Upload Report */}
            <View className="px-5 py-3">
              <Text className="text-lg font-semibold text-foreground mb-3">Manual Upload</Text>
              
              <TouchableOpacity
                onPress={handleUploadReport}
                disabled={uploading || importExcelMutation.isPending}
                className="bg-primary rounded-xl p-4 flex-row items-center justify-center active:opacity-80"
              >
                {uploading || importExcelMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <>
                    <MaterialIcons name="upload-file" size={24} color={colors.background} />
                    <Text className="text-background font-semibold ml-2">Upload Sales Report</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text className="text-xs text-muted mt-2 text-center">
                Supports Excel (.xlsx) with WVReferredByStaff tags or CSV files
              </Text>
            </View>

            {/* Excel Import Result */}
            {excelImportResult && !excelImportResult.success && (
              <View className="px-5 py-3">
                <View className="bg-surface rounded-2xl border border-border p-4">
                  <View className="flex-row items-center mb-2">
                    <MaterialIcons name="warning" size={20} color={colors.warning} />
                    <Text className="text-warning font-medium ml-2">Import Issues</Text>
                  </View>
                  
                  {excelImportResult.errors.length > 0 && (
                    <View className="mb-2">
                      <Text className="text-sm text-error">Errors:</Text>
                      {excelImportResult.errors.slice(0, 3).map((e, i) => (
                        <Text key={i} className="text-xs text-muted">• {e}</Text>
                      ))}
                    </View>
                  )}

                  {excelImportResult.warnings.length > 0 && (
                    <View className="mb-2">
                      <Text className="text-sm text-warning">Warnings:</Text>
                      {excelImportResult.warnings.slice(0, 5).map((w, i) => (
                        <Text key={i} className="text-xs text-muted">• {w}</Text>
                      ))}
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={() => {
                      setExcelImportResult(null);
                      setShowStaffMapping(true);
                    }}
                    className="mt-2 py-2 rounded-lg bg-primary items-center"
                  >
                    <Text className="font-medium text-background">Configure Staff Mapping</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Parse Result Preview (for CSV) */}
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
