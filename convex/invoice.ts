import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

const docTypeValidator = v.union(
    v.literal("quotation"),
    v.literal("proforma"),
    v.literal("invoice")
);

const DOC_TYPE_PREFIX: Record<string, string> = {
    quotation: "QUO",
    proforma: "PRO",
    invoice: "INV",
};

const DOC_TYPE_LABEL: Record<string, string> = {
    quotation: "quotation",
    proforma: "proforma invoice",
    invoice: "invoice",
};

async function nextInvoiceNumber(
    ctx: any,
    storeId: string,
    docType: "quotation" | "proforma" | "invoice"
) {
    const existing = await ctx.db
        .query("invoices")
        .withIndex("by_doc_type", (q: any) => q.eq("docType", docType))
        .filter((q: any) => q.eq(q.field("storeId"), storeId))
        .collect();

    const prefix = DOC_TYPE_PREFIX[docType];
    return `${prefix}-${String(existing.length + 1).padStart(4, "0")}`;
}

export const listInvoices = query({
    args: {
        storeId: v.id("stores"),
        docType: v.optional(docTypeValidator),
        status: v.optional(
            v.union(v.literal("unpaid"), v.literal("paid"), v.literal("cancelled"))
        ),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        let results = await ctx.db
            .query("invoices")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        if (args.docType) {
            results = results.filter((doc) => doc.docType === args.docType);
        }
        if (args.status) {
            results = results.filter((doc) => doc.status === args.status);
        }

        return results.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const getInvoice = query({
    args: { invoiceId: v.id("invoices") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) return null;

        const items = await ctx.db
            .query("invoiceItems")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
            .collect();

        const itemsWithProducts = await Promise.all(
            items.map(async (item) => ({
                ...item,
                product: await ctx.db.get(item.productId),
            }))
        );

        const customer = invoice.customerId ? await ctx.db.get(invoice.customerId) : null;
        const store = await ctx.db.get(invoice.storeId);

        return { ...invoice, items: itemsWithProducts, customer, store };
    },
});

export const createInvoice = mutation({
    args: {
        storeId: v.id("stores"),
        docType: docTypeValidator,
        customerId: v.optional(v.id("customers")),
        customerName: v.optional(v.string()),
        customerPhone: v.optional(v.string()),
        validUntil: v.optional(v.number()),
        notes: v.optional(v.string()),
        discountTotal: v.optional(v.number()),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantity: v.number(),
                unitPrice: v.number(),
                size: v.optional(v.string()),
                color: v.optional(v.string()),
                variant: v.optional(v.string()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        if (args.items.length === 0) {
            throw new Error("Cannot create a document with no items");
        }
        if (args.items.some((item) => item.quantity <= 0)) {
            throw new Error("Item quantities must be greater than zero");
        }

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const subtotal = args.items.reduce(
            (sum, item) => sum + item.quantity * item.unitPrice,
            0
        );
        const totalAmount = subtotal - (args.discountTotal ?? 0);
        if (totalAmount < 0) throw new Error("Discount cannot exceed the subtotal");

        const invoiceNumber = await nextInvoiceNumber(ctx, args.storeId, args.docType);

        const invoiceId = await ctx.db.insert("invoices", {
            storeId: args.storeId,
            docType: args.docType,
            invoiceNumber,
            customerId: args.customerId,
            customerName: args.customerName,
            customerPhone: args.customerPhone,
            status: "unpaid",
            totalAmount,
            discountTotal: args.discountTotal,
            validUntil: args.validUntil,
            notes: args.notes,
            createdBy: currentUser._id,
            createdAt: Date.now(),
        });

        for (const item of args.items) {
            await ctx.db.insert("invoiceItems", {
                invoiceId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
            });
        }

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.create",
            entityType: "invoices",
            entityId: invoiceId.toString(),
            description: `Created ${DOC_TYPE_LABEL[args.docType]} ${invoiceNumber} for ${
                args.customerName || "walk-in customer"
            } totaling R${totalAmount.toFixed(2)}`,
        });

        return invoiceId;
    },
});

export const updateInvoiceItems = mutation({
    args: {
        invoiceId: v.id("invoices"),
        items: v.array(
            v.object({
                productId: v.id("products"),
                quantity: v.number(),
                unitPrice: v.number(),
                size: v.optional(v.string()),
                color: v.optional(v.string()),
                variant: v.optional(v.string()),
            })
        ),
        discountTotal: v.optional(v.number()),
        notes: v.optional(v.string()),
        validUntil: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) throw new Error("Document not found");
        if (invoice.status !== "unpaid") {
            throw new Error("Only unpaid documents can be edited");
        }
        if (args.items.length === 0) {
            throw new Error("Cannot save a document with no items");
        }

        const existingItems = await ctx.db
            .query("invoiceItems")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
            .collect();
        for (const item of existingItems) {
            await ctx.db.delete(item._id);
        }

        for (const item of args.items) {
            await ctx.db.insert("invoiceItems", {
                invoiceId: args.invoiceId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
            });
        }

        const subtotal = args.items.reduce(
            (sum, item) => sum + item.quantity * item.unitPrice,
            0
        );
        const totalAmount = subtotal - (args.discountTotal ?? 0);
        if (totalAmount < 0) throw new Error("Discount cannot exceed the subtotal");

        await ctx.db.patch(args.invoiceId, {
            totalAmount,
            discountTotal: args.discountTotal,
            notes: args.notes ?? invoice.notes,
            validUntil: args.validUntil ?? invoice.validUntil,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.update",
            entityType: "invoices",
            entityId: args.invoiceId.toString(),
            description: `Updated ${DOC_TYPE_LABEL[invoice.docType]} ${invoice.invoiceNumber}`,
        });

        return true;
    },
});

export const markAsPaid = mutation({
    args: { invoiceId: v.id("invoices") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) throw new Error("Document not found");
        if (invoice.status === "cancelled") {
            throw new Error("Cannot mark a cancelled document as paid");
        }

        await ctx.db.patch(args.invoiceId, {
            status: "paid",
            paidAt: Date.now(),
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.markPaid",
            entityType: "invoices",
            entityId: args.invoiceId.toString(),
            description: `Marked ${DOC_TYPE_LABEL[invoice.docType]} ${invoice.invoiceNumber} as paid`,
        });

        return true;
    },
});

export const cancelInvoice = mutation({
    args: { invoiceId: v.id("invoices"), reason: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) throw new Error("Document not found");

        await ctx.db.patch(args.invoiceId, { status: "cancelled" });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.cancel",
            entityType: "invoices",
            entityId: args.invoiceId.toString(),
            description: `Cancelled ${DOC_TYPE_LABEL[invoice.docType]} ${invoice.invoiceNumber}${
                args.reason ? `: ${args.reason}` : ""
            }`,
        });

        return true;
    },
});

// Quotation -> proforma -> invoice. Creates a new linked document with the
// same items instead of mutating the original, so history stays intact.
export const convertDocType = mutation({
    args: {
        invoiceId: v.id("invoices"),
        toDocType: v.union(v.literal("proforma"), v.literal("invoice")),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        const source = await ctx.db.get(args.invoiceId);
        if (!source) throw new Error("Document not found");

        const items = await ctx.db
            .query("invoiceItems")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
            .collect();

        const invoiceNumber = await nextInvoiceNumber(ctx, source.storeId, args.toDocType);

        const newId = await ctx.db.insert("invoices", {
            storeId: source.storeId,
            docType: args.toDocType,
            invoiceNumber,
            customerId: source.customerId,
            customerName: source.customerName,
            customerPhone: source.customerPhone,
            status: "unpaid",
            totalAmount: source.totalAmount,
            discountTotal: source.discountTotal,
            validUntil: source.validUntil,
            notes: source.notes,
            createdBy: currentUser._id,
            createdAt: Date.now(),
            convertedFromId: source._id,
        });

        for (const item of items) {
            await ctx.db.insert("invoiceItems", {
                invoiceId: newId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
            });
        }

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.convert",
            entityType: "invoices",
            entityId: newId.toString(),
            description: `Converted ${DOC_TYPE_LABEL[source.docType]} ${
                source.invoiceNumber
            } to ${DOC_TYPE_LABEL[args.toDocType]} ${invoiceNumber}`,
        });

        return newId;
    },
});

// Turns a paid invoice into a real sale. NOTE: stock/batch deduction is
// intentionally left out here — wire this into your existing sales.createSale
// logic so batches are deducted the same way everywhere.
export const convertToSale = mutation({
    args: { invoiceId: v.id("invoices") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) throw new Error("Document not found");
        if (invoice.docType !== "invoice") {
            throw new Error("Only a final invoice can be converted to a sale");
        }
        if (invoice.convertedToSaleId) {
            throw new Error("This invoice has already been converted to a sale");
        }

        const items = await ctx.db
            .query("invoiceItems")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
            .collect();

        const saleId = await ctx.db.insert("sales", {
            storeId: invoice.storeId,
            customerId: invoice.customerId,
            totalAmount: invoice.totalAmount,
            discountTotal: invoice.discountTotal,
            status: "completed",
            paymentMethod: "Invoice",
            createdAt: Date.now(),
        });

        for (const item of items) {
            await ctx.db.insert("saleItems", {
                saleId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size,
                color: item.color,
                variant: item.variant,
            });
        }

        await ctx.db.patch(args.invoiceId, {
            status: "paid",
            paidAt: invoice.paidAt ?? Date.now(),
            convertedToSaleId: saleId,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.convertToSale",
            entityType: "invoices",
            entityId: args.invoiceId.toString(),
            description: `Converted invoice ${invoice.invoiceNumber} to a sale`,
        });

        return saleId;
    },
});

export const deleteInvoice = mutation({
    args: { invoiceId: v.id("invoices") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const invoice = await ctx.db.get(args.invoiceId);
        if (!invoice) throw new Error("Document not found");
        if (invoice.status === "paid" || invoice.convertedToSaleId) {
            throw new Error("Cannot delete a paid or converted document");
        }

        const items = await ctx.db
            .query("invoiceItems")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
            .collect();
        for (const item of items) {
            await ctx.db.delete(item._id);
        }

        await ctx.db.delete(args.invoiceId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "invoice.delete",
            entityType: "invoices",
            entityId: args.invoiceId.toString(),
            description: `Deleted ${DOC_TYPE_LABEL[invoice.docType]} ${invoice.invoiceNumber}`,
        });

        return true;
    },
});