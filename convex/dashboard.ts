import { query } from "./_generated/server";
import { requireRole } from "./utils";
import { Doc, Id } from "./_generated/dataModel";

type DayBucket = { date: string; revenue: number; salesCount: number };
type CustomerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

function dateKey(ts: number) {
    return new Date(ts).toISOString().slice(0, 10);
}

function buildDailySeries(sales: any[], days: number) {
    const buckets: Record<string, DayBucket> = {};
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
        const key = dateKey(now - i * 86400000);
        buckets[key] = { date: key, revenue: 0, salesCount: 0 };
    }
    for (const sale of sales) {
        if (sale.status !== "completed") continue;
        const key = dateKey(sale.createdAt);
        if (buckets[key]) {
            buckets[key].revenue += sale.totalAmount;
            buckets[key].salesCount += 1;
        }
    }
    return Object.values(buckets);
}

function startOfMonthTs() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function startOfWeekTs() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function getCustomerTier(spent: number): CustomerTier {
    if (spent >= 10000) return 'platinum';
    if (spent >= 5000) return 'gold';
    if (spent >= 1000) return 'silver';
    return 'bronze';
}

function daysUntil(date: number): number {
    const now = new Date();
    const target = new Date(date);
    const diff = target.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export const getDashboardData = query({
    args: {},
    handler: async (ctx) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        const isGlobal =
            currentUser.role === "super_admin" || currentUser.role === "admin";

        let storeId: Id<"stores"> | null = null;
        if (!isGlobal) {
            const employee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!employee) {
                return {
                    role: currentUser.role,
                    scope: "none" as const,
                    stats: {
                        totalRevenue: 0,
                        totalSales: 0,
                        lowStockCount: 0,
                        activeStores: 0,
                        avgTransactionValue: 0,
                        grossProfitMargin: 0,
                        stockTurnover: 0,
                    },
                    dailySeries: [],
                    topProducts: [],
                    lowStockItems: [],
                    recentSales: [],
                    storeBreakdown: [],
                    transfers: { pendingCount: 0, inTransitCount: 0, recent: [] },
                    activityFeed: [],
                    purchases: { totalThisMonth: 0, pendingCount: 0, recent: [] },
                    customers: {
                        total: 0,
                        newThisMonth: 0,
                        acquisitionRate: 0,
                        tierDistribution: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
                        topSpenders: [],
                        atRisk: [],
                        birthdaysThisWeek: [],
                    },
                    inventory: {
                        totalProducts: 0,
                        totalStockValue: 0,
                        lowStockCount: 0,
                        deadStockCount: 0,
                        expiringSoon: [],
                        stockCoverageDays: [],
                        turnoverByCategory: [],
                    },
                    financial: {
                        grossProfit: 0,
                        grossProfitMargin: 0,
                        netProfit: 0,
                        netProfitMargin: 0,
                        totalExpenses: 0,
                        cashFlow: [],
                        expenseBreakdown: [],
                    },
                    alerts: [],
                };
            }
            storeId = employee.storeId;
        }

        const allStores = await ctx.db.query("stores").collect();
        const stores = isGlobal
            ? allStores
            : allStores.filter((s) => s._id === storeId);

        const allSales = await ctx.db.query("sales").collect();
        const sales = isGlobal
            ? allSales
            : allSales.filter((s) => s.storeId === storeId);

        const completedSales = sales.filter((s) => s.status === "completed");
        const totalRevenue = completedSales.reduce((sum, s) => sum + s.totalAmount, 0);

        // Recent sales
        const sortedSales = [...sales]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10);
        const recentSales = await Promise.all(
            sortedSales.map(async (sale) => {
                const [store, customer] = await Promise.all([
                    ctx.db.get(sale.storeId),
                    sale.customerId ? ctx.db.get(sale.customerId) : null,
                ]);
                return {
                    _id: sale._id.toString(),
                    storeName: store?.name ?? "Unknown",
                    customerName: customer?.name ?? "Walk-in",
                    totalAmount: sale.totalAmount,
                    status: sale.status,
                    createdAt: sale.createdAt,
                };
            })
        );

        // Low stock
        const allInventory = await ctx.db.query("inventory").collect();
        const inventory = isGlobal
            ? allInventory
            : allInventory.filter((i) => i.storeId === storeId);
        const allBatches = await ctx.db.query("batches").collect();

        const lowStockItems: {
            productId: string;
            productName: string;
            storeName: string;
            storeId: string;
            quantity: number;
            reorderLevel: number;
            avgDailySales: number;
            daysUntilStockout: number;
        }[] = [];

        // Calculate avg daily sales per product
        const productSales: Record<string, { total: number; days: Set<string> }> = {};
        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        for (const sale of completedSales) {
            if (sale.createdAt < thirtyDaysAgo) continue;
            const saleItems = await ctx.db
                .query("saleItems")
                .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                .collect();
            for (const item of saleItems) {
                const key = item.productId.toString();
                if (!productSales[key]) {
                    productSales[key] = { total: 0, days: new Set() };
                }
                productSales[key].total += item.quantity;
                productSales[key].days.add(dateKey(sale.createdAt));
            }
        }

        for (const inv of inventory) {
            if (inv.reorderLevel === undefined) continue;
            const batches = allBatches.filter(
                (b) => b.storeId === inv.storeId && b.productId === inv.productId
            );
            const qty = batches.reduce((sum, b) => sum + b.quantity, 0);
            if (qty <= inv.reorderLevel * 1.5) {
                const [product, store] = await Promise.all([
                    ctx.db.get(inv.productId),
                    ctx.db.get(inv.storeId),
                ]);
                const salesData = productSales[inv.productId.toString()];
                const avgDailySales = salesData
                    ? salesData.total / Math.max(salesData.days.size, 1)
                    : 0;
                lowStockItems.push({
                    productId: inv.productId.toString(),
                    productName: product?.name ?? "Unknown",
                    storeName: store?.name ?? "Unknown",
                    storeId: inv.storeId.toString(),
                    quantity: qty,
                    reorderLevel: inv.reorderLevel,
                    avgDailySales,
                    daysUntilStockout: avgDailySales > 0 ? Math.floor(qty / avgDailySales) : 999,
                });
            }
        }

        // Top products
        const saleIdSet = new Set(completedSales.map((s) => s._id.toString()));
        const allSaleItems = await ctx.db.query("saleItems").collect();
        const relevantItems = allSaleItems.filter((it) =>
            saleIdSet.has(it.saleId.toString())
        );

        // Get products with category info
        const allProducts = await ctx.db.query("products").collect();
        const productMap = new Map(
            allProducts.map(p => [p._id.toString(), p])
        );

        const productTotals: Record<
            string,
            { name: string; revenue: number; quantity: number; categoryId?: Id<"categories"> }
        > = {};
        for (const item of relevantItems) {
            const key = item.productId.toString();
            if (!productTotals[key]) {
                const product = productMap.get(key);
                productTotals[key] = {
                    name: product?.name ?? "Unknown",
                    revenue: 0,
                    quantity: 0,
                    categoryId: product?.categoryId,
                };
            }
            productTotals[key].revenue += item.unitPrice * item.quantity;
            productTotals[key].quantity += item.quantity;
        }
        const topProducts = Object.values(productTotals)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        // Get category names for turnover
        const allCategories = await ctx.db.query("categories").collect();
        const categoryMap = new Map(
            allCategories.map(c => [c._id.toString(), c.name])
        );

        // Store breakdown
        const storeBreakdown = isGlobal
            ? stores.map((store) => {
                const storeSales = completedSales.filter(
                    (s) => s.storeId === store._id
                );
                const storeLowStock = lowStockItems.filter(
                    (item) => item.storeId === store._id.toString()
                ).length;
                return {
                    storeName: store.name,
                    revenue: storeSales.reduce((sum, s) => sum + s.totalAmount, 0),
                    salesCount: storeSales.length,
                    lowStockCount: storeLowStock,
                    avgTransaction: storeSales.length > 0
                        ? storeSales.reduce((sum, s) => sum + s.totalAmount, 0) / storeSales.length
                        : 0,
                };
            })
            : [];

        // ── Transfers ──────────────────────────────────────────────────────────────
        const allTransfers = await ctx.db.query("transfers").collect();
        const pendingCount = allTransfers.filter(
            (t) => t.status === "pending"
        ).length;
        const inTransitCount = allTransfers.filter(
            (t) => t.status === "in_transit"
        ).length;

        const recentTransferDocs = [...allTransfers]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5);

        const recentTransfers = await Promise.all(
            recentTransferDocs.map(async (t) => {
                const [from, to] = await Promise.all([
                    ctx.db.get(t.fromStoreId),
                    ctx.db.get(t.toStoreId),
                ]);
                return {
                    _id: t._id.toString(),
                    fromStore: from?.name ?? "Unknown",
                    toStore: to?.name ?? "Unknown",
                    status: t.status,
                    createdAt: t.createdAt,
                };
            })
        );

        // ── Activity feed ────────────────────────────────────────────────────────
        const allLogs = await ctx.db.query("activityLogs").collect();
        const recentLogs = [...allLogs]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10);

        const activityFeed = await Promise.all(
            recentLogs.map(async (log) => {
                const user = await ctx.db.get(log.userId);
                return {
                    _id: log._id.toString(),
                    userName: user?.name ?? "Unknown",
                    role: log.role,
                    action: log.action,
                    entityType: log.entityType ?? null,
                    description: log.description ?? null,
                    createdAt: log.createdAt,
                };
            })
        );

        // ── Purchases ────────────────────────────────────────────────────────────
        const allPurchases = await ctx.db.query("purchases").collect();
        const purchases = isGlobal
            ? allPurchases
            : allPurchases.filter((p) => p.storeId === storeId);

        const monthStart = startOfMonthTs();
        const totalPurchasesThisMonth = purchases
            .filter((p) => p.status === "received" && p.createdAt >= monthStart)
            .reduce((sum, p) => sum + p.totalAmount, 0);
        const pendingPurchasesCount = purchases.filter(
            (p) => p.status === "pending"
        ).length;

        const recentPurchaseDocs = [...purchases]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5);

        const recentPurchases = await Promise.all(
            recentPurchaseDocs.map(async (p) => {
                const [store, supplier] = await Promise.all([
                    ctx.db.get(p.storeId),
                    p.supplierId ? ctx.db.get(p.supplierId) : null,
                ]);
                return {
                    _id: p._id.toString(),
                    storeName: store?.name ?? "Unknown",
                    supplierName: supplier?.name ?? "Direct",
                    totalAmount: p.totalAmount,
                    status: p.status,
                    createdAt: p.createdAt,
                };
            })
        );

        // ── Customers Analytics ──────────────────────────────────────────────────
        const allCustomers = await ctx.db.query("customers").collect();
        const totalCustomers = allCustomers.length;
        const newThisMonth = allCustomers.filter(
            (c) => c.createdAt !== undefined && c.createdAt >= monthStart
        ).length;

        // Customer tier distribution
        const tierDistribution: Record<CustomerTier, number> = {
            bronze: 0,
            silver: 0,
            gold: 0,
            platinum: 0,
        };

        // At-risk customers
        const atRisk: Array<{
            id: Id<"customers">;
            name: string;
            lastPurchaseAt: number;
            daysSinceLastPurchase: number;
        }> = [];

        for (const customer of allCustomers) {
            const spent = customer.totalSpent ?? 0;
            const tier = getCustomerTier(spent);
            tierDistribution[tier]++;

            const daysSinceLast = customer.lastPurchaseAt
                ? Math.floor((Date.now() - customer.lastPurchaseAt) / (1000 * 60 * 60 * 24))
                : 999;
            if (daysSinceLast > 30 && daysSinceLast < 999) {
                atRisk.push({
                    id: customer._id,
                    name: customer.name,
                    lastPurchaseAt: customer.lastPurchaseAt ?? 0,
                    daysSinceLastPurchase: daysSinceLast,
                });
            }
        }

        const topSpenders = allCustomers
            .map(c => ({
                id: c._id,
                name: c.name,
                totalSpent: c.totalSpent ?? 0,
                loyaltyPoints: c.loyaltyPoints ?? 0,
                visitCount: c.visitCount ?? 0,
                tier: getCustomerTier(c.totalSpent ?? 0),
            }))
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, 5);

        // Note: Birthday field doesn't exist in schema, so birthdaysThisWeek is empty
        const birthdaysThisWeek: Array<{
            id: Id<"customers">;
            name: string;
            birthday: number;
            daysUntilBirthday: number;
        }> = [];

        // ── Inventory Analytics ──────────────────────────────────────────────────
        const totalProducts = allInventory.length;
        const totalStockValue = allInventory.reduce((sum, inv) => {
            const batches = allBatches.filter(
                (b) => b.storeId === inv.storeId && b.productId === inv.productId
            );
            const qty = batches.reduce((s, b) => s + b.quantity, 0);
            // Use costPrice from batches, not from inventory
            const avgCost = batches.length > 0
                ? batches.reduce((s, b) => s + b.costPrice, 0) / batches.length
                : 0;
            return sum + avgCost * qty;
        }, 0);

        // Dead stock (no sales in 90 days)
        const ninetyDaysAgo = Date.now() - 90 * 86400000;
        const deadStock = inventory.filter(inv => {
            const hasRecentSale = completedSales.some(sale => {
                if (sale.createdAt < ninetyDaysAgo) return false;
                return sale.storeId === inv.storeId;
            });
            return !hasRecentSale;
        });

        // Expiring soon - batches don't have expiryDate in schema
        const expiringSoon: Array<{
            productId: Id<"products">;
            productName: string;
            batchId: Id<"batches">;
            quantity: number;
            expiryDate: number;
            daysUntilExpiry: number;
        }> = [];

        // Stock coverage days
        const stockCoverageDays: Array<{
            productId: Id<"products">;
            productName: string;
            currentStock: number;
            avgDailySales: number;
            coverageDays: number;
        }> = [];

        for (const inv of inventory) {
            const batches = allBatches.filter(
                (b) => b.storeId === inv.storeId && b.productId === inv.productId
            );
            const currentStock = batches.reduce((s, b) => s + b.quantity, 0);
            const salesData = productSales[inv.productId.toString()];
            const avgDailySales = salesData
                ? salesData.total / Math.max(salesData.days.size, 1)
                : 0;
            if (avgDailySales > 0) {
                const product = await ctx.db.get(inv.productId);
                stockCoverageDays.push({
                    productId: inv.productId,
                    productName: product?.name ?? "Unknown",
                    currentStock,
                    avgDailySales,
                    coverageDays: Math.floor(currentStock / avgDailySales),
                });
            }
        }

        // Turnover by category
        const categoryTotals: Record<string, { revenue: number; quantity: number }> = {};
        for (const [productId, data] of Object.entries(productTotals)) {
            const categoryId = data.categoryId;
            const categoryName = categoryId ? categoryMap.get(categoryId.toString()) || "Uncategorized" : "Uncategorized";
            if (!categoryTotals[categoryName]) {
                categoryTotals[categoryName] = { revenue: 0, quantity: 0 };
            }
            categoryTotals[categoryName].revenue += data.revenue;
            categoryTotals[categoryName].quantity += data.quantity;
        }

        const turnoverByCategory = Object.entries(categoryTotals).map(([category, data]) => ({
            category,
            turnover: data.revenue / Math.max(data.quantity, 1),
        }));

        // ── Financial Analytics ──────────────────────────────────────────────────
        // Calculate COGS using batch cost prices
        let totalCOGS = 0;
        for (const sale of completedSales) {
            const saleItems = await ctx.db
                .query("saleItems")
                .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                .collect();
            for (const item of saleItems) {
                const batches = allBatches
                    .filter(b => b.productId === item.productId && b.storeId === sale.storeId);
                if (batches.length > 0) {
                    const costPrice = batches[0].costPrice || 0;
                    totalCOGS += costPrice * item.quantity;
                }
            }
        }

        const grossProfit = totalRevenue - totalCOGS;
        const grossProfitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        // Expenses from ledger entries
        const allLedgerEntries = await ctx.db.query("ledgerEntries").collect();
        const totalExpenses = allLedgerEntries
            .filter(e => e.type === "expense" && e.date >= monthStart)
            .reduce((sum, e) => sum + e.amount, 0);

        const netProfit = grossProfit - totalExpenses;
        const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        // Cash flow (last 14 days)
        const cashFlow: Array<{ date: string; inflow: number; outflow: number; balance: number }> = [];
        for (let i = 13; i >= 0; i--) {
            const date = dateKey(Date.now() - i * 86400000);
            const daySales = completedSales
                .filter(s => dateKey(s.createdAt) === date)
                .reduce((sum, s) => sum + s.totalAmount, 0);
            const dayPurchases = purchases
                .filter(p => dateKey(p.createdAt) === date && p.status === "received")
                .reduce((sum, p) => sum + p.totalAmount, 0);
            const dayExpenses = allLedgerEntries
                .filter(e => dateKey(e.date) === date && e.type === "expense")
                .reduce((sum, e) => sum + e.amount, 0);

            const inflow = daySales;
            const outflow = dayPurchases + dayExpenses;
            cashFlow.push({
                date,
                inflow,
                outflow,
                balance: inflow - outflow,
            });
        }

        // Expense breakdown
        const expenseCategories: Record<string, number> = {};
        for (const entry of allLedgerEntries) {
            if (entry.type !== "expense" || entry.date < monthStart) continue;
            const category = entry.category || "Other";
            expenseCategories[category] = (expenseCategories[category] || 0) + entry.amount;
        }

        const totalExpenseAmount = Object.values(expenseCategories).reduce((sum, v) => sum + v, 0);
        const expenseBreakdown = Object.entries(expenseCategories)
            .map(([category, amount]) => ({
                category,
                amount,
                percentage: totalExpenseAmount > 0 ? (amount / totalExpenseAmount) * 100 : 0,
            }))
            .sort((a, b) => b.amount - a.amount);

        // ── Operational Alerts ──────────────────────────────────────────────────
        const alerts: Array<{
            id: string;
            type: 'critical' | 'warning' | 'info';
            title: string;
            message: string;
            action?: string;
        }> = [];

        // Critical stock alerts
        const criticalStock = lowStockItems.filter(item => item.quantity === 0);
        if (criticalStock.length > 0) {
            alerts.push({
                id: 'critical-stock',
                type: 'critical',
                title: `🚨 ${criticalStock.length} items out of stock`,
                message: `Critical stockout detected. ${criticalStock.slice(0, 3).map(i => i.productName).join(', ')}${criticalStock.length > 3 ? ` and ${criticalStock.length - 3} more` : ''}`,
                action: 'view-low-stock',
            });
        }

        // Revenue decline alert
        const todayStr = dateKey(Date.now());
        const yesterdayStr = dateKey(Date.now() - 86400000);
        const todaySales = completedSales
            .filter(s => dateKey(s.createdAt) === todayStr)
            .reduce((sum, s) => sum + s.totalAmount, 0);
        const yesterdaySales = completedSales
            .filter(s => dateKey(s.createdAt) === yesterdayStr)
            .reduce((sum, s) => sum + s.totalAmount, 0);
        if (yesterdaySales > 0 && todaySales < yesterdaySales * 0.7) {
            alerts.push({
                id: 'revenue-drop',
                type: 'warning',
                title: `⚠️ Revenue down ${Math.round((1 - todaySales / yesterdaySales) * 100)}% from yesterday`,
                message: `Today's revenue: R${todaySales.toFixed(2)} vs yesterday: R${yesterdaySales.toFixed(2)}`,
                action: 'view-sales',
            });
        }

        // Pending transfers alert
        if (pendingCount > 0) {
            alerts.push({
                id: 'pending-transfers',
                type: 'warning',
                title: `📦 ${pendingCount} transfers pending approval`,
                message: `${pendingCount} store transfer${pendingCount > 1 ? 's' : ''} awaiting your approval`,
                action: 'view-transfers',
            });
        }

        // Customer at-risk alert
        const highRiskCustomers = atRisk.filter(c => c.daysSinceLastPurchase > 60);
        if (highRiskCustomers.length > 0) {
            alerts.push({
                id: 'at-risk-customers',
                type: 'info',
                title: `🔄 ${highRiskCustomers.length} customers at risk of churning`,
                message: `${highRiskCustomers.slice(0, 3).map(c => c.name).join(', ')}${highRiskCustomers.length > 3 ? ` and ${highRiskCustomers.length - 3} more` : ''} haven't visited in 60+ days`,
                action: 'view-customers',
            });
        }

        // Calculate average transaction value
        const avgTransactionValue = completedSales.length > 0
            ? totalRevenue / completedSales.length
            : 0;

        // Calculate stock turnover
        const avgInventoryValue = inventory.length > 0
            ? inventory.reduce((sum, inv) => {
                const batches = allBatches.filter(
                    (b) => b.storeId === inv.storeId && b.productId === inv.productId
                );
                const qty = batches.reduce((s, b) => s + b.quantity, 0);
                const avgCost = batches.length > 0
                    ? batches.reduce((s, b) => s + b.costPrice, 0) / batches.length
                    : 0;
                return sum + avgCost * qty;
            }, 0) / inventory.length
            : 0;

        const stockTurnover = avgInventoryValue > 0
            ? totalCOGS / avgInventoryValue
            : 0;

        return {
            role: currentUser.role,
            scope: (isGlobal ? "global" : "store") as "global" | "store",
            stats: {
                totalRevenue,
                totalSales: completedSales.length,
                lowStockCount: lowStockItems.length,
                activeStores: stores.filter((s) => s.isActive).length,
                avgTransactionValue,
                grossProfitMargin,
                stockTurnover,
            },
            dailySeries: buildDailySeries(sales, 14),
            topProducts,
            lowStockItems: lowStockItems.slice(0, 8),
            recentSales,
            storeBreakdown,
            transfers: {
                pendingCount,
                inTransitCount,
                recent: recentTransfers,
            },
            activityFeed,
            purchases: {
                totalThisMonth: totalPurchasesThisMonth,
                pendingCount: pendingPurchasesCount,
                recent: recentPurchases,
            },
            customers: {
                total: totalCustomers,
                newThisMonth,
                acquisitionRate: totalCustomers > 0 ? (newThisMonth / totalCustomers) * 100 : 0,
                tierDistribution,
                topSpenders,
                atRisk: atRisk.slice(0, 5),
                birthdaysThisWeek: birthdaysThisWeek.slice(0, 5),
            },
            inventory: {
                totalProducts,
                totalStockValue,
                lowStockCount: lowStockItems.length,
                deadStockCount: deadStock.length,
                expiringSoon: expiringSoon.slice(0, 5),
                stockCoverageDays: stockCoverageDays.slice(0, 5),
                turnoverByCategory,
            },
            financial: {
                grossProfit,
                grossProfitMargin,
                netProfit,
                netProfitMargin,
                totalExpenses,
                cashFlow: cashFlow.slice(0, 14),
                expenseBreakdown,
            },
            alerts,
        };
    },
});

