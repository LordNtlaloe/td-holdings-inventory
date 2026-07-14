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

    // Get sale items with product details
    const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q: any) => q.eq("saleId", sale._id))
        .collect();

    // Get product details for each item
    const itemsWithDetails = await Promise.all(
        items.map(async (item: any) => {
            const product = await ctx.db.get(item.productId);
            let departmentName = null;
            let departmentId = null;
            if (product?.departmentId) {
                const dept = await ctx.db.get(product.departmentId);
                if (dept) {
                    departmentName = dept.name;
                    departmentId = dept._id;
                }
            }
            return {
                ...item,
                product: product || null,
                productName: product?.name || 'Unknown Product',
                departmentName,
                departmentId,
            };
        })
    );

    // Collect unique departments from sale items
    const departments = [...new Set(itemsWithDetails.map((item: any) => item.departmentName).filter(Boolean))] as string[];

    // Calculate total items count
    const itemCount = itemsWithDetails.reduce((sum: number, item: any) => sum + item.quantity, 0);

    return {
        ...sale,
        store: store || null,
        customer: customer || null,
        departments,
        items: itemsWithDetails,
        itemCount,
    };
}

async function getItemsForSale(ctx: any, saleId: any) {
    const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q: any) => q.eq("saleId", saleId))
        .collect();

    return await Promise.all(
        items.map(async (item: any) => {
            const product = await ctx.db.get(item.productId);
            let departmentName = null;
            if (product?.departmentId) {
                const dept = await ctx.db.get(product.departmentId);
                departmentName = dept?.name || null;
            }
            return { ...item, product: product || null, departmentName };
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

// ===============================
// VALIDATORS
// ===============================

export const paymentMethodValidator = v.union(
    v.literal("Cash"),
    v.literal("Card"),
    v.literal("Mpesa"),
    v.literal("Ecocash"),
    v.literal("Bank Transfer"),
    v.literal("Mobile Payment"),
    v.literal("Credit"),
    v.literal("Voucher"),
);

const paymentSplitValidator = v.object({
    method: paymentMethodValidator,
    amount: v.number(),
    amountReceived: v.optional(v.number()),
    changeDue: v.optional(v.number()),
});

// ===============================
// TYRE DISCOUNT LOGIC
// ===============================

const TYRE_DISCOUNT_THRESHOLD = 4;
const TYRE_DISCOUNT_AMOUNT = 200;

function extractRimSize(sizeStr: string): number | null {
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

        const paymentSplits = sale.paymentSplits ? JSON.parse(sale.paymentSplits) : null;

        return {
            ...withDetails,
            items: itemsWithBatches,
            discounts,
            paymentSplits,
        };
    },
});

export const getCancelledSales = query({
    args: {
        storeId: v.optional(v.id("stores")),
        dateFrom: v.optional(v.number()),
        dateTo: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        let cancelledSales = await ctx.db
            .query("cancelledSales")
            .collect();

        if (args.storeId) {
            const originalSaleIds = cancelledSales.map(cs => cs.originalSaleId);
            const originalSales = await Promise.all(
                originalSaleIds.map(id => ctx.db.get(id))
            );
            const storeFilteredIds = new Set(
                originalSales
                    .filter(s => s && s.storeId === args.storeId)
                    .map(s => s!._id)
            );
            cancelledSales = cancelledSales.filter(cs => storeFilteredIds.has(cs.originalSaleId));
        }

        if (args.dateFrom) {
            cancelledSales = cancelledSales.filter(cs => cs.cancelledAt >= args.dateFrom!);
        }
        if (args.dateTo) {
            cancelledSales = cancelledSales.filter(cs => cs.cancelledAt <= args.dateTo!);
        }

        const enriched = await Promise.all(
            cancelledSales.map(async (cs) => {
                const originalSale = await ctx.db.get(cs.originalSaleId);
                const cancelledSale = await ctx.db.get(cs.cancelledSaleId);
                const cancelledBy = await ctx.db.get(cs.cancelledBy);
                const store = originalSale ? await ctx.db.get(originalSale.storeId) : null;

                return {
                    ...cs,
                    originalSale,
                    cancelledSale,
                    cancelledBy: cancelledBy?.name || cancelledBy?.email || "Unknown",
                    store: store?.name || "Unknown",
                    originalTotal: originalSale?.totalAmount || 0,
                };
            })
        );

        return enriched.sort((a, b) => b.cancelledAt - a.cancelledAt);
    },
});

export const getSalesProductTotals = query({
    args: {
        storeId: v.optional(v.id("stores")),
        dateFrom: v.optional(v.number()),
        dateTo: v.optional(v.number()),
        departmentId: v.optional(v.id("departments")),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        let sales: any[];
        if (args.storeId) {
            sales = await ctx.db
                .query("sales")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId!))
                .collect();
        } else {
            sales = await ctx.db.query("sales").collect();
        }

        // ONLY include completed sales - exclude voided, cancelled, refunded
        sales = sales.filter((s) => {
            if (s.status !== "completed") return false;
            if (args.dateFrom && s.createdAt < args.dateFrom) return false;
            if (args.dateTo && s.createdAt > args.dateTo) return false;
            return true;
        });

        const saleIds = new Set(sales.map((s) => s._id));

        const allItems: any[] = [];
        for (const sale of sales) {
            const items = await ctx.db
                .query("saleItems")
                .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                .collect();
            allItems.push(...items);
        }

        const byProduct: Record<string, {
            productId: string;
            productName: string;
            sku: string;
            department: string;
            departmentId: string;
            totalQuantity: number;
            totalRevenue: number;
        }> = {};

        for (const item of allItems) {
            if (!saleIds.has(item.saleId)) continue;
            if (!byProduct[item.productId]) {
                const product = await ctx.db.get(item.productId as Id<"products">);
                let departmentName = "";
                let departmentId = "";
                if (product?.departmentId) {
                    const dept = await ctx.db.get(product.departmentId);
                    departmentName = dept?.name || "";
                    departmentId = dept?._id || "";
                }

                if (args.departmentId && departmentId !== args.departmentId) {
                    continue;
                }

                byProduct[item.productId] = {
                    productId: item.productId,
                    productName: product?.name ?? "Unknown Product",
                    sku: product?.sku ?? "",
                    department: departmentName,
                    departmentId: departmentId,
                    totalQuantity: 0,
                    totalRevenue: 0,
                };
            }
            byProduct[item.productId].totalQuantity += item.quantity;
            byProduct[item.productId].totalRevenue += item.quantity * item.unitPrice;
        }

        return Object.values(byProduct).sort((a, b) => b.totalRevenue - a.totalRevenue);
    },
});

export const getSalesByPaymentMethod = query({
    args: {
        storeId: v.optional(v.id("stores")),
        dateFrom: v.optional(v.number()),
        dateTo: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        let sales: any[];
        if (args.storeId) {
            sales = await ctx.db
                .query("sales")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId!))
                .collect();
        } else {
            sales = await ctx.db.query("sales").collect();
        }

        // ONLY include completed sales - exclude voided, cancelled, refunded
        sales = sales.filter((s) => {
            if (s.status !== "completed") return false;
            if (args.dateFrom && s.createdAt < args.dateFrom) return false;
            if (args.dateTo && s.createdAt > args.dateTo) return false;
            return true;
        });

        const byMethod: Record<string, {
            method: string;
            totalAmount: number;
            count: number;
            splitDetails?: any[];
        }> = {};

        for (const sale of sales) {
            if (sale.paymentSplits) {
                try {
                    const splits = JSON.parse(sale.paymentSplits);
                    for (const split of splits) {
                        const method = split.method;
                        if (!byMethod[method]) {
                            byMethod[method] = {
                                method,
                                totalAmount: 0,
                                count: 0,
                                splitDetails: [],
                            };
                        }
                        byMethod[method].totalAmount += split.amount;
                        byMethod[method].count += 1;
                        byMethod[method].splitDetails!.push({
                            saleId: sale._id,
                            amount: split.amount,
                            amountReceived: split.amountReceived,
                            changeDue: split.changeDue,
                        });
                    }
                } catch {
                    const method = sale.paymentMethod || "Unknown";
                    if (!byMethod[method]) {
                        byMethod[method] = {
                            method,
                            totalAmount: 0,
                            count: 0,
                        };
                    }
                    byMethod[method].totalAmount += sale.totalAmount;
                    byMethod[method].count += 1;
                }
            } else {
                const method = sale.paymentMethod || "Unknown";
                if (!byMethod[method]) {
                    byMethod[method] = {
                        method,
                        totalAmount: 0,
                        count: 0,
                    };
                }
                byMethod[method].totalAmount += sale.totalAmount;
                byMethod[method].count += 1;
            }
        }

        return Object.values(byMethod).sort((a, b) => b.totalAmount - a.totalAmount);
    },
});

export const getProductSalesWithPaymentMethods = query({
    args: {
        storeId: v.optional(v.id("stores")),
        dateFrom: v.optional(v.number()),
        dateTo: v.optional(v.number()),
        departmentId: v.optional(v.id("departments")),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        let sales: any[];
        if (args.storeId) {
            sales = await ctx.db
                .query("sales")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId!))
                .collect();
        } else {
            sales = await ctx.db.query("sales").collect();
        }

        // ONLY include completed sales - exclude voided, cancelled, refunded
        sales = sales.filter((s) => {
            if (s.status !== "completed") return false;
            if (args.dateFrom && s.createdAt < args.dateFrom) return false;
            if (args.dateTo && s.createdAt > args.dateTo) return false;
            return true;
        });

        const allItems: any[] = [];
        const salePaymentMap: Record<string, { method: string; splits?: any[] }> = {};
        const productDepartmentMap: Record<string, { department: string; departmentId: string }> = {};

        for (const sale of sales) {
            if (sale.paymentSplits) {
                try {
                    salePaymentMap[sale._id] = {
                        method: "Split",
                        splits: JSON.parse(sale.paymentSplits),
                    };
                } catch {
                    salePaymentMap[sale._id] = {
                        method: sale.paymentMethod || "Unknown",
                    };
                }
            } else {
                salePaymentMap[sale._id] = {
                    method: sale.paymentMethod || "Unknown",
                };
            }

            const items = await ctx.db
                .query("saleItems")
                .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
                .collect();

            for (const item of items) {
                allItems.push({ ...item, saleId: sale._id });

                if (!productDepartmentMap[item.productId]) {
                    const product = await ctx.db.get(item.productId as Id<"products">);
                    let departmentName = "";
                    let departmentId = "";
                    if (product?.departmentId) {
                        const dept = await ctx.db.get(product.departmentId);
                        if (dept) {
                            departmentName = dept.name || "";
                            departmentId = dept._id || "";
                        }
                    }
                    productDepartmentMap[item.productId] = {
                        department: departmentName,
                        departmentId: departmentId,
                    };
                }
            }
        }

        let filteredItems = allItems;
        if (args.departmentId) {
            filteredItems = allItems.filter(item => {
                const deptInfo = productDepartmentMap[item.productId];
                return deptInfo && deptInfo.departmentId === args.departmentId;
            });
        }

        const byProductAndMethod: Record<string, {
            productId: string;
            productName: string;
            sku: string;
            department: string;
            departmentId: string;
            totalQuantity: number;
            totalRevenue: number;
            saleIds: Set<string>;
            paymentMethods: Record<string, {
                amount: number;
                quantity: number;
            }>;
        }> = {};

        for (const item of filteredItems) {
            const key = item.productId;
            if (!byProductAndMethod[key]) {
                const product = await ctx.db.get(item.productId as Id<"products">);
                const deptInfo = productDepartmentMap[item.productId] || { department: "", departmentId: "" };

                byProductAndMethod[key] = {
                    productId: item.productId,
                    productName: product?.name ?? "Unknown Product",
                    sku: product?.sku ?? "",
                    department: deptInfo.department,
                    departmentId: deptInfo.departmentId,
                    totalQuantity: 0,
                    totalRevenue: 0,
                    saleIds: new Set<string>(),
                    paymentMethods: {},
                };
            }

            const productData = byProductAndMethod[key];
            productData.totalQuantity += item.quantity;
            const revenue = item.quantity * item.unitPrice;
            productData.totalRevenue += revenue;
            productData.saleIds.add(item.saleId);

            const paymentInfo = salePaymentMap[item.saleId];
            if (paymentInfo) {
                if (paymentInfo.splits) {
                    const totalSaleAmount = sales.find(s => s._id === item.saleId)?.totalAmount || 1;
                    const splitRatios = paymentInfo.splits.map((s: any) => ({
                        method: s.method,
                        ratio: s.amount / totalSaleAmount,
                    }));

                    for (const split of splitRatios) {
                        const method = split.method;
                        if (!productData.paymentMethods[method]) {
                            productData.paymentMethods[method] = {
                                amount: 0,
                                quantity: 0,
                            };
                        }
                        productData.paymentMethods[method].amount += revenue * split.ratio;
                        productData.paymentMethods[method].quantity += item.quantity * split.ratio;
                    }
                } else {
                    const method = paymentInfo.method;
                    if (!productData.paymentMethods[method]) {
                        productData.paymentMethods[method] = {
                            amount: 0,
                            quantity: 0,
                        };
                    }
                    productData.paymentMethods[method].amount += revenue;
                    productData.paymentMethods[method].quantity += item.quantity;
                }
            }
        }

        // Format the response
        return Object.values(byProductAndMethod)
            .map(p => ({
                ...p,
                saleIds: Array.from(p.saleIds),
                paymentMethods: Object.entries(p.paymentMethods).map(([method, data]) => ({
                    method,
                    ...data,
                })),
            }))
            .sort((a, b) => b.totalRevenue - a.totalRevenue);
    },
});

// ===============================
// MUTATIONS
// ===============================

export const createSale = mutation({
    args: {
        storeId: v.id("stores"),
        customerId: v.optional(v.id("customers")),
        payments: v.array(paymentSplitValidator),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantity: v.number(),
                unitPrice: v.number(),
                size: v.optional(v.string()),
                color: v.optional(v.string()),
                variant: v.optional(v.string()),
                departmentName: v.string(),
                manualDiscount: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin", "admin", "manager", "cashier",
        ]);

        if (args.items.length === 0) throw new Error("Sale must include at least one item");
        if (args.payments.length === 0) throw new Error("Sale must include at least one payment");

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");
        if (!store.isActive) throw new Error("Store is inactive");

        await assertStoreScope(ctx, currentUser, args.storeId);

        if (args.customerId) {
            const customer = await ctx.db.get(args.customerId);
            if (!customer) throw new Error("Customer not found");
        }

        for (const payment of args.payments) {
            if (payment.method === "Cash") {
                if (payment.amountReceived === undefined || payment.amountReceived < 0) {
                    throw new Error("Amount received is required for cash payments");
                }
            }
            if (payment.amount <= 0) {
                throw new Error(`Payment amount must be greater than zero`);
            }
        }

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

        // Automatic tyre bulk discount removed — discounting is now manual-only (frontend-driven)
        const manualDiscountTotal = args.items.reduce(
            (sum, item) => sum + (item.manualDiscount ?? 0),
            0
        );

        const discountTotal = manualDiscountTotal;
        const totalAmount = Math.max(0, grossTotal - discountTotal);

        const paymentTotal = args.payments.reduce((sum, p) => sum + p.amount, 0);
        if (Math.abs(paymentTotal - totalAmount) > 0.01) {
            throw new Error(
                `Payment total (${paymentTotal.toFixed(2)}) does not match sale total (${totalAmount.toFixed(2)})`
            );
        }

        for (const payment of args.payments) {
            if (payment.method === "Cash" && payment.amountReceived !== undefined) {
                if (payment.amountReceived < payment.amount) {
                    throw new Error(
                        `Cash received (${payment.amountReceived}) is less than cash portion (${payment.amount})`
                    );
                }
            }
        }

        const paymentMethodLabel =
            args.payments.length === 1
                ? args.payments[0].method
                : args.payments.map((p) => p.method).join(" + ");

        const cashLegs = args.payments.filter((p) => p.method === "Cash");
        const totalAmountReceived = cashLegs.reduce((s, p) => s + (p.amountReceived ?? p.amount), 0);
        const totalChangeDue = cashLegs.reduce((s, p) => s + (p.changeDue ?? 0), 0);

        const saleId = await ctx.db.insert("sales", {
            storeId: args.storeId,
            customerId: args.customerId,
            totalAmount,
            discountTotal: discountTotal > 0 ? discountTotal : undefined,
            status: "completed",
            paymentMethod: paymentMethodLabel,
            paymentSplits: JSON.stringify(args.payments),
            amountReceived: cashLegs.length > 0 ? totalAmountReceived : undefined,
            changeDue: cashLegs.length > 0 && totalChangeDue > 0 ? totalChangeDue : undefined,
            createdAt: Date.now(),
        });

        for (const item of args.items) {
            if (item.manualDiscount && item.manualDiscount > 0) {
                await ctx.db.insert("saleDiscounts", {
                    saleId,
                    productId: item.productId,
                    discountAmount: item.manualDiscount,
                    reason: "Manual discount",
                });
            }
        }

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

        await ctx.db.insert("ledgerEntries", {
            storeId: args.storeId,
            type: "income",
            category: "Sales",
            amount: totalAmount,
            description: `Sale of ${args.items.length} item(s) — ${paymentMethodLabel}${discountTotal > 0 ? ` (discount: R${discountTotal.toFixed(2)})` : ""}`,
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
            description: `Recorded sale of ${args.items.length} item(s) at "${store.name}" totaling ${totalAmount.toFixed(2)} (${paymentMethodLabel})${discountTotal > 0 ? `, discount R${discountTotal.toFixed(2)}` : ""}`,
        });

        return saleId;
    },
});

export const cancelSale = mutation({
    args: {
        saleId: v.id("sales"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const originalSale = await ctx.db.get(args.saleId);
        if (!originalSale) throw new Error("Sale not found");
        if (originalSale.status !== "completed") {
            throw new Error("Only completed sales can be cancelled");
        }

        await assertStoreScope(ctx, currentUser, originalSale.storeId);

        const items = await ctx.db
            .query("saleItems")
            .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
            .collect();

        if (items.length === 0) throw new Error("No items found in this sale");

        const cancelledSaleId = await ctx.db.insert("sales", {
            storeId: originalSale.storeId,
            customerId: originalSale.customerId,
            totalAmount: originalSale.totalAmount,
            discountTotal: originalSale.discountTotal,
            status: "cancelled",
            paymentMethod: originalSale.paymentMethod,
            paymentSplits: originalSale.paymentSplits,
            amountReceived: originalSale.amountReceived,
            changeDue: originalSale.changeDue,
            createdAt: originalSale.createdAt,
            cancelledAt: Date.now(),
            cancelledBy: currentUser._id,
            cancelledReason: args.reason || "No reason provided",
            originalSaleId: args.saleId,
        });

        for (const item of items) {
            const cancelledItemId = await ctx.db.insert("saleItems", {
                saleId: cancelledSaleId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
                originalSaleItemId: item._id,
            });

            const batchLinks = await ctx.db
                .query("saleItemBatches")
                .withIndex("by_sale_item", (q) => q.eq("saleItemId", item._id))
                .collect();

            for (const link of batchLinks) {
                await ctx.db.insert("saleItemBatches", {
                    saleItemId: cancelledItemId,
                    batchId: link.batchId,
                    quantity: link.quantity,
                    restoredAt: Date.now(),
                });
            }
        }

        const discounts = await ctx.db
            .query("saleDiscounts")
            .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
            .collect();

        for (const discount of discounts) {
            await ctx.db.insert("saleDiscounts", {
                saleId: cancelledSaleId,
                productId: discount.productId,
                discountAmount: discount.discountAmount,
                reason: discount.reason,
            });
        }

        for (const item of items) {
            const batchLinks = await ctx.db
                .query("saleItemBatches")
                .withIndex("by_sale_item", (q) => q.eq("saleItemId", item._id))
                .collect();

            for (const link of batchLinks) {
                const batch = await ctx.db.get(link.batchId);
                if (batch) {
                    await ctx.db.patch(link.batchId, {
                        quantity: batch.quantity + link.quantity,
                    });
                }
            }
        }

        await ctx.db.insert("cancelledSales", {
            originalSaleId: args.saleId,
            cancelledSaleId,
            cancelledAt: Date.now(),
            cancelledBy: currentUser._id,
            reason: args.reason || "No reason provided",
            originalData: JSON.stringify({
                sale: originalSale,
                items,
                discounts,
            }),
        });

        await ctx.db.patch(args.saleId, {
            status: "cancelled",
        });

        await ctx.db.insert("ledgerEntries", {
            storeId: originalSale.storeId,
            type: "expense",
            category: "Cancellation",
            amount: originalSale.totalAmount,
            description: `Cancelled sale ${args.saleId.toString()} - ${args.reason || "No reason provided"}`,
            referenceType: "cancellation",
            cancelledSaleId: cancelledSaleId,
            date: Date.now(),
        });

        const store = await ctx.db.get(originalSale.storeId);
        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "sale.cancel",
            entityType: "sales",
            entityId: args.saleId.toString(),
            description: `Cancelled sale at "${store?.name ?? originalSale.storeId}" totaling ${originalSale.totalAmount.toFixed(2)} - ${args.reason || "No reason provided"}`,
        });

        return {
            originalSaleId: args.saleId,
            cancelledSaleId,
            message: "Sale cancelled successfully. Stock has been restored.",
        };
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
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

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

// ===============================
// SALE EDIT MUTATIONS AND QUERIES
// ===============================

export const updateSalePaymentMethod = mutation({
    args: {
        saleId: v.id("sales"),
        paymentMethod: v.string(),
        paymentSplits: v.optional(v.string()),
        reason: v.string(),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sale = await ctx.db.get(args.saleId);
        if (!sale) throw new Error("Sale not found");

        // Only allow editing completed sales that haven't been cancelled/refunded/voided
        if (!["completed", "refunded"].includes(sale.status)) {
            throw new Error("Cannot edit a sale that is cancelled or voided");
        }

        // Store the original data for comparison
        const originalData = {
            paymentMethod: sale.paymentMethod,
            paymentSplits: sale.paymentSplits,
            totalAmount: sale.totalAmount,
            discountTotal: sale.discountTotal,
            amountReceived: sale.amountReceived,
            changeDue: sale.changeDue,
        };

        // Validate the new payment data
        let parsedSplits = null;
        let newPaymentMethod = args.paymentMethod;

        if (args.paymentSplits) {
            try {
                parsedSplits = JSON.parse(args.paymentSplits);
                if (!Array.isArray(parsedSplits) || parsedSplits.length === 0) {
                    throw new Error("Payment splits must be a non-empty array");
                }

                // Validate each split
                for (const split of parsedSplits) {
                    if (!split.method || typeof split.amount !== 'number') {
                        throw new Error("Invalid payment split format");
                    }
                    if (split.amount <= 0) {
                        throw new Error("Payment amount must be greater than zero");
                    }
                }

                // Generate the payment method label from splits
                newPaymentMethod = parsedSplits.length === 1
                    ? parsedSplits[0].method
                    : parsedSplits.map((s: any) => s.method).join(" + ");

            } catch (error) {
                throw new Error(`Invalid payment splits: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        // Update the sale
        const updates: Record<string, any> = {
            paymentMethod: newPaymentMethod,
        };

        if (args.paymentSplits) {
            updates.paymentSplits = args.paymentSplits;
        }

        // If we have cash payment splits, update amountReceived and changeDue
        if (parsedSplits) {
            const cashLegs = parsedSplits.filter((p: any) => p.method === "Cash");
            if (cashLegs.length > 0) {
                updates.amountReceived = cashLegs.reduce((sum: number, p: any) => sum + (p.amountReceived ?? p.amount), 0);
                updates.changeDue = cashLegs.reduce((sum: number, p: any) => sum + (p.changeDue ?? 0), 0);
            } else {
                // If no cash payments, clear these fields
                updates.amountReceived = undefined;
                updates.changeDue = undefined;
            }
        }

        await ctx.db.patch(args.saleId, updates);

        // Get the updated sale data
        const updatedSale = await ctx.db.get(args.saleId);
        if (!updatedSale) throw new Error("Sale not found after update");

        // Store the edit history
        const newData = {
            paymentMethod: updatedSale.paymentMethod,
            paymentSplits: updatedSale.paymentSplits,
            totalAmount: updatedSale.totalAmount,
            discountTotal: updatedSale.discountTotal,
            amountReceived: updatedSale.amountReceived,
            changeDue: updatedSale.changeDue,
        };

        const changes: any = {};
        if (originalData.paymentMethod !== newData.paymentMethod) {
            changes.paymentMethod = {
                from: originalData.paymentMethod,
                to: newData.paymentMethod,
            };
        }
        if (originalData.paymentSplits !== newData.paymentSplits) {
            changes.paymentSplits = {
                from: originalData.paymentSplits,
                to: newData.paymentSplits,
            };
        }

        // Insert the edit record
        await ctx.db.insert("saleEdits" as any, {
            saleId: args.saleId,
            editedBy: currentUser._id,
            editedAt: Date.now(),
            reason: args.reason,
            changes,
            originalData: JSON.stringify(originalData),
            newData: JSON.stringify(newData),
        });

        // Log the activity
        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "sale.edit",
            entityType: "sales",
            entityId: args.saleId.toString(),
            description: `Updated payment method from "${originalData.paymentMethod}" to "${newData.paymentMethod}" - Reason: ${args.reason}`,
        });

        return {
            success: true,
            message: "Sale payment method updated successfully",
            changes,
            originalData,
            newData,
        };
    },
});

export const getSaleEditHistory = query({
    args: { saleId: v.id("sales") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const edits = await ctx.db
            .query("saleEdits" as any)
            .withIndex("by_sale" as any, (q) => q.eq("saleId" as any, args.saleId))
            .order("desc")
            .collect();

        const enriched = await Promise.all(
            edits.map(async (edit: any) => {
                const editor = await ctx.db.get(edit.editedBy as Id<"users">);
                const isCurrentUser = edit.editedBy === currentUser._id;

                return {
                    ...edit,
                    editorName: isCurrentUser
                        ? (currentUser.name || currentUser.email || "You")
                        : (editor?.name || editor?.email || "Unknown User"),
                    isCurrentUser,
                    originalData: JSON.parse(edit.originalData),
                    newData: JSON.parse(edit.newData),
                };
            })
        );

        return enriched;
    },
});

export const allCompletedSales = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["super_admin", "admin"]);
    const sales = await ctx.db.query("sales").collect();
    
    // Filter to only completed sales
    const completedSales = sales.filter(sale => sale.status === "completed");
    
    const withDetails = await Promise.all(
      completedSales.map((sale) => joinSaleDetails(ctx, sale))
    );
    return withDetails.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getCompletedSalesByStore = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();
      
    const completedSales = sales.filter(sale => sale.status === "completed");
    
    const withDetails = await Promise.all(
      completedSales.map((sale) => joinSaleDetails(ctx, sale))
    );
    return withDetails.sort((a, b) => b.createdAt - a.createdAt);
  },
});