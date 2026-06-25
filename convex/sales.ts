import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// ===============================
// HELPERS
// ===============================

async function joinSaleDetails(ctx: any, sale: any) {
    const [store, customer] = await Promise.all([
        ctx.db.get(sale.storeId),
        sale.customerId ? ctx.db.get(sale.customerId) : null,
    ]);
    return { ...sale, store: store || null, customer: customer || null };
}

async function getItemsForSale(ctx: any, saleId: any) {
    const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q: any) => q.eq("saleId", saleId))
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

async function assertStoreScope(
    ctx: any,
    currentUser: { role: string; _id: any },
    storeId: any
) {
    if (currentUser.role === "super_admin" || currentUser.role === "admin") return;

    const employee = await ctx.db
        .query("employees")
        .withIndex("by_user", (q: any) => q.eq("userId", currentUser._id))
        .first();

    if (!employee || employee.storeId !== storeId) {
        throw new Error("Unauthorized: sale does not involve your store");
    }
}

const paymentMethodValidator = v.union(
    v.literal("Cash"),
    v.literal("POS"),
    v.literal("Mpesa"),
    v.literal("Ecocash"),
    v.literal("Bank Transfer"),
);

// ===============================
// TYRE DISCOUNT LOGIC
// ===============================

const TYRE_DISCOUNT_THRESHOLD = 4;
const TYRE_DISCOUNT_AMOUNT = 200;

function extractRimSize(sizeStr: string): number | null {
    // Handles: "14", "15", "195/65R15", "205/55R16", "31x10.50R15", etc.
    // Priority: explicit R-notation first, then trailing integer, then leading integer.
    const rimMatch =
        sizeStr.match(/[Rr](\d+)$/) ||
        sizeStr.match(/^(\d+)$/) ||
        sizeStr.match(/(\d+)$/);
    if (!rimMatch) return null;
    return parseInt(rimMatch[1], 10);
}

function isTyreDepartment(departmentName: string): boolean {
    return departmentName?.toLowerCase().includes("tyre") ?? false;
}

function qualifiesForTyreDiscount(size: string | undefined): boolean {
    if (!size) return false;
    const rim = extractRimSize(size);
    return rim !== null && rim >= 14;
}

// Returns a map of productId -> discount info for products that qualify:
// tyre department, size 14+ rim, 4+ units of the SAME product.
function computeTyreDiscounts(
    items: Array<{
        productId: string;
        size?: string;
        departmentName: string;
        quantity: number;
    }>
): Record<string, { discountAmount: number; reason?: string }> {
    const productQty: Record<string, number> = {};

    for (const item of items) {
        if (!isTyreDepartment(item.departmentName)) continue;
        if (!qualifiesForTyreDiscount(item.size)) continue;
        productQty[item.productId] = (productQty[item.productId] || 0) + item.quantity;
    }

    const result: Record<string, { discountAmount: number; reason?: string }> = {};
    for (const [productId, qty] of Object.entries(productQty)) {
        if (qty >= TYRE_DISCOUNT_THRESHOLD) {
            result[productId] = {
                discountAmount: TYRE_DISCOUNT_AMOUNT,
                reason: `Tyre bulk discount (${qty}x, size 14+)`,
            };
        }
    }
    return result;
}

// ===============================
// QUERIES
// ===============================

export const getAllSales = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin"]);
        const sales = await ctx.db.query("sales").collect();
        const withDetails = await Promise.all(sales.map((sale) => joinSaleDetails(ctx, sale)));
        return withDetails.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const getSalesByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        const sales = await ctx.db
            .query("sales")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();
        const withDetails = await Promise.all(sales.map((sale) => joinSaleDetails(ctx, sale)));
        return withDetails.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const getSaleById = query({
    args: { saleId: v.id("sales") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const sale = await ctx.db.get(args.saleId);
        if (!sale) throw new Error("Sale not found");

        const withDetails = await joinSaleDetails(ctx, sale);
        const items = await getItemsForSale(ctx, args.saleId);

        const itemsWithBatches = await Promise.all(
            items.map(async (item) => {
                const batchLinks = await ctx.db
                    .query("saleItemBatches")
                    .withIndex("by_sale_item", (q) => q.eq("saleItemId", item._id))
                    .collect();

                const batches = await Promise.all(
                    batchLinks.map(async (link: any) => {
                        const batch = await ctx.db.get(link.batchId as Id<"batches">);
                        return {
                            batchId: link.batchId,
                            quantity: link.quantity,
                            batchNumber: batch?.batchNumber ?? null,
                            costPrice: batch?.costPrice ?? null,
                        };
                    })
                );

                return { ...item, batches };
            })
        );

        const discounts = await ctx.db
            .query("saleDiscounts")
            .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
            .collect();

        return {
            ...withDetails,
            items: itemsWithBatches,
            discounts,
        };
    },
});

// ===============================
// MUTATIONS
// ===============================

export const createSale = mutation({
    args: {
        storeId: v.id("stores"),
        customerId: v.optional(v.id("customers")),
        paymentMethod: paymentMethodValidator,
        amountReceived: v.optional(v.number()),
        changeDue: v.optional(v.number()),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantity: v.number(),
                unitPrice: v.number(),
                size: v.optional(v.string()),
                color: v.optional(v.string()),
                variant: v.optional(v.string()),
                // Passed from the frontend cart so tyre discount logic
                // can run server-side without extra DB reads per item.
                departmentName: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin", "admin", "manager", "cashier",
        ]);

        if (args.items.length === 0) throw new Error("Sale must include at least one item");

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");
        if (!store.isActive) throw new Error("Store is inactive");

        await assertStoreScope(ctx, currentUser, args.storeId);

        if (args.customerId) {
            const customer = await ctx.db.get(args.customerId);
            if (!customer) throw new Error("Customer not found");
        }

        if (args.paymentMethod === "Cash") {
            if (args.amountReceived === undefined || args.amountReceived < 0) {
                throw new Error("Amount received is required for cash payments");
            }
        }

        // ── Validate items & compute gross total ──────────────────────────
        let grossTotal = 0;

        for (const item of args.items) {
            if (item.quantity <= 0) throw new Error("Quantity must be greater than zero");
            if (item.unitPrice < 0) throw new Error("Unit price cannot be negative");

            const product = await ctx.db.get(item.productId);
            if (!product) throw new Error("One or more products not found");
            if (!product.isActive) {
                throw new Error(`"${product.name}" is not currently active for sale`);
            }

            const available = await getAvailableQuantity(ctx, args.storeId, item.productId);
            if (available < item.quantity) {
                throw new Error(
                    `Insufficient stock for "${product.name}": requested ${item.quantity}, available ${available}`
                );
            }

            grossTotal += item.quantity * item.unitPrice;
        }

        // ── Compute tyre discounts (authoritative, server-side) ───────────
        const discountMap = computeTyreDiscounts(args.items);
        const discountTotal = Object.values(discountMap).reduce(
            (sum, d) => sum + d.discountAmount,
            0
        );
        const totalAmount = Math.max(0, grossTotal - discountTotal);

        if (args.paymentMethod === "Cash" && args.amountReceived! < totalAmount) {
            throw new Error(
                `Amount received (${args.amountReceived}) is less than total (${totalAmount})`
            );
        }

        // ── Insert sale ───────────────────────────────────────────────────
        const saleId = await ctx.db.insert("sales", {
            storeId: args.storeId,
            customerId: args.customerId,
            totalAmount,
            discountTotal: discountTotal > 0 ? discountTotal : undefined,
            status: "completed",
            paymentMethod: args.paymentMethod,
            amountReceived: args.amountReceived,
            changeDue: args.changeDue,
            createdAt: Date.now(),
        });

        // ── Insert discount records ───────────────────────────────────────
        for (const [productId, disc] of Object.entries(discountMap)) {
            await ctx.db.insert("saleDiscounts", {
                saleId,
                productId: productId as Id<"products">,
                discountAmount: disc.discountAmount,
                reason: disc.reason,
            });
        }

        // ── Insert sale items + FIFO batch consumption ────────────────────
        for (const item of args.items) {
            const saleItemId = await ctx.db.insert("saleItems", {
                saleId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
            });

            const consumed = await ctx.runMutation(internal.batches.consumeFifoInternal, {
                storeId: args.storeId,
                productId: item.productId,
                quantity: item.quantity,
            });

            for (const piece of consumed) {
                await ctx.db.insert("saleItemBatches", {
                    saleItemId,
                    batchId: piece.batchId,
                    quantity: piece.quantity,
                });
            }
        }

        // ── Ledger (net amount after discounts) ───────────────────────────
        await ctx.db.insert("ledgerEntries", {
            storeId: args.storeId,
            type: "income",
            category: "Sales",
            amount: totalAmount,
            description: `Sale of ${args.items.length} item(s) — ${args.paymentMethod}${discountTotal > 0 ? ` (discount: R${discountTotal.toFixed(2)})` : ""}`,
            referenceType: "sale",
            saleId,
            date: Date.now(),
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "sale.create",
            entityType: "sales",
            entityId: saleId.toString(),
            description: `Recorded sale of ${args.items.length} item(s) at "${store.name}" totaling ${totalAmount.toFixed(2)} (${args.paymentMethod})${discountTotal > 0 ? `, discount R${discountTotal.toFixed(2)}` : ""}`,
        });

        return saleId;
    },
});

export const refundSale = mutation({
    args: { saleId: v.id("sales") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sale = await ctx.db.get(args.saleId);
        if (!sale) throw new Error("Sale not found");
        if (sale.status !== "completed") throw new Error("Only completed sales can be refunded");

        await assertStoreScope(ctx, currentUser, sale.storeId);

        const items = await ctx.db
            .query("saleItems")
            .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
            .collect();

        for (const item of items) {
            const batchLinks = await ctx.db
                .query("saleItemBatches")
                .withIndex("by_sale_item", (q) => q.eq("saleItemId", item._id))
                .collect();

            for (const link of batchLinks) {
                await ctx.runMutation(internal.batches.creditBatchInternal, {
                    batchId: link.batchId,
                    quantity: link.quantity,
                });
            }
        }

        await ctx.db.patch(args.saleId, { status: "refunded" });

        const store = await ctx.db.get(sale.storeId);

        await ctx.db.insert("ledgerEntries", {
            storeId: sale.storeId,
            type: "expense",
            category: "Refund",
            amount: sale.totalAmount,
            description: `Refund of sale ${args.saleId.toString()}`,
            referenceType: "sale",
            saleId: args.saleId,
            date: Date.now(),
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "sale.refund",
            entityType: "sales",
            entityId: args.saleId.toString(),
            description: `Refunded sale at "${store?.name ?? sale.storeId}" — stock credited back to source batches`,
        });

        return true;
    },
});

export const voidSale = mutation({
    args: { saleId: v.id("sales") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sale = await ctx.db.get(args.saleId);
        if (!sale) throw new Error("Sale not found");
        if (sale.status !== "completed") throw new Error("Only completed sales can be voided");

        await assertStoreScope(ctx, currentUser, sale.storeId);

        const items = await ctx.db
            .query("saleItems")
            .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
            .collect();

        for (const item of items) {
            const batchLinks = await ctx.db
                .query("saleItemBatches")
                .withIndex("by_sale_item", (q) => q.eq("saleItemId", item._id))
                .collect();

            for (const link of batchLinks) {
                await ctx.runMutation(internal.batches.creditBatchInternal, {
                    batchId: link.batchId,
                    quantity: link.quantity,
                });
            }
        }

        await ctx.db.patch(args.saleId, { status: "voided" });

        const store = await ctx.db.get(sale.storeId);

        await ctx.db.insert("ledgerEntries", {
            storeId: sale.storeId,
            type: "expense",
            category: "Void",
            amount: sale.totalAmount,
            description: `Voided sale ${args.saleId.toString()}`,
            referenceType: "sale",
            saleId: args.saleId,
            date: Date.now(),
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "sale.void",
            entityType: "sales",
            entityId: args.saleId.toString(),
            description: `Voided sale at "${store?.name ?? sale.storeId}" — stock credited back to source batches`,
        });

        return true;
    },
});