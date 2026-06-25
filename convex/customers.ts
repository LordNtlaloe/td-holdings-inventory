// convex/customers.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";

export const getAllCustomers = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        return await ctx.db.query("customers").collect();
    },
});

export const getCustomerById = query({
    args: { customerId: v.id("customers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const customer = await ctx.db.get(args.customerId);
        if (!customer) throw new Error("Customer not found");

        return customer;
    },
});

// NEW: Get customer with full sales history and patterns
export const getCustomerWithSalesHistory = query({
    args: { customerId: v.id("customers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const customer = await ctx.db.get(args.customerId);
        if (!customer) throw new Error("Customer not found");

        // Get all sales for this customer
        const sales = await ctx.db
            .query("sales")
            .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
            .collect();

        // Sort sales by date (newest first)
        const sortedSales = sales.sort((a, b) => b.createdAt - a.createdAt);

        // Get store details for each sale
        const salesWithStore = await Promise.all(
            sortedSales.map(async (sale) => {
                const store = await ctx.db.get(sale.storeId);
                return {
                    ...sale,
                    storeName: store?.name || 'Unknown Store',
                };
            })
        );

        // Get items for each sale
        const salesWithItems = await Promise.all(
            salesWithStore.map(async (sale) => {
                const items = await ctx.db
                    .query("saleItems")
                    .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                    .collect();

                // Get product details for each item
                const itemsWithProducts = await Promise.all(
                    items.map(async (item) => {
                        const product = await ctx.db.get(item.productId);
                        return {
                            ...item,
                            productName: product?.name || 'Unknown Product',
                            productSku: product?.sku || 'Unknown SKU',
                        };
                    })
                );

                return {
                    ...sale,
                    items: itemsWithProducts,
                    itemCount: itemsWithProducts.reduce((sum, item) => sum + item.quantity, 0),
                };
            })
        );

        // Calculate customer insights
        const totalSpent = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
        const averageSpent = sales.length > 0 ? totalSpent / sales.length : 0;
        const lastPurchase = sales.length > 0 ? sales[0].createdAt : null;
        const firstPurchase = sales.length > 0 ? sales[sales.length - 1].createdAt : null;

        // Find most purchased product
        const productCounts: Record<string, { name: string; count: number; total: number }> = {};
        for (const sale of sales) {
            const items = await ctx.db
                .query("saleItems")
                .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                .collect();

            for (const item of items) {
                const product = await ctx.db.get(item.productId);
                if (!product) continue;

                if (!productCounts[item.productId]) {
                    productCounts[item.productId] = {
                        name: product.name,
                        count: 0,
                        total: 0,
                    };
                }
                productCounts[item.productId].count += item.quantity;
                productCounts[item.productId].total += item.quantity * item.unitPrice;
            }
        }

        // Get top products
        const topProducts = Object.values(productCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Calculate average days between purchases
        let avgDaysBetween = 0;
        if (sales.length > 1) {
            const sortedByDate = sales.sort((a, b) => a.createdAt - b.createdAt);
            let totalDays = 0;
            for (let i = 1; i < sortedByDate.length; i++) {
                const days = (sortedByDate[i].createdAt - sortedByDate[i - 1].createdAt) / (1000 * 60 * 60 * 24);
                totalDays += days;
            }
            avgDaysBetween = totalDays / (sortedByDate.length - 1);
        }

        return {
            ...customer,
            salesHistory: salesWithItems,
            insights: {
                totalSales: sales.length,
                totalSpent,
                averageSpent,
                lastPurchase,
                firstPurchase,
                averageDaysBetweenPurchases: avgDaysBetween,
                topProducts,
                isRepeatCustomer: sales.length > 1,
                customerSince: sales.length > 0 ? sales[sales.length - 1].createdAt : null,
            }
        };
    },
});

// NEW: Search customers with sales statistics
export const searchCustomersWithStats = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const customers = await ctx.db.query("customers").collect();
        const term = args.searchTerm.toLowerCase();

        const filtered = customers.filter(
            (customer) =>
                customer.name.toLowerCase().includes(term) ||
                customer.email?.toLowerCase().includes(term) ||
                customer.phone?.toLowerCase().includes(term)
        );

        // Get sales count and total spent for each customer
        const customersWithStats = await Promise.all(
            filtered.map(async (customer) => {
                const sales = await ctx.db
                    .query("sales")
                    .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
                    .collect();

                const totalSpent = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
                const lastPurchase = sales.length > 0 ? sales[0].createdAt : null;

                return {
                    ...customer,
                    salesCount: sales.length,
                    totalSpent,
                    lastPurchase,
                };
            })
        );

        // Sort by total spent (highest first)
        return customersWithStats.sort((a, b) => b.totalSpent - a.totalSpent);
    },
});

// NEW: Get top customers by spending
export const getTopCustomers = query({
    args: {
        limit: v.optional(v.number()),
        storeId: v.optional(v.id("stores")),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const limit = args.limit || 20;
        const customers = await ctx.db.query("customers").collect();

        const customersWithStats = await Promise.all(
            customers.map(async (customer) => {
                // Get sales for this customer
                let salesQuery = ctx.db
                    .query("sales")
                    .withIndex("by_customer", (q) => q.eq("customerId", customer._id));

                // If storeId is provided, filter by store
                if (args.storeId) {
                    // You might need to create a composite index for this
                    // For now, we'll filter after getting all sales
                }

                const sales = await salesQuery.collect();

                // Filter by store if provided
                const filteredSales = args.storeId
                    ? sales.filter(sale => sale.storeId === args.storeId)
                    : sales;

                const totalSpent = filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
                const salesCount = filteredSales.length;
                const lastPurchase = filteredSales.length > 0 ? filteredSales[0].createdAt : null;

                return {
                    ...customer,
                    totalSpent,
                    salesCount,
                    lastPurchase,
                };
            })
        );

        // Filter out customers with no sales and sort by total spent
        return customersWithStats
            .filter(c => c.salesCount > 0)
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, limit);
    },
});

export const searchCustomers = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const customers = await ctx.db.query("customers").collect();
        const term = args.searchTerm.toLowerCase();

        return customers.filter(
            (customer) =>
                customer.name.toLowerCase().includes(term) ||
                customer.email?.toLowerCase().includes(term) ||
                customer.phone?.toLowerCase().includes(term)
        );
    },
});

export const createCustomer = mutation({
    args: {
        name: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        if (args.email !== undefined) {
            const existing = await ctx.db.query("customers").collect();
            const duplicate = existing.find(
                (c) => c.email?.toLowerCase() === args.email!.toLowerCase()
            );
            if (duplicate) throw new Error("A customer with this email already exists");
        }

        const customerId = await ctx.db.insert("customers", {
            name: args.name,
            email: args.email,
            phone: args.phone,
        });

        return customerId;
    },
});

export const updateCustomer = mutation({
    args: {
        customerId: v.id("customers"),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const customer = await ctx.db.get(args.customerId);
        if (!customer) throw new Error("Customer not found");

        if (args.email !== undefined && args.email !== customer.email) {
            const existing = await ctx.db.query("customers").collect();
            const duplicate = existing.find(
                (c) =>
                    c._id !== args.customerId &&
                    c.email?.toLowerCase() === args.email!.toLowerCase()
            );
            if (duplicate) throw new Error("A customer with this email already exists");
        }

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.email !== undefined) updates.email = args.email;
        if (args.phone !== undefined) updates.phone = args.phone;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.customerId, updates);
        return true;
    },
});

export const deleteCustomer = mutation({
    args: { customerId: v.id("customers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const customer = await ctx.db.get(args.customerId);
        if (!customer) throw new Error("Customer not found");

        // Check if customer has any sales before deleting
        const sales = await ctx.db
            .query("sales")
            .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
            .collect();

        if (sales.length > 0) {
            // Option 1: Prevent deletion if customer has sales
            throw new Error(`Cannot delete customer with ${sales.length} sales history. Consider making them inactive instead.`);

            // Option 2: Or you could archive them instead of deleting
            // await ctx.db.patch(args.customerId, { isActive: false });
            // return true;
        }

        await ctx.db.delete(args.customerId);
        return true;
    },
});

// convex/customers.ts
// Add this query for real-time customer search

export const searchCustomersByTerm = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        if (!args.searchTerm || args.searchTerm.length < 2) {
            return [];
        }

        const customers = await ctx.db.query("customers").collect();
        const term = args.searchTerm.toLowerCase().trim();

        return customers
            .filter(
                (customer) =>
                    customer.name.toLowerCase().includes(term) ||
                    customer.email?.toLowerCase().includes(term) ||
                    customer.phone?.toLowerCase().includes(term)
            )
            .slice(0, 10); // Limit to 10 results
    },
});

// -----------------------------------------------
export const searchByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (!name.trim()) return []

    // Convex doesn't have full-text search on arbitrary fields without a search index,
    // so we fetch all and filter in memory. For a small customer list this is fine.
    // If your customer list grows large, add a search index on "name" in the schema.
    const all = await ctx.db.query("customers").collect()
    const q = name.trim().toLowerCase()
    return all
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8) // cap results shown in dropdown
  },
})

// -----------------------------------------------
// Find an existing customer by exact name,
// or create a new one. Returns the customer id.
// -----------------------------------------------
export const findOrCreateByName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Customer name cannot be empty")

    // Case-insensitive match
    const all = await ctx.db.query("customers").collect()
    const existing = all.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    )

    if (existing) return existing._id

    // Create new customer
    return await ctx.db.insert("customers", {
      name: trimmed,
      isActive: true,
      visitCount: 0,
      totalSpent: 0,
      createdAt: Date.now(),
    })
  },
})

// -----------------------------------------------
// Called after a sale completes — updates stats
// -----------------------------------------------
export const recordPurchase = mutation({
  args: {
    customerId: v.id("customers"),
    amount: v.number(),
  },
  handler: async (ctx, { customerId, amount }) => {
    const customer = await ctx.db.get(customerId)
    if (!customer) return

    await ctx.db.patch(customerId, {
      visitCount: (customer.visitCount ?? 0) + 1,
      totalSpent: (customer.totalSpent ?? 0) + amount,
      lastPurchaseAt: Date.now(),
    })
  },
})
