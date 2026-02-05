import { useState } from "react";
import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

type Period = "week" | "month" | "year";

export default function OnlineSalesScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [refreshing, setRefreshing] = useState(false);

  // Fetch sales data
  const { data: salesList, isLoading: listLoading, refetch: refetchList } = trpc.sales.list.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.sales.summary.useQuery(
    { period },
    { enabled: isAuthenticated }
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchList(), refetchSummary()]);
    setRefreshing(false);
  };

  const formatCurrency = (value: number | string) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return `HK$${num.toLocaleString("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString("en-HK", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const periodLabels: Record<Period, string> = {
    week: "This Week",
    month: "This Month",
    year: "This Year",
  };

  const isLoading = listLoading || summaryLoading;

  // Calculate total net sales
  const totalNetSales = salesList?.reduce((sum, sale) => sum + parseFloat(sale.totalAmount || "0"), 0) || 0;

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
          <Text className="text-2xl font-bold text-foreground">Online Sales</Text>
          <Text className="text-sm text-muted">Your online store transactions</Text>
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

        {/* Summary Card */}
        <View className="px-5 py-2">
          <View className="bg-primary/10 rounded-2xl border border-primary/30 p-4">
            <View className="flex-row justify-between items-center">
              <View>
                <Text className="text-sm text-muted">Total Net Sales</Text>
                <Text className="text-2xl font-bold text-primary">{formatCurrency(totalNetSales)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-sm text-muted">Orders</Text>
                <Text className="text-xl font-semibold text-foreground">{salesList?.length || 0}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Table Header */}
        <View className="px-5 pt-4 pb-2">
          <View className="bg-surface rounded-t-xl border border-border p-3">
            <View className="flex-row">
              <Text className="flex-1 text-xs font-semibold text-muted">Order Date</Text>
              <Text className="w-20 text-xs font-semibold text-muted text-center">Order</Text>
              <Text className="flex-1 text-xs font-semibold text-muted text-center">Channel</Text>
              <Text className="w-24 text-xs font-semibold text-muted text-right">Net Sales</Text>
            </View>
          </View>
        </View>

        {/* Transactions List */}
        <View className="px-5">
          {isLoading ? (
            <View className="py-12 items-center bg-surface border-x border-b border-border rounded-b-xl">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : salesList && salesList.length > 0 ? (
            <View className="bg-surface border-x border-b border-border rounded-b-xl overflow-hidden">
              {salesList.map((sale, index) => (
                <View
                  key={sale.id}
                  className={`p-3 ${index < salesList.length - 1 ? "border-b border-border" : ""}`}
                >
                  <View className="flex-row items-center">
                    {/* Order Date */}
                    <View className="flex-1">
                      <Text className="text-sm text-foreground">{formatDate(sale.saleDate)}</Text>
                    </View>
                    
                    {/* Order Name/Reference */}
                    <View className="w-20 items-center">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {sale.orderReference || "-"}
                      </Text>
                    </View>
                    
                    {/* Sales Channel */}
                    <View className="flex-1 items-center">
                      <Text className="text-xs text-muted" numberOfLines={1}>
                        {sale.productCategory || "Online Store"}
                      </Text>
                    </View>
                    
                    {/* Net Sales */}
                    <View className="w-24 items-end">
                      <Text className="text-sm font-semibold text-primary">
                        {formatCurrency(sale.totalAmount)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="bg-surface border-x border-b border-border rounded-b-xl p-8 items-center">
              <MaterialIcons name="receipt-long" size={48} color={colors.muted} />
              <Text className="text-muted mt-2 text-center">No transactions found</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
