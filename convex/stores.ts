import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

export const getAllStores = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);
        return await ctx.db.query("stores").collect();
    },
});

export const getActiveStores = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const stores = await ctx.db.query("stores").collect();
        return stores.filter((store) => store.isActive);
    },
});

// Returns the single store the current employee is assigned to (via their
// employees record). Managers/cashiers only ever work one store, so the
// POS page uses this instead of getAllStores (which cashiers can't call).
// Admins/super_admins aren't tied to a store — they get null and should
// fall back to getActiveStores to pick one.
export const getMyStore = query({
    args: {},
    handler: async (ctx) => {
        const currentUser = await requireRole(ctx, [
            "super_admin",
            "admin",
            "manager",
            "cashier",
        ]);

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            return null;
        }

        const employee = await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
            .first();

        if (!employee || !employee.isActive) {
            throw new Error("No active employee record found for this user");
        }

        const store = await ctx.db.get(employee.storeId);
        if (!store) throw new Error("Assigned store not found");

        return store;
    },
});

export const getStoreById = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        return store;
    },
});

export const getStoresByType = query({
    args: { type: v.union(v.literal("central"), v.literal("branch")) },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        return await ctx.db
            .query("stores")
            .withIndex("by_type", (q) => q.eq("type", args.type))
            .collect();
    },
});

export const createStore = mutation({
    args: {
        name: v.string(),
        type: v.union(v.literal("central"), v.literal("branch")),
        address: v.optional(v.string()),
        phone: v.string(),
        xCoordinates: v.string(),
        yCoordinates: v.string(),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const storeId = await ctx.db.insert("stores", {
            name: args.name,
            type: args.type,
            address: args.address,
            phone: args.phone,
            xCoordinates: args.xCoordinates,
            yCoordinates: args.yCoordinates,
            isActive: true,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "store.create",
            entityType: "stores",
            entityId: storeId.toString(),
            description: `Created store "${args.name}" (${args.type}) at ${args.address || 'no address'}`,
        });

        return storeId;
    },
});

export const updateStore = mutation({
    args: {
        storeId: v.id("stores"),
        name: v.optional(v.string()),
        type: v.optional(v.union(v.literal("central"), v.literal("branch"))),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        xCoordinates: v.optional(v.string()),
        yCoordinates: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.type !== undefined) updates.type = args.type;
        if (args.address !== undefined) updates.address = args.address;
        if (args.phone !== undefined) updates.phone = args.phone;
        if (args.xCoordinates !== undefined) updates.xCoordinates = args.xCoordinates;
        if (args.yCoordinates !== undefined) updates.yCoordinates = args.yCoordinates;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.storeId, updates);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "store.update",
            entityType: "stores",
            entityId: args.storeId.toString(),
            description: `Updated store "${store.name}": ${JSON.stringify(updates)}`,
        });

        return true;
    },
});

export const deactivateStore = mutation({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const activeEmployees = await ctx.db
            .query("employees")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const hasActiveStaff = activeEmployees.some((e) => e.isActive);
        if (hasActiveStaff) {
            throw new Error("Cannot deactivate a store with active employees. Transfer or deactivate them first.");
        }

        await ctx.db.patch(args.storeId, { isActive: false });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "store.deactivate",
            entityType: "stores",
            entityId: args.storeId.toString(),
            description: `Deactivated store "${store.name}"`,
        });

        return true;
    },
});

export const reactivateStore = mutation({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        await ctx.db.patch(args.storeId, { isActive: true });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "store.reactivate",
            entityType: "stores",
            entityId: args.storeId.toString(),
            description: `Reactivated store "${store.name}"`,
        });

        return true;
    },
});

export const deleteStore = mutation({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .first();
        if (employees) throw new Error("Cannot delete a store with assigned employees");

        const inventory = await ctx.db
            .query("inventory")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .first();
        if (inventory) throw new Error("Cannot delete a store with inventory records");

        const sales = await ctx.db
            .query("sales")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .first();
        if (sales) throw new Error("Cannot delete a store with sales history");

        await ctx.db.delete(args.storeId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "store.delete",
            entityType: "stores",
            entityId: args.storeId.toString(),
            description: `Deleted store "${store.name}"`,
        });

        return true;
    },
});

export const getStoreInternal = internalQuery({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.storeId);
    },
});