import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

// --- Helpers ---

async function joinTransferStores(ctx: any, transfer: any) {
    const [fromStore, toStore] = await Promise.all([
        ctx.db.get(transfer.fromStoreId),
        ctx.db.get(transfer.toStoreId),
    ]);

    return {
        ...transfer,
        fromStore: fromStore || null,
        toStore: toStore || null,
    };
}

async function getItemsForTransfer(ctx: any, transferId: any) {
    const items = await ctx.db
        .query("transferItems")
        .withIndex("by_transfer", (q: any) => q.eq("transferId", transferId))
        .collect();

    return await Promise.all(
        items.map(async (item: any) => {
            const product = await ctx.db.get(item.productId);
            return { ...item, product: product || null };
        })
    );
}

async function getAvailableQuantity(ctx: any, storeId: any, productId: any) {
    const batches = await ctx.db
        .query("batches")
        .withIndex("by_store_and_product", (q: any) =>
            q.eq("storeId", storeId).eq("productId", productId)
        )
        .collect();

    return batches.reduce((sum: number, b: any) => sum + b.quantity, 0);
}

// Restricts managers to transfers that involve their own store. Admins and
// super_admins are unrestricted.
async function assertManagerScope(
    ctx: any,
    currentUser: { role: string; _id: any },
    storeIds: any[]
) {
    if (currentUser.role !== "manager") return;

    const employee = await ctx.db
        .query("employees")
        .withIndex("by_user", (q: any) => q.eq("userId", currentUser._id))
        .first();

    if (!employee || !storeIds.includes(employee.storeId)) {
        throw new Error("Unauthorized: transfer does not involve your store");
    }
}

// --- Queries ---

// All transfers across every store. Admin-level overview.
export const getAllTransfers = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const transfers = await ctx.db.query("transfers").collect();

        const withStores = await Promise.all(
            transfers.map((transfer) => joinTransferStores(ctx, transfer))
        );

        return withStores.sort((a, b) => b.createdAt - a.createdAt);
    },
});

// Transfers where the given store is either the source or the destination,
// merged into one list. Convex can't OR across two indexed fields in a
// single query, so this runs two indexed scans and merges + dedupes the
// results before sorting. The caller can tell direction apart by comparing
// `fromStoreId`/`toStoreId` against the storeId they passed in.
export const getTransfersByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const [outgoing, incoming] = await Promise.all([
            ctx.db
                .query("transfers")
                .withIndex("by_from_store", (q) => q.eq("fromStoreId", args.storeId))
                .collect(),
            ctx.db
                .query("transfers")
                .withIndex("by_to_store", (q) => q.eq("toStoreId", args.storeId))
                .collect(),
        ]);

        const merged = new Map<string, (typeof outgoing)[number]>();
        for (const t of [...outgoing, ...incoming]) {
            merged.set(t._id.toString(), t);
        }

        const withStores = await Promise.all(
            Array.from(merged.values()).map((transfer) => joinTransferStores(ctx, transfer))
        );

        return withStores.sort((a, b) => b.createdAt - a.createdAt);
    },
});

// Transfers filtered by status, across all stores. Useful for e.g. an
// "in transit" or "pending approval" queue.
export const getTransfersByStatus = query({
    args: {
        status: v.union(
            v.literal("pending"),
            v.literal("in_transit"),
            v.literal("received"),
            v.literal("cancelled")
        ),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const transfers = await ctx.db
            .query("transfers")
            .withIndex("by_status", (q) => q.eq("status", args.status))
            .collect();

        const withStores = await Promise.all(
            transfers.map((transfer) => joinTransferStores(ctx, transfer))
        );

        return withStores.sort((a, b) => b.createdAt - a.createdAt);
    },
});

// Full detail for a single transfer: the transfer itself, joined store
// names, line items with joined product names, and any discrepancy
// reports filed against those items.
export const getTransferById = query({
    args: { transferId: v.id("transfers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const transfer = await ctx.db.get(args.transferId);
        if (!transfer) throw new Error("Transfer not found");

        const withStores = await joinTransferStores(ctx, transfer);
        const items = await getItemsForTransfer(ctx, args.transferId);

        const itemsWithDiscrepancies = await Promise.all(
            items.map(async (item) => {
                const discrepancy = await ctx.db
                    .query("transferDiscrepancies")
                    .withIndex("by_transfer_item", (q) => q.eq("transferItemId", item._id))
                    .first();

                return { ...item, discrepancy: discrepancy || null };
            })
        );

        return {
            ...withStores,
            items: itemsWithDiscrepancies,
        };
    },
});

// Batch-level audit trail for every item on a transfer: which source
// batches were drawn down to ship it, and which destination batches were
// created on receipt. Useful for tracing cost basis end-to-end.
export const getTransferItems = query({
    args: { transferId: v.id("transfers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const items = await getItemsForTransfer(ctx, args.transferId);

        const withDetails = await Promise.all(
            items.map(async (item) => {
                const batchLinks = await ctx.db
                    .query("transferItemBatches")
                    .withIndex("by_transfer_item", (q) => q.eq("transferItemId", item._id))
                    .collect();

                const sourceBatches = [];
                const destinationBatches = [];

                for (const link of batchLinks) {
                    const batch = await ctx.db.get(link.batchId);
                    const entry = {
                        batchId: link.batchId,
                        quantity: link.quantity,
                        batchNumber: batch?.batchNumber ?? null,
                        costPrice: batch?.costPrice ?? null,
                    };
                    if (link.side === "source") sourceBatches.push(entry);
                    else destinationBatches.push(entry);
                }

                const discrepancy = await ctx.db
                    .query("transferDiscrepancies")
                    .withIndex("by_transfer_item", (q) => q.eq("transferItemId", item._id))
                    .first();

                return {
                    ...item,
                    sourceBatches,
                    destinationBatches,
                    discrepancy: discrepancy || null,
                };
            })
        );

        return withDetails;
    },
});

// Pending transfers awaiting shipment from a given store — feeds an
// "Outgoing: needs shipping" widget at the source store.
export const getPendingOutgoingTransfers = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const transfers = await ctx.db
            .query("transfers")
            .withIndex("by_from_store", (q) => q.eq("fromStoreId", args.storeId))
            .filter((q) => q.eq(q.field("status"), "pending"))
            .collect();

        const withStores = await Promise.all(
            transfers.map((transfer) => joinTransferStores(ctx, transfer))
        );

        return withStores.sort((a, b) => a.createdAt - b.createdAt);
    },
});

// In-transit transfers awaiting receipt at a given store — feeds an
// "Incoming: needs receiving" widget at the destination store.
export const getInTransitIncomingTransfers = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const transfers = await ctx.db
            .query("transfers")
            .withIndex("by_to_store", (q) => q.eq("toStoreId", args.storeId))
            .filter((q) => q.eq(q.field("status"), "in_transit"))
            .collect();

        const withStores = await Promise.all(
            transfers.map((transfer) => joinTransferStores(ctx, transfer))
        );

        return withStores.sort((a, b) => a.createdAt - b.createdAt);
    },
});

// Daily counts of transfer lifecycle actions (create/ship/receive/cancel)
// over the last 7 days, for the activity chart on the transfers dashboard.
// Mirrors the shape used by departments.getDepartmentActivityStats — reads
// from the shared activityLogs table, scoped to entityType "transfers".
//
// ASSUMPTION: activityLogs rows have a `createdAt: number` timestamp field
// (matching the convention used elsewhere in this file when writing logs).
// If your activityLogs schema actually stores time differently (e.g. relies
// on `_creationTime`, or a field named `timestamp`), update the `gte` filter
// and the `new Date(log.createdAt)` line below to match.
export const getTransferActivityStats = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        const logs = await ctx.db
            .query("activityLogs")
            .filter((q) =>
                q.and(
                    q.eq(q.field("entityType"), "transfers"),
                    q.gte(q.field("createdAt"), sevenDaysAgo)
                )
            )
            .collect();

        const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const buckets = new Map<
            string,
            { Created: number; Shipped: number; Received: number; Cancelled: number }
        >();

        const days: { key: string; label: string }[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const key = d.toDateString();
            days.push({ key, label: dayLabels[d.getDay()] });
            buckets.set(key, { Created: 0, Shipped: 0, Received: 0, Cancelled: 0 });
        }

        for (const log of logs) {
            const key = new Date(log.createdAt).toDateString();
            const bucket = buckets.get(key);
            if (!bucket) continue;

            if (log.action === "transfer.create") bucket.Created++;
            else if (log.action === "transfer.ship") bucket.Shipped++;
            else if (log.action === "transfer.receive") bucket.Received++;
            else if (log.action === "transfer.cancel") bucket.Cancelled++;
        }

        return days.map(({ key, label }) => ({ label, ...buckets.get(key)! }));
    },
});

// --- Mutations ---

// Creates a transfer in "pending" status. Validates that the source store
// currently has enough stock for every line item, but does NOT move any
// stock yet — that only happens once the transfer is shipped via
// markTransferInTransit. A pending transfer is purely a request/intent.
export const createTransfer = mutation({
    args: {
        fromStoreId: v.id("stores"),
        toStoreId: v.id("stores"),
        notes: v.optional(v.string()),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantityRequested: v.number(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (args.fromStoreId === args.toStoreId) {
            throw new Error("Cannot transfer stock to the same store");
        }
        if (args.items.length === 0) {
            throw new Error("Transfer must include at least one item");
        }

        const fromStore = await ctx.db.get(args.fromStoreId);
        if (!fromStore) throw new Error("Source store not found");
        if (!fromStore.isActive) throw new Error("Source store is inactive");

        const toStore = await ctx.db.get(args.toStoreId);
        if (!toStore) throw new Error("Destination store not found");
        if (!toStore.isActive) throw new Error("Destination store is inactive");

        if (fromStore.type !== "central") {
            throw new Error("Transfers can only originate from a central store");
        }
        if (toStore.type !== "branch") {
            throw new Error("Transfers can only be sent to a branch store");
        }

        await assertManagerScope(ctx, currentUser, [args.fromStoreId, args.toStoreId]);

        for (const item of args.items) {
            if (item.quantityRequested <= 0) {
                throw new Error("Quantity requested must be greater than zero");
            }

            const product = await ctx.db.get(item.productId);
            if (!product) throw new Error("One or more products not found");

            const available = await getAvailableQuantity(ctx, args.fromStoreId, item.productId);
            if (available < item.quantityRequested) {
                throw new Error(
                    `Insufficient stock for "${product.name}" at source store: requested ${item.quantityRequested}, available ${available}`
                );
            }
        }

        const transferId = await ctx.db.insert("transfers", {
            fromStoreId: args.fromStoreId,
            toStoreId: args.toStoreId,
            status: "pending",
            notes: args.notes,
            createdAt: Date.now(),
        });

        for (const item of args.items) {
            await ctx.db.insert("transferItems", {
                transferId,
                productId: item.productId,
                quantityRequested: item.quantityRequested,
            });
        }

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "transfer.create",
            entityType: "transfers",
            entityId: transferId.toString(),
            description: `Created transfer from "${fromStore.name}" to "${toStore.name}" with ${args.items.length} item(s)`,
        });

        return transferId;
    },
});

// Ships a pending transfer: this is the moment stock actually leaves the
// source store. FIFO-consumes each item's requested quantity from the
// source store's batches and records the consumed breakdown as
// transferItemBatches (side: "source"). pending -> in_transit only.
export const markTransferInTransit = mutation({
    args: { transferId: v.id("transfers") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const transfer = await ctx.db.get(args.transferId);
        if (!transfer) throw new Error("Transfer not found");

        await assertManagerScope(ctx, currentUser, [transfer.fromStoreId, transfer.toStoreId]);

        if (transfer.status !== "pending") {
            throw new Error("Only pending transfers can be marked in transit");
        }

        const items = await ctx.db
            .query("transferItems")
            .withIndex("by_transfer", (q) => q.eq("transferId", args.transferId))
            .collect();

        if (items.length === 0) {
            throw new Error("Transfer has no items to ship");
        }

        for (const item of items) {
            const consumed = await ctx.runMutation(internal.batches.consumeFifoInternal, {
                storeId: transfer.fromStoreId,
                productId: item.productId,
                quantity: item.quantityRequested,
            });

            for (const piece of consumed) {
                await ctx.db.insert("transferItemBatches", {
                    transferItemId: item._id,
                    batchId: piece.batchId,
                    side: "source",
                    quantity: piece.quantity,
                });
            }
        }

        await ctx.db.patch(args.transferId, { status: "in_transit" });

        const fromStore = await ctx.db.get(transfer.fromStoreId);
        const toStore = await ctx.db.get(transfer.toStoreId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "transfer.ship",
            entityType: "transfers",
            entityId: args.transferId.toString(),
            description: `Shipped transfer from "${fromStore?.name ?? transfer.fromStoreId}" to "${toStore?.name ?? transfer.toStoreId}" — stock deducted from source`,
        });

        return true;
    },
});

// Receives an in-transit transfer at the destination store. Creates new
// destination batches preserving the original batchNumber/costPrice of the
// source batches each portion came from. in_transit -> received only.
//
// If quantityReceived differs from quantityRequested for any item, a
// reason is required and a transferDiscrepancies record is filed — this
// does not block the transfer from completing.
export const receiveTransfer = mutation({
    args: {
        transferId: v.id("transfers"),
        items: v.array(
            v.object({
                transferItemId: v.id("transferItems"),
                quantityReceived: v.number(),
                discrepancyReason: v.optional(v.string()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const transfer = await ctx.db.get(args.transferId);
        if (!transfer) throw new Error("Transfer not found");

        if (transfer.status !== "in_transit") {
            throw new Error("Only in-transit transfers can be received");
        }

        await assertManagerScope(ctx, currentUser, [transfer.toStoreId]);

        const allItems = await ctx.db
            .query("transferItems")
            .withIndex("by_transfer", (q) => q.eq("transferId", args.transferId))
            .collect();

        const itemMap = new Map(allItems.map((i) => [i._id.toString(), i]));

        if (args.items.length !== allItems.length) {
            throw new Error("All transfer items must be accounted for when receiving");
        }

        for (const received of args.items) {
            const transferItem = itemMap.get(received.transferItemId.toString());
            if (!transferItem) throw new Error("Transfer item not found on this transfer");

            if (received.quantityReceived < 0) {
                throw new Error("Quantity received cannot be negative");
            }
            if (received.quantityReceived > transferItem.quantityRequested) {
                throw new Error("Quantity received cannot exceed quantity requested");
            }
            if (
                received.quantityReceived !== transferItem.quantityRequested &&
                !received.discrepancyReason?.trim()
            ) {
                throw new Error(
                    "A reason is required when quantity received differs from quantity requested"
                );
            }
        }

        let discrepancyCount = 0;

        for (const received of args.items) {
            const transferItem = itemMap.get(received.transferItemId.toString())!;

            await ctx.db.patch(received.transferItemId, {
                quantityReceived: received.quantityReceived,
            });

            if (received.quantityReceived !== transferItem.quantityRequested) {
                await ctx.db.insert("transferDiscrepancies", {
                    transferItemId: received.transferItemId,
                    expectedQty: transferItem.quantityRequested,
                    receivedQty: received.quantityReceived,
                    reason: received.discrepancyReason!.trim(),
                    reportedBy: currentUser._id,
                    reportedAt: Date.now(),
                });
                discrepancyCount += 1;
            }

            if (received.quantityReceived <= 0) continue;

            // Distribute the received quantity across the same source
            // batches it was originally drawn from, in the same order,
            // preserving batchNumber/costPrice per portion. Any shortfall
            // (requested but not received) simply isn't created at the
            // destination — it stays deducted from the source and is
            // accounted for by the discrepancy record above.
            const sourceLinks = await ctx.db
                .query("transferItemBatches")
                .withIndex("by_transfer_item", (q) => q.eq("transferItemId", received.transferItemId))
                .collect();

            const sourceLinksOnly = sourceLinks.filter((l) => l.side === "source");

            let remainingToReceive = received.quantityReceived;

            for (const link of sourceLinksOnly) {
                if (remainingToReceive <= 0) break;

                const portion = Math.min(link.quantity, remainingToReceive);
                if (portion <= 0) continue;

                const sourceBatch = await ctx.db.get(link.batchId);
                if (!sourceBatch) continue;

                const newBatchId = await ctx.db.insert("batches", {
                    storeId: transfer.toStoreId,
                    productId: transferItem.productId,
                    batchNumber: sourceBatch.batchNumber,
                    quantity: portion,
                    costPrice: sourceBatch.costPrice,
                    receivedAt: Date.now(),
                });

                await ctx.db.insert("transferItemBatches", {
                    transferItemId: received.transferItemId,
                    batchId: newBatchId,
                    side: "destination",
                    quantity: portion,
                });

                remainingToReceive -= portion;
            }
        }

        await ctx.db.patch(args.transferId, {
            status: "received",
            receivedAt: Date.now(),
        });

        const fromStore = await ctx.db.get(transfer.fromStoreId);
        const toStore = await ctx.db.get(transfer.toStoreId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "transfer.receive",
            entityType: "transfers",
            entityId: args.transferId.toString(),
            description: `Received transfer from "${fromStore?.name ?? transfer.fromStoreId}" at "${toStore?.name ?? transfer.toStoreId}"${discrepancyCount > 0 ? ` — ${discrepancyCount} item(s) with discrepancies` : ''}`,
        });

        return true;
    },
});

// Cancels a transfer. From "pending", nothing was ever consumed, so this is
// a pure status flip. From "in_transit", stock already left the source, so
// it's credited back to the exact source batches it came from, using the
// recorded breakdown rather than a blanket adjustment. Cannot cancel a
// transfer that has already been received.
export const cancelTransfer = mutation({
    args: { transferId: v.id("transfers") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const transfer = await ctx.db.get(args.transferId);
        if (!transfer) throw new Error("Transfer not found");

        if (transfer.status !== "pending" && transfer.status !== "in_transit") {
            throw new Error("Only pending or in-transit transfers can be cancelled");
        }

        await assertManagerScope(ctx, currentUser, [transfer.fromStoreId, transfer.toStoreId]);

        const wasInTransit = transfer.status === "in_transit";

        if (wasInTransit) {
            const items = await ctx.db
                .query("transferItems")
                .withIndex("by_transfer", (q) => q.eq("transferId", args.transferId))
                .collect();

            for (const item of items) {
                const sourceLinks = await ctx.db
                    .query("transferItemBatches")
                    .withIndex("by_transfer_item", (q) => q.eq("transferItemId", item._id))
                    .collect();

                for (const link of sourceLinks) {
                    if (link.side !== "source") continue;

                    await ctx.runMutation(internal.batches.creditBatchInternal, {
                        batchId: link.batchId,
                        quantity: link.quantity,
                    });
                }
            }
        }

        await ctx.db.patch(args.transferId, { status: "cancelled" });

        const fromStore = await ctx.db.get(transfer.fromStoreId);
        const toStore = await ctx.db.get(transfer.toStoreId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "transfer.cancel",
            entityType: "transfers",
            entityId: args.transferId.toString(),
            description: `Cancelled transfer from "${fromStore?.name ?? transfer.fromStoreId}" to "${toStore?.name ?? transfer.toStoreId}"${wasInTransit ? ' — stock credited back to source' : ''}`,
        });

        return true;
    },
});