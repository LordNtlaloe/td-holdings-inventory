import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";

// --- Queries ---

export const getLedgerEntriesByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        return await ctx.db
            .query("ledgerEntries")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();
    },
});

// Simple P&L: total income vs total expense in a date range, for one
// store or across all stores if storeId is omitted.
export const getProfitAndLoss = query({
    args: {
        storeId: v.optional(v.id("stores")),
        startDate: v.number(),
        endDate: v.number(),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const entries = args.storeId
            ? await ctx.db
                .query("ledgerEntries")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId!))
                .collect()
            : await ctx.db.query("ledgerEntries").collect();

        const inRange = entries.filter((e) => e.date >= args.startDate && e.date <= args.endDate);

        const income = inRange.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
        const expense = inRange.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);

        return {
            income,
            expense,
            net: income - expense,
            entryCount: inRange.length,
        };
    },
});

// --- Mutations ---

// For one-off entries not tied to a sale/purchase — rent, utilities,
// misc income, owner drawings, etc.
export const recordManualEntry = mutation({
    args: {
        storeId: v.id("stores"),
        type: v.union(v.literal("income"), v.literal("expense")),
        category: v.string(),
        amount: v.number(),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        if (args.amount <= 0) throw new Error("Amount must be greater than zero");

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        return await ctx.db.insert("ledgerEntries", {
            storeId: args.storeId,
            type: args.type,
            category: args.category,
            amount: args.amount,
            description: args.description,
            referenceType: "manual",
            date: Date.now(),
        });
    },
});

// Called from sales.ts after a sale completes — entirely optional hook,
// nothing breaks if this is never called.
export const recordSaleIncome = mutation({
    args: {
        storeId: v.id("stores"),
        saleId: v.id("sales"),
        amount: v.number(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("ledgerEntries", {
            storeId: args.storeId,
            type: "income",
            category: "Sales",
            amount: args.amount,
            referenceType: "sale",
            saleId: args.saleId,
            date: Date.now(),
        });
    },
});

// Called from purchases.ts after a purchase is received — same, optional.
export const recordPurchaseExpense = mutation({
    args: {
        storeId: v.id("stores"),
        purchaseId: v.id("purchases"),
        amount: v.number(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("ledgerEntries", {
            storeId: args.storeId,
            type: "expense",
            category: "Inventory Purchase",
            amount: args.amount,
            referenceType: "purchase",
            purchaseId: args.purchaseId,
            date: Date.now(),
        });
    },
});