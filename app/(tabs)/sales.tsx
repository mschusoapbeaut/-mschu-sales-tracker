import { useState } from "react";
import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

type Period = "week" | "month" | "year";
type Tab = "breakdown" | "transactions";

export default function SalesScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [activeTab, setActiveTab] = useState<Tab>("breakdown");
  const [refreshing, setRefreshing] = useState(false);

  // Fetch sales data
  const { data: productBreakdown, isLoading: breakdownLoading, refetch: refetchBreakdown } = trpc.sales.productBreakdown.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const { data: salesList, isLoading: listLoading, refetch: refetchList } = trpc.sales.list.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const { data: trend, isLoading: trendLoading, refetch: refetchTrend } = trpc.sales.trend.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchBreakdown(), refetchList(), refetchTrend()]);
    setRefreshing(false);
  };

  const formatCurrency = (value: number | string) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return `HK$${num.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const periodLabels: Record<Period, string> = {
    week: "This Week",
    month: "This Month",
    year: "This Year",
  };

  const isLoading = breakdownLoading || listLoading || trendLoading;

  // Calculate total for percentage
  const totalSales = productBreakdown?.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0) || 0;

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
          <Text className="text-2xl font-bold text-foreground">Sales Details</Text>
          <Text className="text-sm text-muted">Detailed breakdown of your sales</Text>
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

        {/* Tab Selector */}
        <View className="flex-row px-5 py-2 gap-2">
          <TouchableOpacity
            onPress={() => setActiveTab("breakdown")}
            className={`flex-1 py-3 rounded-xl items-center border ${
              activeTab === "breakdown" ? "border-primary bg-primary/10" : "border-border bg-surface"
            }`}
          >
            <MaterialIcons
              name="pie-chart"
              size={20}
              color={activeTab === "breakdown" ? colors.primary : colors.muted}
            />
            <Text className={`mt-1 font-medium ${activeTab === "breakdown" ? "text-primary" : "text-muted"}`}>
              By Product
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab("transactions")}
            className={`flex-1 py-3 rounded-xl items-center border ${
              activeTab === "transactions" ? "border-primary bg-primary/10" : "border-border bg-surface"
            }`}
          >
            <MaterialIcons
              name="receipt-long"
              size={20}
              color={activeTab === "transactions" ? colors.primary : colors.muted}
            />
            <Text className={`mt-1 font-medium ${activeTab === "transactions" ? "text-primary" : "text-muted"}`}>
              Transactions
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="px-5 py-3">
          {isLoading ? (
            <View className="py-12 items-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : activeTab === "breakdown" ? (
            // Product Breakdown View
            productBreakdown && productBreakdown.length > 0 ? (
              <View className="bg-surface rounded-2xl border border-border overflow-hidden">
                {productBreakdown.map((item, index) => {
                  const amount = parseFloat(item.totalAmount || "0");
                  const percentage = totalSales > 0 ? (amount / totalSales) * 100 : 0;
                  
                  return (
                    <View
                      key={`${item.productName}-${index}`}
                      className={`p-4 ${index < productBreakdown.length - 1 ? "border-b border-border" : ""}`}
                    >
                      <View className="flex-row justify-between items-start mb-2">
                        <View className="flex-1 mr-3">
                          <Text className="font-medium text-foreground" numberOfLines={1}>
                            {item.productName}
                          </Text>
                          {item.productCategory && (
                            <Text className="text-sm text-muted">{item.productCategory}</Text>
                          )}
                        </View>
                        <View className="items-end">
                          <Text className="font-semibold text-foreground">{formatCurrency(amount)}</Text>
                          <Text className="text-sm text-muted">{item.totalQuantity} units</Text>
                        </View>
                      </View>
                      {/* Progress Bar */}
                      <View className="h-2 bg-border rounded-full overflow-hidden">
                        <View
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </View>
                      <Text className="text-xs text-muted mt-1">{percentage.toFixed(1)}% of total</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View className="bg-surface rounded-2xl border border-border p-8 items-center">
                <MaterialIcons name="pie-chart" size={48} color={colors.muted} />
                <Text className="text-muted mt-2 text-center">No product data available</Text>
              </View>
            )
          ) : (
            // Transactions View
            salesList && salesList.length > 0 ? (
              <View className="bg-surface rounded-2xl border border-border overflow-hidden">
                {salesList.map((sale, index) => (
                  <View
                    key={sale.id}
                    className={`p-4 ${index < salesList.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 mr-3">
                        <Text className="font-medium text-foreground" numberOfLines={1}>
                          {sale.productName}
                        </Text>
                        <Text className="text-sm text-muted">
                          {new Date(sale.saleDate).toLocaleDateString("en-HK", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                        {sale.customerName && (
                          <Text className="text-sm text-muted">Customer: {sale.customerName}</Text>
                        )}
                      </View>
                      <View className="items-end">
                        <Text className="font-semibold text-foreground">
                          {formatCurrency(sale.totalAmount)}
                        </Text>
                        <Text className="text-sm text-muted">Qty: {sale.quantity}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View className="bg-surface rounded-2xl border border-border p-8 items-center">
                <MaterialIcons name="receipt-long" size={48} color={colors.muted} />
                <Text className="text-muted mt-2 text-center">No transactions found</Text>
              </View>
            )
          )}
        </View>

        {/* Sales Trend Summary */}
        {trend && trend.length > 0 && (
          <View className="px-5 py-3">
            <Text className="text-lg font-semibold text-foreground mb-3">Daily Trend</Text>
            <View className="bg-surface rounded-2xl border border-border p-4">
              <View className="flex-row flex-wrap gap-2">
                {trend.slice(-7).map((day, index) => (
                  <View key={index} className="items-center flex-1 min-w-[40px]">
                    <Text className="text-xs text-muted">
                      {new Date(day.date).toLocaleDateString("en-HK", { weekday: "short" })}
                    </Text>
                    <Text className="text-sm font-medium text-foreground mt-1">
                      {formatCurrency(day.totalSales || "0")}
                    </Text>
                    <Text className="text-xs text-muted">{day.orderCount} orders</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
