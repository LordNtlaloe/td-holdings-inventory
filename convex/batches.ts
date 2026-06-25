import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

// --- Queries ---

export const getBatchesByStoreAndProduct = query({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const batches = await ctx.db
            .query("batches")
            .withIndex("by_store_and_product", (q) =>
                q.eq("storeId", args.storeId).eq("productId", args.productId)
            )
            .collect();

        // Oldest first — this is the FIFO consumption order.
        return batches.sort((a, b) => a.receivedAt - b.receivedAt);
    },
});

export const getBatchesByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        return await ctx.db
            .query("batches")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();
    },
});

export const getBatchesByProduct = query({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        return await ctx.db
            .query("batches")
            .withIndex("by_product", (q) => q.eq("productId", args.productId))
            .collect();
    },
});

export const getBatchById = query({
    args: { batchId: v.id("batches") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const batch = await ctx.db.get(args.batchId);
        if (!batch) throw new Error("Batch not found");

        const product = await ctx.db.get(batch.productId);
        const store = await ctx.db.get(batch.storeId);

        return {
            ...batch,
            product: product || null,
            store: store || null,
        };
    },
});

export const getStoreProductQuantity = query({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const batches = await ctx.db
            .query("batches")
            .withIndex("by_store_and_product", (q) =>
                q.eq("storeId", args.storeId).eq("productId", args.productId)
            )
            .collect();

        return batches.reduce((sum, b) => sum + b.quantity, 0);
    },
});

// --- Mutations: manual entry points ---

export const receiveBatch = mutation({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
        batchNumber: v.string(),
        quantity: v.number(),
        costPrice: v.number(),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.quantity <= 0) throw new Error("Quantity must be greater than zero");
        if (args.costPrice < 0) throw new Error("Cost price cannot be negative");

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        // Reject if this product already has a batch at this store within 7 days
        const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        const recentBatch = await ctx.db
            .query("batches")
            .withIndex("by_store_and_product", (q) =>
                q.eq("storeId", args.storeId).eq("productId", args.productId)
            )
            .filter((q) => q.gte(q.field("receivedAt"), Date.now() - ONE_WEEK_MS))
            .first();

        if (recentBatch) {
            const daysAgo = ((Date.now() - recentBatch.receivedAt) / (1000 * 60 * 60 * 24)).toFixed(1);
            throw new Error(
                `A batch for this product was received ${daysAgo} day(s) ago. Batches must be at least 7 days apart.`
            );
        }

        const batchId = await ctx.db.insert("batches", {
            storeId: args.storeId,
            productId: args.productId,
            batchNumber: args.batchNumber,
            quantity: args.quantity,
            costPrice: args.costPrice,
            receivedAt: Date.now(),
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "batch.receive",
            entityType: "batches",
            entityId: batchId.toString(),
            description: `Received batch "${args.batchNumber}" for ${product.name} at ${store.name} (qty: ${args.quantity}, cost: ${args.costPrice})`,
        });

        return batchId;
    },
});

export const adjustBatchQuantity = mutation({
    args: {
        batchId: v.id("batches"),
        newQuantity: v.number(),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.newQuantity < 0) throw new Error("Quantity cannot be negative");

        const batch = await ctx.db.get(args.batchId);
        if (!batch) throw new Error("Batch not found");

        const previousQuantity = batch.quantity;

        await ctx.db.patch(args.batchId, { quantity: args.newQuantity });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "batch.adjust",
            entityType: "batches",
            entityId: args.batchId.toString(),
            description: `Adjusted batch "${batch.batchNumber}" quantity from ${previousQuantity} to ${args.newQuantity}${args.reason ? ` — reason: ${args.reason}` : ""}`,
        });

        return true;
    },
});

export const deleteBatch = mutation({
    args: { batchId: v.id("batches") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const batch = await ctx.db.get(args.batchId);
        if (!batch) throw new Error("Batch not found");

        if (batch.quantity > 0) {
            throw new Error("Cannot delete a batch that still has stock — adjust quantity to 0 first");
        }

        const saleRef = await ctx.db
            .query("saleItemBatches")
            .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
            .first();
        if (saleRef) throw new Error("Cannot delete a batch referenced by sale history");

        const transferRef = await ctx.db
            .query("transferItemBatches")
            .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
            .first();
        if (transferRef) throw new Error("Cannot delete a batch referenced by transfer history");

        await ctx.db.delete(args.batchId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "batch.delete",
            entityType: "batches",
            entityId: args.batchId.toString(),
            description: `Deleted empty batch "${batch.batchNumber}"`,
        });

        return true;
    },
});

export const consumeFifoInternal = internalMutation({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
        quantity: v.number(),
    },
    handler: async (ctx, args) => {
        if (args.quantity <= 0) throw new Error("Quantity to consume must be greater than zero");

        const batches = await ctx.db
            .query("batches")
            .withIndex("by_store_and_product", (q) =>
                q.eq("storeId", args.storeId).eq("productId", args.productId)
            )
            .collect();

        batches.sort((a, b) => a.receivedAt - b.receivedAt);

        const totalAvailable = batches.reduce((sum, b) => sum + b.quantity, 0);
        if (totalAvailable < args.quantity) {
            throw new Error("Insufficient stock across all batches");
        }

        let remaining = args.quantity;
        const consumed: {
            batchId: typeof batches[number]["_id"];
            batchNumber: string;
            quantity: number;
            costPrice: number;
        }[] = [];

        for (const batch of batches) {
            if (remaining <= 0) break;
            if (batch.quantity <= 0) continue;

            const take = Math.min(batch.quantity, remaining);

            await ctx.db.patch(batch._id, { quantity: batch.quantity - take });

            consumed.push({
                batchId: batch._id,
                batchNumber: batch.batchNumber,
                quantity: take,
                costPrice: batch.costPrice,
            });

            remaining -= take;
        }

        return consumed;
    },
});

export const creditBatchInternal = internalMutation({
    args: {
        batchId: v.id("batches"),
        quantity: v.number(),
    },
    handler: async (ctx, args) => {
        if (args.quantity <= 0) throw new Error("Credit quantity must be greater than zero");

        const batch = await ctx.db.get(args.batchId);
        if (!batch) throw new Error("Batch not found — cannot credit stock back");

        await ctx.db.patch(args.batchId, { quantity: batch.quantity + args.quantity });
        return true;
    },
});