import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";

// --- Queries ---

export const getPurchasesByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        return await ctx.db
            .query("purchases")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();
    },
});

export const getPurchasesBySupplier = query({
    args: { supplierId: v.id("suppliers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        return await ctx.db
            .query("purchases")
            .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
            .collect();
    },
});

export const getPurchaseById = query({
    args: { purchaseId: v.id("purchases") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const purchase = await ctx.db.get(args.purchaseId);
        if (!purchase) throw new Error("Purchase not found");

        const store = await ctx.db.get(purchase.storeId);
        const supplier = purchase.supplierId ? await ctx.db.get(purchase.supplierId) : null;

        return { ...purchase, store: store || null, supplier };
    },
});

export const getPurchaseItems = query({
    args: { purchaseId: v.id("purchases") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const items = await ctx.db
            .query("purchaseItems")
            .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
            .collect();

        const withProduct = await Promise.all(
            items.map(async (item) => {
                const product = await ctx.db.get(item.productId);
                return { ...item, product: product || null };
            })
        );

        return withProduct;
    },
});

// --- Helpers ---

async function assertManagerScope(ctx: any, currentUser: { role: string; _id: any }, storeId: any) {
    if (currentUser.role !== "manager") return;

    const employee = await ctx.db
        .query("employees")
        .withIndex("by_user", (q: any) => q.eq("userId", currentUser._id))
        .first();

    if (!employee || employee.storeId !== storeId) {
        throw new Error("Unauthorized: purchase does not belong to your store");
    }
}

// --- Mutations ---

// Creates a purchase order in "pending" state. No stock or batches are
// created yet — that only happens on receivePurchase. This lets you
// record an order placed with a supplier before the goods actually arrive.
export const createPurchase = mutation({
    args: {
        storeId: v.id("stores"),
        supplierId: v.optional(v.id("suppliers")),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantity: v.number(),
                costPrice: v.number(),
                batchNumber: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.items.length === 0) {
            throw new Error("Purchase must include at least one item");
        }

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");
        if (!store.isActive) throw new Error("Store is inactive");

        await assertManagerScope(ctx, currentUser, args.storeId);

        if (args.supplierId !== undefined) {
            const supplier = await ctx.db.get(args.supplierId);
            if (!supplier) throw new Error("Supplier not found");
        }

        let totalAmount = 0;

        for (const item of args.items) {
            if (item.quantity <= 0) throw new Error("Quantity must be greater than zero");
            if (item.costPrice < 0) throw new Error("Cost price cannot be negative");

            const product = await ctx.db.get(item.productId);
            if (!product) throw new Error("One or more products not found");

            totalAmount += item.costPrice * item.quantity;
        }

        const purchaseId = await ctx.db.insert("purchases", {
            storeId: args.storeId,
            supplierId: args.supplierId,
            totalAmount,
            status: "pending",
            createdAt: Date.now(),
        });

        for (const item of args.items) {
            await ctx.db.insert("purchaseItems", {
                purchaseId,
                productId: item.productId,
                quantity: item.quantity,
                costPrice: item.costPrice,
                batchNumber: item.batchNumber,
            });
        }

        return purchaseId;
    },
});

// Marks the purchase as received — this is the point where stock actually
// enters the store. One new batch is created per purchase item, and the
// resulting batchId is recorded back onto that purchaseItems row.
export const receivePurchase = mutation({
    args: { purchaseId: v.id("purchases") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const purchase = await ctx.db.get(args.purchaseId);
        if (!purchase) throw new Error("Purchase not found");

        if (purchase.status !== "pending") {
            throw new Error("Only pending purchases can be received");
        }

        await assertManagerScope(ctx, currentUser, purchase.storeId);

        const items = await ctx.db
            .query("purchaseItems")
            .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
            .collect();

        for (const item of items) {
            const batchId = await ctx.db.insert("batches", {
                storeId: purchase.storeId,
                productId: item.productId,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                costPrice: item.costPrice,
                receivedAt: Date.now(),
            });

            await ctx.db.patch(item._id, { batchId });
        }

        await ctx.db.patch(args.purchaseId, { status: "received" });
        return true;
    },
});

// Only valid while still pending — nothing has touched stock yet, so
// cancelling is a clean no-op on the inventory side.
export const cancelPurchase = mutation({
    args: { purchaseId: v.id("purchases") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const purchase = await ctx.db.get(args.purchaseId);
        if (!purchase) throw new Error("Purchase not found");

        if (purchase.status !== "pending") {
            throw new Error("Only pending purchases can be cancelled");
        }

        await assertManagerScope(ctx, currentUser, purchase.storeId);

        await ctx.db.patch(args.purchaseId, { status: "cancelled" });
        return true;
    },
});