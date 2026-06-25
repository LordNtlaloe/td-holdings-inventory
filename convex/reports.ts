import { query } from "./_generated/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(ts: number) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function endOfDay(ts: number) {
    const d = new Date(ts);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES REPORTS
// ─────────────────────────────────────────────────────────────────────────────

/** Daily Sales Report – summary + per-store breakdown */
export const dailySalesReport = query({
    args: {
        storeId: v.optional(v.id("stores")),
        date: v.number(), // epoch ms for the target date
    },
    handler: async (ctx, { storeId, date }) => {
        const from = startOfDay(date);
        const to = endOfDay(date);

        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) {
            sales = sales.filter((s) => s.storeId === storeId);
        }

        const totalRevenue = sales.reduce((acc, s) => acc + s.totalAmount, 0);
        const totalSales = sales.length;
        const averageSale = totalSales > 0 ? totalRevenue / totalSales : 0;

        const storeMap = new Map<string, { revenue: number; count: number }>();
        for (const sale of sales) {
            const key = sale.storeId;
            const existing = storeMap.get(key) ?? { revenue: 0, count: 0 };
            storeMap.set(key, {
                revenue: existing.revenue + sale.totalAmount,
                count: existing.count + 1,
            });
        }

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        const byStore = Array.from(storeMap.entries()).map(([id, data]) => ({
            storeId: id,
            storeName: storeIndex[id] ?? "Unknown",
            revenue: data.revenue,
            count: data.count,
        }));

        return { totalRevenue, totalSales, averageSale, byStore };
    },
});

/** Sales By Product – quantity and revenue per product for a date range */
export const salesByProduct = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) sales = sales.filter((s) => s.storeId === storeId);

        const saleIds = new Set(sales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const items = allItems.filter((i) => saleIds.has(i.saleId));

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));

        const map = new Map<
            string,
            { productId: string; name: string; sku: string; quantity: number; revenue: number }
        >();

        for (const item of items) {
            const prod = productIndex[item.productId];
            if (!prod) continue;
            const key = item.productId;
            const existing = map.get(key) ?? {
                productId: key,
                name: prod.name,
                sku: prod.sku,
                quantity: 0,
                revenue: 0,
            };
            map.set(key, {
                ...existing,
                quantity: existing.quantity + item.quantity,
                revenue: existing.revenue + item.quantity * item.unitPrice,
            });
        }

        return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    },
});

/** Top Selling Products – top N by quantity sold */
export const topSellingProducts = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to, limit = 10 }) => {
        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) sales = sales.filter((s) => s.storeId === storeId);

        const saleIds = new Set(sales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const items = allItems.filter((i) => saleIds.has(i.saleId));

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));

        const map = new Map<string, { name: string; quantity: number; revenue: number }>();
        for (const item of items) {
            const prod = productIndex[item.productId];
            if (!prod) continue;
            const existing = map.get(item.productId) ?? { name: prod.name, quantity: 0, revenue: 0 };
            map.set(item.productId, {
                name: prod.name,
                quantity: existing.quantity + item.quantity,
                revenue: existing.revenue + item.quantity * item.unitPrice,
            });
        }

        return Array.from(map.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, limit);
    },
});

/** Slow Moving Products – below a quantity threshold */
export const slowMovingProducts = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
        threshold: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to, threshold = 5 }) => {
        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) sales = sales.filter((s) => s.storeId === storeId);

        const saleIds = new Set(sales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const items = allItems.filter((i) => saleIds.has(i.saleId));

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));

        const soldMap = new Map<string, number>();
        for (const item of items) {
            soldMap.set(item.productId, (soldMap.get(item.productId) ?? 0) + item.quantity);
        }

        return products
            .filter((p) => p.isActive)
            .map((p) => ({ name: p.name, sku: p.sku, quantity: soldMap.get(p._id) ?? 0 }))
            .filter((p) => p.quantity <= threshold)
            .sort((a, b) => a.quantity - b.quantity);
    },
});

/** Sales By Category */
export const salesByCategory = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) sales = sales.filter((s) => s.storeId === storeId);

        const saleIds = new Set(sales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const items = allItems.filter((i) => saleIds.has(i.saleId));

        const products = await ctx.db.query("products").collect();
        const categories = await ctx.db.query("categories").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const categoryIndex = Object.fromEntries(categories.map((c) => [c._id, c.name]));

        const map = new Map<string, { name: string; quantity: number; revenue: number }>();
        for (const item of items) {
            const prod = productIndex[item.productId];
            if (!prod) continue;
            const catName = categoryIndex[prod.categoryId] ?? "Uncategorized";
            const existing = map.get(prod.categoryId) ?? { name: catName, quantity: 0, revenue: 0 };
            map.set(prod.categoryId, {
                name: catName,
                quantity: existing.quantity + item.quantity,
                revenue: existing.revenue + item.quantity * item.unitPrice,
            });
        }

        return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    },
});

/** Sales By Department */
export const salesByDepartment = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let sales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), from),
                    q.lte(q.field("createdAt"), to),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();

        if (storeId) sales = sales.filter((s) => s.storeId === storeId);

        const saleIds = new Set(sales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const items = allItems.filter((i) => saleIds.has(i.saleId));

        const products = await ctx.db.query("products").collect();
        const departments = await ctx.db.query("departments").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const deptIndex = Object.fromEntries(departments.map((d) => [d._id, d.name]));

        const map = new Map<string, { name: string; quantity: number; revenue: number }>();
        for (const item of items) {
            const prod = productIndex[item.productId];
            if (!prod) continue;
            const deptName = deptIndex[prod.departmentId] ?? "Uncategorized";
            const existing = map.get(prod.departmentId) ?? { name: deptName, quantity: 0, revenue: 0 };
            map.set(prod.departmentId, {
                name: deptName,
                quantity: existing.quantity + item.quantity,
                revenue: existing.revenue + item.quantity * item.unitPrice,
            });
        }

        return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const topCustomers = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, { limit = 20 }) => {
        const customers = await ctx.db.query("customers").collect();
        return customers
            .filter((c) => c.isActive !== false)
            .sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0))
            .slice(0, limit)
            .map((c) => ({
                name: c.name,
                email: c.email,
                phone: c.phone,
                totalSpent: c.totalSpent ?? 0,
                visitCount: c.visitCount ?? 0,
                lastPurchaseAt: c.lastPurchaseAt,
                loyaltyPoints: c.loyaltyPoints ?? 0,
            }));
    },
});

export const inactiveCustomers = query({
    args: { days: v.optional(v.number()) },
    handler: async (ctx, { days = 90 }) => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const customers = await ctx.db.query("customers").collect();
        return customers
            .filter(
                (c) =>
                    c.isActive !== false &&
                    (c.lastPurchaseAt === undefined || c.lastPurchaseAt < cutoff)
            )
            .map((c) => ({
                name: c.name,
                email: c.email,
                phone: c.phone,
                totalSpent: c.totalSpent ?? 0,
                lastPurchaseAt: c.lastPurchaseAt,
                visitCount: c.visitCount ?? 0,
            }))
            .sort((a, b) => (a.lastPurchaseAt ?? 0) - (b.lastPurchaseAt ?? 0));
    },
});

export const customerVisitFrequency = query({
    args: {},
    handler: async (ctx) => {
        const customers = await ctx.db.query("customers").collect();
        const buckets: Record<string, number> = {
            "1 visit": 0,
            "2–5 visits": 0,
            "6–10 visits": 0,
            "11–20 visits": 0,
            "21+ visits": 0,
        };
        for (const c of customers) {
            const v = c.visitCount ?? 0;
            if (v === 1) buckets["1 visit"]++;
            else if (v <= 5) buckets["2–5 visits"]++;
            else if (v <= 10) buckets["6–10 visits"]++;
            else if (v <= 20) buckets["11–20 visits"]++;
            else buckets["21+ visits"]++;
        }
        return Object.entries(buckets).map(([label, count]) => ({ label, count }));
    },
});

export const customerPurchaseReport = query({
    args: {},
    handler: async (ctx) => {
        const customers = await ctx.db.query("customers").collect();
        return customers
            .filter((c) => c.isActive !== false)
            .map((c) => ({
                name: c.name,
                email: c.email,
                phone: c.phone,
                totalSpent: c.totalSpent ?? 0,
                visitCount: c.visitCount ?? 0,
                lastPurchaseAt: c.lastPurchaseAt,
                loyaltyPoints: c.loyaltyPoints ?? 0,
            }))
            .sort((a, b) => b.totalSpent - a.totalSpent);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const currentStockReport = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let inventories = await ctx.db.query("inventory").collect();
        if (storeId) inventories = inventories.filter((i) => i.storeId === storeId);

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));
        const allBatches = await ctx.db.query("batches").collect();

        return inventories.map((inv) => {
            const prod = productIndex[inv.productId];
            const batches = allBatches.filter(
                (b) => b.productId === inv.productId && b.storeId === inv.storeId
            );
            const quantity = batches.reduce((acc, b) => acc + b.quantity, 0);
            const value = batches.reduce((acc, b) => acc + b.quantity * b.costPrice, 0);

            return {
                storeName: storeIndex[inv.storeId] ?? "Unknown",
                productName: prod?.name ?? "Unknown",
                sku: prod?.sku ?? "",
                quantity,
                value,
                reorderLevel: inv.reorderLevel ?? 0,
                belowReorder: quantity <= (inv.reorderLevel ?? 0),
            };
        });
    },
});

export const stockValuation = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let batches = await ctx.db.query("batches").collect();
        if (storeId) batches = batches.filter((b) => b.storeId === storeId);

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        const map = new Map<string, number>();
        for (const b of batches) {
            map.set(b.storeId, (map.get(b.storeId) ?? 0) + b.quantity * b.costPrice);
        }

        const totalValue = Array.from(map.values()).reduce((a, b) => a + b, 0);

        const byStore = Array.from(map.entries()).map(([id, value]) => ({
            storeName: storeIndex[id] ?? "Unknown",
            value,
        }));

        return { totalValue, byStore };
    },
});

export const lowStockReport = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let inventories = await ctx.db.query("inventory").collect();
        if (storeId) inventories = inventories.filter((i) => i.storeId === storeId);

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));
        const allBatches = await ctx.db.query("batches").collect();

        return inventories
            .map((inv) => {
                const prod = productIndex[inv.productId];
                const batches = allBatches.filter(
                    (b) => b.productId === inv.productId && b.storeId === inv.storeId
                );
                const quantity = batches.reduce((acc, b) => acc + b.quantity, 0);
                return {
                    storeName: storeIndex[inv.storeId] ?? "Unknown",
                    productName: prod?.name ?? "Unknown",
                    sku: prod?.sku ?? "",
                    quantity,
                    reorderLevel: inv.reorderLevel ?? 0,
                };
            })
            .filter((r) => r.quantity <= r.reorderLevel)
            .sort((a, b) => a.quantity - b.quantity);
    },
});

export const outOfStockReport = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let inventories = await ctx.db.query("inventory").collect();
        if (storeId) inventories = inventories.filter((i) => i.storeId === storeId);

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));
        const allBatches = await ctx.db.query("batches").collect();

        return inventories
            .map((inv) => {
                const prod = productIndex[inv.productId];
                const batches = allBatches.filter(
                    (b) => b.productId === inv.productId && b.storeId === inv.storeId
                );
                const quantity = batches.reduce((acc, b) => acc + b.quantity, 0);
                return {
                    storeName: storeIndex[inv.storeId] ?? "Unknown",
                    productName: prod?.name ?? "Unknown",
                    sku: prod?.sku ?? "",
                    quantity,
                };
            })
            .filter((r) => r.quantity === 0);
    },
});

export const batchReport = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let batches = await ctx.db.query("batches").collect();
        if (storeId) batches = batches.filter((b) => b.storeId === storeId);

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return batches
            .map((b) => ({
                batchNumber: b.batchNumber,
                productName: productIndex[b.productId]?.name ?? "Unknown",
                sku: productIndex[b.productId]?.sku ?? "",
                storeName: storeIndex[b.storeId] ?? "Unknown",
                quantity: b.quantity,
                costPrice: b.costPrice,
                totalValue: b.quantity * b.costPrice,
                receivedAt: b.receivedAt,
            }))
            .sort((a, b) => b.receivedAt - a.receivedAt);
    },
});

export const inventoryByDepartment = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let batches = await ctx.db.query("batches").collect();
        if (storeId) batches = batches.filter((b) => b.storeId === storeId);

        const products = await ctx.db.query("products").collect();
        const departments = await ctx.db.query("departments").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const deptIndex = Object.fromEntries(departments.map((d) => [d._id, d.name]));

        const map = new Map<string, { name: string; quantity: number; value: number }>();
        for (const b of batches) {
            const prod = productIndex[b.productId];
            if (!prod) continue;
            const deptName = deptIndex[prod.departmentId] ?? "Uncategorized";
            const existing = map.get(prod.departmentId) ?? { name: deptName, quantity: 0, value: 0 };
            map.set(prod.departmentId, {
                name: deptName,
                quantity: existing.quantity + b.quantity,
                value: existing.value + b.quantity * b.costPrice,
            });
        }

        return Array.from(map.values()).sort((a, b) => b.value - a.value);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const purchaseReport = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let purchases = await ctx.db.query("purchases").collect();
        if (storeId) purchases = purchases.filter((p) => p.storeId === storeId);
        if (from) purchases = purchases.filter((p) => p.createdAt >= from);
        if (to) purchases = purchases.filter((p) => p.createdAt <= to);

        const suppliers = await ctx.db.query("suppliers").collect();
        const supplierIndex = Object.fromEntries(suppliers.map((s) => [s._id, s.name]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return purchases
            .map((p) => ({
                storeName: storeIndex[p.storeId] ?? "Unknown",
                supplierName: p.supplierId ? (supplierIndex[p.supplierId] ?? "Unknown") : "N/A",
                totalAmount: p.totalAmount,
                status: p.status,
                createdAt: p.createdAt,
            }))
            .sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const purchasesBySupplier = query({
    args: {},
    handler: async (ctx) => {
        const purchases = await ctx.db.query("purchases").collect();
        const suppliers = await ctx.db.query("suppliers").collect();
        const supplierIndex = Object.fromEntries(suppliers.map((s) => [s._id, s]));

        const map = new Map<string, { name: string; email?: string; phone?: string; total: number; count: number }>();
        for (const p of purchases) {
            if (!p.supplierId) continue;
            const sup = supplierIndex[p.supplierId];
            if (!sup) continue;
            const existing = map.get(p.supplierId) ?? {
                name: sup.name,
                email: sup.email,
                phone: sup.phone,
                total: 0,
                count: 0,
            };
            map.set(p.supplierId, {
                ...existing,
                total: existing.total + p.totalAmount,
                count: existing.count + 1,
            });
        }

        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    },
});

/** Supplier Purchase History – item level, optionally scoped to one supplier */
export const supplierPurchaseHistory = query({
    args: { supplierId: v.optional(v.id("suppliers")) },
    handler: async (ctx, { supplierId }) => {
        let purchases = await ctx.db.query("purchases").collect();
        if (supplierId) purchases = purchases.filter((p) => p.supplierId === supplierId);

        const purchaseIds = new Set(purchases.map((p) => p._id));
        const allItems = await ctx.db.query("purchaseItems").collect();
        const items = allItems.filter((i) => purchaseIds.has(i.purchaseId));

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const purchaseIndex = Object.fromEntries(purchases.map((p) => [p._id, p]));
        const suppliers = await ctx.db.query("suppliers").collect();
        const supplierIndex = Object.fromEntries(suppliers.map((s) => [s._id, s.name]));

        return items
            .map((i) => {
                const purchase = purchaseIndex[i.purchaseId];
                return {
                    supplierName: purchase?.supplierId ? (supplierIndex[purchase.supplierId] ?? "Unknown") : "N/A",
                    batchNumber: i.batchNumber,
                    productName: productIndex[i.productId]?.name ?? "Unknown",
                    sku: productIndex[i.productId]?.sku ?? "",
                    quantity: i.quantity,
                    costPrice: i.costPrice,
                    totalCost: i.quantity * i.costPrice,
                    purchaseDate: purchase?.createdAt,
                };
            })
            .sort((a, b) => (b.purchaseDate ?? 0) - (a.purchaseDate ?? 0));
    },
});

export const purchaseHistory = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let purchases = await ctx.db.query("purchases").collect();
        if (storeId) purchases = purchases.filter((p) => p.storeId === storeId);

        const purchaseIds = new Set(purchases.map((p) => p._id));
        const allItems = await ctx.db.query("purchaseItems").collect();
        const items = allItems.filter((i) => purchaseIds.has(i.purchaseId));

        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const purchaseIndex = Object.fromEntries(purchases.map((p) => [p._id, p]));

        return items
            .map((i) => ({
                batchNumber: i.batchNumber,
                productName: productIndex[i.productId]?.name ?? "Unknown",
                sku: productIndex[i.productId]?.sku ?? "",
                quantity: i.quantity,
                costPrice: i.costPrice,
                totalCost: i.quantity * i.costPrice,
                purchaseDate: purchaseIndex[i.purchaseId]?.createdAt,
            }))
            .sort((a, b) => (b.purchaseDate ?? 0) - (a.purchaseDate ?? 0));
    },
});

export const inventoryCostReport = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let purchases = await ctx.db.query("purchases").collect();
        if (storeId) purchases = purchases.filter((p) => p.storeId === storeId);

        const purchaseIds = new Set(purchases.map((p) => p._id));
        const allItems = await ctx.db.query("purchaseItems").collect();
        const items = allItems.filter((i) => purchaseIds.has(i.purchaseId));

        const totalCost = items.reduce((acc, i) => acc + i.quantity * i.costPrice, 0);
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        const byStore = new Map<string, number>();
        for (const p of purchases) {
            const items_ = items.filter((i) => i.purchaseId === p._id);
            const cost = items_.reduce((acc, i) => acc + i.quantity * i.costPrice, 0);
            byStore.set(p.storeId, (byStore.get(p.storeId) ?? 0) + cost);
        }

        return {
            totalCost,
            byStore: Array.from(byStore.entries()).map(([id, cost]) => ({
                storeName: storeIndex[id] ?? "Unknown",
                cost,
            })),
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const transferHistory = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let transfers = await ctx.db.query("transfers").collect();
        if (storeId) {
            transfers = transfers.filter(
                (t) => t.fromStoreId === storeId || t.toStoreId === storeId
            );
        }

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return transfers
            .map((t) => ({
                transferId: t._id,
                fromStore: storeIndex[t.fromStoreId] ?? "Unknown",
                toStore: storeIndex[t.toStoreId] ?? "Unknown",
                status: t.status,
                notes: t.notes,
                createdAt: t.createdAt,
                receivedAt: t.receivedAt,
            }))
            .sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const pendingTransfers = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let transfers = await ctx.db
            .query("transfers")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .collect();

        if (storeId) {
            transfers = transfers.filter(
                (t) => t.fromStoreId === storeId || t.toStoreId === storeId
            );
        }

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return transfers.map((t) => ({
            transferId: t._id,
            fromStore: storeIndex[t.fromStoreId] ?? "Unknown",
            toStore: storeIndex[t.toStoreId] ?? "Unknown",
            notes: t.notes,
            createdAt: t.createdAt,
        }));
    },
});

export const receivedTransfers = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let transfers = await ctx.db
            .query("transfers")
            .withIndex("by_status", (q) => q.eq("status", "received"))
            .collect();

        if (storeId) {
            transfers = transfers.filter(
                (t) => t.fromStoreId === storeId || t.toStoreId === storeId
            );
        }

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return transfers.map((t) => ({
            transferId: t._id,
            fromStore: storeIndex[t.fromStoreId] ?? "Unknown",
            toStore: storeIndex[t.toStoreId] ?? "Unknown",
            notes: t.notes,
            createdAt: t.createdAt,
            receivedAt: t.receivedAt,
        }));
    },
});

export const transferDiscrepancyReport = query({
    args: {},
    handler: async (ctx) => {
        const discrepancies = await ctx.db.query("transferDiscrepancies").collect();
        const allTransferItems = await ctx.db.query("transferItems").collect();
        const itemIndex = Object.fromEntries(allTransferItems.map((i) => [i._id, i]));
        const allTransfers = await ctx.db.query("transfers").collect();
        const transferIndex = Object.fromEntries(allTransfers.map((t) => [t._id, t]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));
        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));
        const users = await ctx.db.query("users").collect();
        const userIndex = Object.fromEntries(users.map((u) => [u._id, u.name]));

        return discrepancies
            .map((d) => {
                const item = itemIndex[d.transferItemId];
                const transfer = item ? transferIndex[item.transferId] : undefined;
                return {
                    productName: item ? (productIndex[item.productId]?.name ?? "Unknown") : "Unknown",
                    fromStore: transfer ? (storeIndex[transfer.fromStoreId] ?? "Unknown") : "Unknown",
                    toStore: transfer ? (storeIndex[transfer.toStoreId] ?? "Unknown") : "Unknown",
                    expectedQty: d.expectedQty,
                    receivedQty: d.receivedQty,
                    difference: d.receivedQty - d.expectedQty,
                    reason: d.reason,
                    reportedBy: userIndex[d.reportedBy] ?? "Unknown",
                    reportedAt: d.reportedAt,
                };
            })
            .sort((a, b) => b.reportedAt - a.reportedAt);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// FINANCIAL REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const incomeReport = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let entries = await ctx.db
            .query("ledgerEntries")
            .withIndex("by_type", (q) => q.eq("type", "income"))
            .collect();

        if (storeId) entries = entries.filter((e) => e.storeId === storeId);
        if (from) entries = entries.filter((e) => e.date >= from);
        if (to) entries = entries.filter((e) => e.date <= to);

        const total = entries.reduce((acc, e) => acc + e.amount, 0);

        const byCategory = new Map<string, number>();
        for (const e of entries) {
            byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
        }

        return {
            total,
            entries: entries.sort((a, b) => b.date - a.date),
            byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({
                category,
                amount,
            })),
        };
    },
});

export const expenseReport = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let entries = await ctx.db
            .query("ledgerEntries")
            .withIndex("by_type", (q) => q.eq("type", "expense"))
            .collect();

        if (storeId) entries = entries.filter((e) => e.storeId === storeId);
        if (from) entries = entries.filter((e) => e.date >= from);
        if (to) entries = entries.filter((e) => e.date <= to);

        const total = entries.reduce((acc, e) => acc + e.amount, 0);

        const byCategory = new Map<string, number>();
        for (const e of entries) {
            byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
        }

        return {
            total,
            entries: entries.sort((a, b) => b.date - a.date),
            byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({
                category,
                amount,
            })),
        };
    },
});

export const profitAndLoss = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let entries = await ctx.db.query("ledgerEntries").collect();
        if (storeId) entries = entries.filter((e) => e.storeId === storeId);
        if (from) entries = entries.filter((e) => e.date >= from);
        if (to) entries = entries.filter((e) => e.date <= to);

        const income = entries.filter((e) => e.type === "income").reduce((acc, e) => acc + e.amount, 0);
        const expenses = entries.filter((e) => e.type === "expense").reduce((acc, e) => acc + e.amount, 0);
        const profit = income - expenses;

        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        const byStore = new Map<string, { income: number; expenses: number }>();
        for (const e of entries) {
            const existing = byStore.get(e.storeId) ?? { income: 0, expenses: 0 };
            if (e.type === "income") {
                byStore.set(e.storeId, { ...existing, income: existing.income + e.amount });
            } else {
                byStore.set(e.storeId, { ...existing, expenses: existing.expenses + e.amount });
            }
        }

        return {
            income,
            expenses,
            profit,
            byStore: Array.from(byStore.entries()).map(([id, data]) => ({
                storeName: storeIndex[id] ?? "Unknown",
                income: data.income,
                expenses: data.expenses,
                profit: data.income - data.expenses,
            })),
        };
    },
});

/** Cash Flow Report – money in vs money out, bucketed by day */
export const cashFlowReport = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.number(),
        to: v.number(),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let entries = await ctx.db.query("ledgerEntries").collect();
        entries = entries.filter((e) => e.date >= from && e.date <= to);
        if (storeId) entries = entries.filter((e) => e.storeId === storeId);

        const moneyIn = entries.filter((e) => e.type === "income").reduce((acc, e) => acc + e.amount, 0);
        const moneyOut = entries.filter((e) => e.type === "expense").reduce((acc, e) => acc + e.amount, 0);
        const net = moneyIn - moneyOut;

        const byDay = new Map<string, { in: number; out: number }>();
        for (const e of entries) {
            const key = new Date(startOfDay(e.date)).toISOString().slice(0, 10);
            const existing = byDay.get(key) ?? { in: 0, out: 0 };
            if (e.type === "income") existing.in += e.amount;
            else existing.out += e.amount;
            byDay.set(key, existing);
        }

        const timeline = Array.from(byDay.entries())
            .map(([date, data]) => ({ date, moneyIn: data.in, moneyOut: data.out, net: data.in - data.out }))
            .sort((a, b) => (a.date < b.date ? -1 : 1));

        return { moneyIn, moneyOut, net, timeline };
    },
});

export const expenseByCategory = query({
    args: {
        storeId: v.optional(v.id("stores")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
    },
    handler: async (ctx, { storeId, from, to }) => {
        let entries = await ctx.db
            .query("ledgerEntries")
            .withIndex("by_type", (q) => q.eq("type", "expense"))
            .collect();

        if (storeId) entries = entries.filter((e) => e.storeId === storeId);
        if (from) entries = entries.filter((e) => e.date >= from);
        if (to) entries = entries.filter((e) => e.date <= to);

        const map = new Map<string, number>();
        for (const e of entries) {
            map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
        }

        return Array.from(map.entries())
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const employeeList = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        let employees = await ctx.db.query("employees").collect();
        if (storeId) employees = employees.filter((e) => e.storeId === storeId);

        const users = await ctx.db.query("users").collect();
        const userIndex = Object.fromEntries(users.map((u) => [u._id, u]));
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        return employees.map((e) => {
            const user = userIndex[e.userId];
            return {
                name: user?.name ?? "Unknown",
                email: user?.email ?? "",
                role: e.role,
                storeName: storeIndex[e.storeId] ?? "Unknown",
                isActive: e.isActive,
                status: user?.status ?? "active",
            };
        });
    },
});

export const employeesByStore = query({
    args: {},
    handler: async (ctx) => {
        const employees = await ctx.db.query("employees").collect();
        const stores = await ctx.db.query("stores").collect();
        const storeIndex = Object.fromEntries(stores.map((s) => [s._id, s.name]));

        const map = new Map<string, number>();
        for (const e of employees) {
            if (e.isActive) {
                map.set(e.storeId, (map.get(e.storeId) ?? 0) + 1);
            }
        }

        return Array.from(map.entries()).map(([id, count]) => ({
            storeName: storeIndex[id] ?? "Unknown",
            count,
        }));
    },
});

export const employeesByRole = query({
    args: {},
    handler: async (ctx) => {
        const employees = await ctx.db.query("employees").filter((q) => q.eq(q.field("isActive"), true)).collect();

        const map = new Map<string, number>();
        for (const e of employees) {
            map.set(e.role, (map.get(e.role) ?? 0) + 1);
        }

        return Array.from(map.entries()).map(([role, count]) => ({ role, count }));
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY / AUDIT REPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const userActivityReport = query({
    args: {
        userId: v.optional(v.id("users")),
        from: v.optional(v.number()),
        to: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, { userId, from, to, limit = 100 }) => {
        let logs = await ctx.db.query("activityLogs").collect();
        if (userId) logs = logs.filter((l) => l.userId === userId);
        if (from) logs = logs.filter((l) => l.createdAt >= from);
        if (to) logs = logs.filter((l) => l.createdAt <= to);

        const users = await ctx.db.query("users").collect();
        const userIndex = Object.fromEntries(users.map((u) => [u._id, u.name]));

        return logs
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
            .map((l) => ({
                userName: userIndex[l.userId] ?? "Unknown",
                role: l.role,
                action: l.action,
                entityType: l.entityType,
                description: l.description,
                createdAt: l.createdAt,
            }));
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTIVE DASHBOARD KPIs
// ─────────────────────────────────────────────────────────────────────────────

export const executiveDashboard = query({
    args: { storeId: v.optional(v.id("stores")) },
    handler: async (ctx, { storeId }) => {
        const todayStart = startOfDay(Date.now());
        const todayEnd = endOfDay(Date.now());

        let salesToday = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(
                    q.gte(q.field("createdAt"), todayStart),
                    q.lte(q.field("createdAt"), todayEnd),
                    q.eq(q.field("status"), "completed")
                )
            )
            .collect();
        if (storeId) salesToday = salesToday.filter((s) => s.storeId === storeId);

        const revenueTodayAmt = salesToday.reduce((acc, s) => acc + s.totalAmount, 0);

        let ledger = await ctx.db.query("ledgerEntries").collect();
        if (storeId) ledger = ledger.filter((e) => e.storeId === storeId);
        const totalRevenue = ledger.filter((e) => e.type === "income").reduce((acc, e) => acc + e.amount, 0);
        const totalExpenses = ledger.filter((e) => e.type === "expense").reduce((acc, e) => acc + e.amount, 0);
        const profit = totalRevenue - totalExpenses;

        let batches = await ctx.db.query("batches").collect();
        if (storeId) batches = batches.filter((b) => b.storeId === storeId);
        const stockValue = batches.reduce((acc, b) => acc + b.quantity * b.costPrice, 0);

        const pendingTransfersList = await ctx.db
            .query("transfers")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .collect();

        let inventories = await ctx.db.query("inventory").collect();
        if (storeId) inventories = inventories.filter((i) => i.storeId === storeId);
        let lowStockCount = 0;
        for (const inv of inventories) {
            const qty = batches
                .filter((b) => b.productId === inv.productId && b.storeId === inv.storeId)
                .reduce((acc, b) => acc + b.quantity, 0);
            if (qty <= (inv.reorderLevel ?? 0)) lowStockCount++;
        }

        // Top product (by quantity) over the last 30 days
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        let recentSales = await ctx.db
            .query("sales")
            .filter((q) =>
                q.and(q.gte(q.field("createdAt"), thirtyDaysAgo), q.eq(q.field("status"), "completed"))
            )
            .collect();
        if (storeId) recentSales = recentSales.filter((s) => s.storeId === storeId);
        const recentSaleIds = new Set(recentSales.map((s) => s._id));
        const allItems = await ctx.db.query("saleItems").collect();
        const recentItems = allItems.filter((i) => recentSaleIds.has(i.saleId));
        const products = await ctx.db.query("products").collect();
        const productIndex = Object.fromEntries(products.map((p) => [p._id, p]));

        const productQtyMap = new Map<string, number>();
        for (const item of recentItems) {
            productQtyMap.set(item.productId, (productQtyMap.get(item.productId) ?? 0) + item.quantity);
        }
        let topProduct: { name: string; quantity: number } | null = null;
        for (const [productId, qty] of productQtyMap.entries()) {
            if (!topProduct || qty > topProduct.quantity) {
                topProduct = { name: productIndex[productId]?.name ?? "Unknown", quantity: qty };
            }
        }

        // Top customer (by totalSpent)
        const customers = await ctx.db.query("customers").collect();
        const topCustomerRecord = customers
            .filter((c) => c.isActive !== false)
            .sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0))[0];
        const topCustomer = topCustomerRecord
            ? { name: topCustomerRecord.name, totalSpent: topCustomerRecord.totalSpent ?? 0 }
            : null;

        return {
            salesToday: salesToday.length,
            revenueToday: revenueTodayAmt,
            totalRevenue,
            totalExpenses,
            profit,
            stockValue,
            pendingTransfers: pendingTransfersList.length,
            lowStockItems: lowStockCount,
            topProduct,
            topCustomer,
        };
    },
});

// Stores list for filter dropdowns
export const allStores = query({
    args: {},
    handler: async (ctx) => ctx.db.query("stores").collect(),
});