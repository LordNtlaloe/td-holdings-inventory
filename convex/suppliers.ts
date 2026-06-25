import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";

export const getAllSuppliers = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);
        return await ctx.db.query("suppliers").collect();
    },
});

export const getSupplierById = query({
    args: { supplierId: v.id("suppliers") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const supplier = await ctx.db.get(args.supplierId);
        if (!supplier) throw new Error("Supplier not found");

        return supplier;
    },
});

export const searchSuppliers = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const suppliers = await ctx.db.query("suppliers").collect();
        const term = args.searchTerm.toLowerCase();

        return suppliers.filter(
            (supplier) =>
                supplier.name.toLowerCase().includes(term) ||
                supplier.email?.toLowerCase().includes(term) ||
                supplier.phone?.toLowerCase().includes(term)
        );
    },
});

export const createSupplier = mutation({
    args: {
        name: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        if (args.email !== undefined) {
            const existing = await ctx.db.query("suppliers").collect();
            const duplicate = existing.find(
                (s) => s.email?.toLowerCase() === args.email!.toLowerCase()
            );
            if (duplicate) throw new Error("A supplier with this email already exists");
        }

        const supplierId = await ctx.db.insert("suppliers", {
            name: args.name,
            email: args.email,
            phone: args.phone,
        });

        return supplierId;
    },
});

export const updateSupplier = mutation({
    args: {
        supplierId: v.id("suppliers"),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const supplier = await ctx.db.get(args.supplierId);
        if (!supplier) throw new Error("Supplier not found");

        if (args.email !== undefined && args.email !== supplier.email) {
            const existing = await ctx.db.query("suppliers").collect();
            const duplicate = existing.find(
                (s) =>
                    s._id !== args.supplierId &&
                    s.email?.toLowerCase() === args.email!.toLowerCase()
            );
            if (duplicate) throw new Error("A supplier with this email already exists");
        }

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.email !== undefined) updates.email = args.email;
        if (args.phone !== undefined) updates.phone = args.phone;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.supplierId, updates);
        return true;
    },
});