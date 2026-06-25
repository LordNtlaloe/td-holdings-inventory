import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

// --- Helpers ---

async function getQuantityForProduct(ctx: any, storeId: any, productId: any) {
    const batches = await ctx.db
        .query("batches")
        .withIndex("by_store_and_product", (q: any) =>
            q.eq("storeId", storeId).eq("productId", productId)
        )
        .collect();

    return batches.reduce((sum: number, b: any) => sum + b.quantity, 0);
}

async function getInventoryRow(ctx: any, storeId: any, productId: any) {
    return await ctx.db
        .query("inventory")
        .withIndex("by_store_and_product", (q: any) =>
            q.eq("storeId", storeId).eq("productId", productId)
        )
        .first();
}

// --- Queries ---

// Source of truth: the `inventory` table. A product only appears here once
// it has been explicitly assigned to the store, even if quantity is 0.
export const getInventoryByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const inventoryRows = await ctx.db
            .query("inventory")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const results = await Promise.all(
            inventoryRows.map(async (row) => {
                const [product, quantity] = await Promise.all([
                    ctx.db.get(row.productId),
                    getQuantityForProduct(ctx, args.storeId, row.productId),
                ]);
                return {
                    inventoryId: row._id,
                    productId: row.productId,
                    product: product || null,
                    quantity,
                    reorderLevel: row.reorderLevel,
                };
            })
        );

        return results.filter((r) => r.product !== null);
    },
});

// Active products NOT yet assigned to this store — feeds the "Assign Product" picker.
export const getUnassignedProducts = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const [allProducts, inventoryRows] = await Promise.all([
            ctx.db.query("products").collect(),
            ctx.db
                .query("inventory")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
                .collect(),
        ]);

        const assignedIds = new Set(inventoryRows.map((r) => r.productId.toString()));

        return allProducts.filter(
            (p) => p.isActive && !assignedIds.has(p._id.toString())
        );
    },
});

export const getInventoryByProduct = query({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const batches = await ctx.db
            .query("batches")
            .withIndex("by_product", (q) => q.eq("productId", args.productId))
            .collect();

        const totalsByStore = new Map<string, number>();
        for (const batch of batches) {
            const key = batch.storeId.toString();
            totalsByStore.set(key, (totalsByStore.get(key) ?? 0) + batch.quantity);
        }

        const results = await Promise.all(
            Array.from(totalsByStore.entries()).map(async ([storeId, quantity]) => {
                const store = await ctx.db.get(storeId as any);
                return { storeId, store: store || null, quantity };
            })
        );

        return results.filter((r) => r.store !== null);
    },
});

export const getInventoryItem = query({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const reorderRow = await getInventoryRow(ctx, args.storeId, args.productId);
        const quantity = await getQuantityForProduct(ctx, args.storeId, args.productId);

        return {
            storeId: args.storeId,
            productId: args.productId,
            isAssigned: reorderRow !== null,
            quantity,
            reorderLevel: reorderRow?.reorderLevel,
        };
    },
});

export const getLowStock = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const reorderRows = await ctx.db
            .query("inventory")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const withQuantity = await Promise.all(
            reorderRows
                .filter((r) => r.reorderLevel !== undefined)
                .map(async (r) => {
                    const quantity = await getQuantityForProduct(ctx, args.storeId, r.productId);
                    return { ...r, quantity };
                })
        );

        const lowStock = withQuantity.filter(
            (r) => r.quantity <= (r.reorderLevel as number)
        );

        const withProduct = await Promise.all(
            lowStock.map(async (item) => {
                const product = await ctx.db.get(item.productId);
                return { ...item, product: product || null };
            })
        );

        return withProduct.filter((item) => item.product !== null);
    },
});

// --- Mutations ---

// Explicitly opt a product into a store's catalog. Starts at 0 quantity
// until batches/purchases bring stock in.
export const assignProductToStore = mutation({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
        reorderLevel: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.reorderLevel !== undefined && args.reorderLevel < 0) {
            throw new Error("Reorder level cannot be negative");
        }

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const existing = await getInventoryRow(ctx, args.storeId, args.productId);
        if (existing) throw new Error("Product is already assigned to this store");

        const inventoryId = await ctx.db.insert("inventory", {
            storeId: args.storeId,
            productId: args.productId,
            reorderLevel: args.reorderLevel,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "inventory.assign",
            entityType: "inventory",
            entityId: inventoryId.toString(),
            description: `Assigned "${product.name}" to ${store.name}${args.reorderLevel !== undefined ? ` with reorder level ${args.reorderLevel}` : ''}`,
        });

        return inventoryId;
    },
});

// Unassign a product from a store. Blocked while stock remains, so you can't
// silently lose track of batches that still belong to this store.
export const removeProductFromStore = mutation({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const existing = await getInventoryRow(ctx, args.storeId, args.productId);
        if (!existing) throw new Error("Product is not assigned to this store");

        const quantity = await getQuantityForProduct(ctx, args.storeId, args.productId);
        if (quantity > 0) {
            throw new Error(
                "Cannot unassign a product that still has stock at this store. Transfer or zero out stock first."
            );
        }

        const product = await ctx.db.get(args.productId);
        const store = await ctx.db.get(args.storeId);

        await ctx.db.delete(existing._id);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "inventory.remove",
            entityType: "inventory",
            entityId: existing._id.toString(),
            description: `Removed "${product?.name ?? args.productId}" from ${store?.name ?? args.storeId}`,
        });

        return true;
    },
});

// Updates reorder level on an existing assignment only. Assigning is a
// separate, explicit step via assignProductToStore.
export const setReorderLevel = mutation({
    args: {
        storeId: v.id("stores"),
        productId: v.id("products"),
        reorderLevel: v.number(),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.reorderLevel < 0) throw new Error("Reorder level cannot be negative");

        const existing = await getInventoryRow(ctx, args.storeId, args.productId);
        if (!existing) {
            throw new Error("Product is not assigned to this store yet. Assign it first.");
        }

        const previousLevel = existing.reorderLevel;

        await ctx.db.patch(existing._id, { reorderLevel: args.reorderLevel });

        const product = await ctx.db.get(args.productId);
        const store = await ctx.db.get(args.storeId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "inventory.reorder_level",
            entityType: "inventory",
            entityId: existing._id.toString(),
            description: `Set reorder level for "${product?.name ?? args.productId}" at ${store?.name ?? args.storeId} from ${previousLevel ?? "unset"} to ${args.reorderLevel}`,
        });

        return true;
    },
});