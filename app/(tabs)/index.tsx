import { useEffect, useState } from "react";
import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

type Period = "week" | "month" | "year";

export default function DashboardScreen() {
  const router = useRouter();
  const colors = useColors();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [refreshing, setRefreshing] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch dashboard data
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.sales.summary.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const { data: recentSales, isLoading: recentLoading, refetch: refetchRecent } = trpc.sales.recent.useQuery(
    { limit: 5 },
    { enabled: isAuthenticated }
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchRecent()]);
    setRefreshing(false);
  };

  if (authLoading || !isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  const isLoading = summaryLoading || recentLoading;

  const formatCurrency = (value: number) => {
    return `HK$${value.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const periodLabels: Record<Period, string> = {
    week: "This Week",
    month: "This Month",
    year: "This Year",
  };

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View className="px-5 pt-4 pb-2">
          <Text className="text-sm text-muted">Welcome back,</Text>
          <Text className="text-2xl font-bold text-foreground">{user?.name || "Team Member"}</Text>
        </View>

        {/* Period Selector */}
        <View className="flex-row px-5 py-3 gap-2">
          {(["week", "month", "year"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-lg items-center ${period === p ? "bg-primary" : "bg-surface"}`}
            >
              <Text className={`font-medium ${period === p ? "text-background" : "text-foreground"}`}>
                {periodLabels[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* KPI Cards */}
        <View className="px-5 py-3">
          <View className="flex-row gap-3 mb-3">
            {/* Total Sales Card */}
            <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="attach-money" size={20} color={colors.primary} />
                <Text className="text-sm text-muted ml-1">Total Sales</Text>
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text className="text-xl font-bold text-foreground">
                  {formatCurrency(summary?.totalSales || 0)}
                </Text>
              )}
            </View>

            {/* Orders Card */}
            <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="shopping-cart" size={20} color={colors.primary} />
                <Text className="text-sm text-muted ml-1">Orders</Text>
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text className="text-xl font-bold text-foreground">
                  {summary?.orderCount || 0}
                </Text>
              )}
            </View>
          </View>

          <View className="flex-row gap-3">
            {/* Avg Order Value Card */}
            <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="trending-up" size={20} color={colors.success} />
                <Text className="text-sm text-muted ml-1">Avg Order</Text>
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text className="text-xl font-bold text-foreground">
                  {formatCurrency(summary?.avgOrderValue || 0)}
                </Text>
              )}
            </View>

            {/* Target Progress Card */}
            <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
              <View className="flex-row items-center mb-2">
                <MaterialIcons name="star" size={20} color={colors.warning} />
                <Text className="text-sm text-muted ml-1">Target</Text>
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Text className="text-xl font-bold text-foreground">
                    {(summary?.targetProgress || 0).toFixed(0)}%
                  </Text>
                  {/* Progress Bar */}
                  <View className="h-1.5 bg-border rounded-full mt-2 overflow-hidden">
                    <View
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(summary?.targetProgress || 0, 100)}%` }}
                    />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Recent Sales Section */}
        <View className="px-5 py-3">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-lg font-semibold text-foreground">Recent Sales</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/online-sales")}>
              <Text className="text-primary font-medium">View All</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View className="py-8 items-center">
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : recentSales && recentSales.length > 0 ? (
            <View className="bg-surface rounded-2xl border border-border overflow-hidden">
              {recentSales.map((sale, index) => (
                <View
                  key={sale.id}
                  className={`p-4 flex-row justify-between items-center ${
                    index < recentSales.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="flex-1">
                    <Text className="font-medium text-foreground" numberOfLines={1}>
                      {sale.productName}
                    </Text>
                    <Text className="text-sm text-muted">
                      {new Date(sale.saleDate).toLocaleDateString("en-HK", {
                        month: "short",
                        day: "numeric",
                      })}
                      {sale.customerName ? ` • ${sale.customerName}` : ""}
                    </Text>
                  </View>
                  <Text className="font-semibold text-foreground">
                    {formatCurrency(parseFloat(sale.totalAmount))}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View className="bg-surface rounded-2xl border border-border p-8 items-center">
              <MaterialIcons name="receipt-long" size={48} color={colors.muted} />
              <Text className="text-muted mt-2 text-center">No sales recorded yet</Text>
              <Text className="text-sm text-muted text-center mt-1">
                Sales data will appear here once imported
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
