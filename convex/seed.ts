// convex/seed.ts
//
// Drop this file into your `convex/` directory. It exposes a single
// internal-but-publicly-callable mutation used ONLY for bulk seeding.
// Delete or restrict this file after seeding if you don't want it
// reachable in production.

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const insertSeedDataRaw = mutation({
    args: {
        inventory: v.array(
            v.object({
                storeId: v.id("stores"),
                productId: v.id("products"),
                reorderLevel: v.optional(v.number()),
            })
        ),
        batches: v.array(
            v.object({
                storeId: v.id("stores"),
                productId: v.id("products"),
                batchNumber: v.string(),
                quantity: v.number(),
                costPrice: v.number(),
                receivedAt: v.number(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const insertedInventoryIds = [];
        for (const inv of args.inventory) {
            // Avoid duplicate inventory rows for the same store+product pair
            const existing = await ctx.db
                .query("inventory")
                .withIndex("by_store_and_product", (q) =>
                    q.eq("storeId", inv.storeId).eq("productId", inv.productId)
                )
                .first();

            if (!existing) {
                const id = await ctx.db.insert("inventory", {
                    storeId: inv.storeId,
                    productId: inv.productId,
                    reorderLevel: inv.reorderLevel,
                });
                insertedInventoryIds.push(id);
            }
        }

        const insertedBatchIds = [];
        for (const b of args.batches) {
            const id = await ctx.db.insert("batches", {
                storeId: b.storeId,
                productId: b.productId,
                batchNumber: b.batchNumber,
                quantity: b.quantity,
                costPrice: b.costPrice,
                receivedAt: b.receivedAt,
            });
            insertedBatchIds.push(id);
        }

        return {
            inventoryInserted: insertedInventoryIds.length,
            batchesInserted: insertedBatchIds.length,
        };
    },
});