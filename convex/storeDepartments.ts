import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

export const getDepartmentsByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const storeDepartments = await ctx.db
            .query("storeDepartments")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const withDetails = await Promise.all(
            storeDepartments.map(async (sd) => {
                const department = await ctx.db.get(sd.departmentId);
                return {
                    ...sd,
                    department: department || null,
                };
            })
        );

        return withDetails.filter((sd) => sd.department !== null);
    },
});

export const getStoresByDepartment = query({
    args: { departmentId: v.id("departments") },
    handler: async (ctx, args) => {
        const department = await ctx.db.get(args.departmentId);
        if (!department) {
            return [];
        }

        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const storeDepartments = await ctx.db
            .query("storeDepartments")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .collect();

        const withDetails = await Promise.all(
            storeDepartments.map(async (sd) => {
                const store = await ctx.db.get(sd.storeId);
                return {
                    ...sd,
                    store: store || null,
                };
            })
        );

        return withDetails.filter((sd) => sd.store !== null);
    },
});

export const isDepartmentAssignedToStore = query({
    args: {
        storeId: v.id("stores"),
        departmentId: v.id("departments"),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const storeDepartments = await ctx.db
            .query("storeDepartments")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        return storeDepartments.some((sd) => sd.departmentId === args.departmentId);
    },
});

export const assignDepartmentToStore = mutation({
    args: {
        storeId: v.id("stores"),
        departmentId: v.id("departments"),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        const existing = await ctx.db
            .query("storeDepartments")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const duplicate = existing.find((sd) => sd.departmentId === args.departmentId);
        if (duplicate) throw new Error("This department is already assigned to the store");

        const storeDepartmentId = await ctx.db.insert("storeDepartments", {
            storeId: args.storeId,
            departmentId: args.departmentId,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "storeDepartments.assign",
            entityType: "storeDepartments",
            entityId: storeDepartmentId.toString(),
            description: `Assigned department "${department.name}" to store "${store.name}"`,
        });

        return storeDepartmentId;
    },
});

export const removeDepartmentFromStore = mutation({
    args: {
        storeId: v.id("stores"),
        departmentId: v.id("departments"),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const existing = await ctx.db
            .query("storeDepartments")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const link = existing.find((sd) => sd.departmentId === args.departmentId);
        if (!link) throw new Error("This department is not assigned to the store");

        const department = await ctx.db.get(args.departmentId);
        const store = await ctx.db.get(args.storeId);

        const productsInDept = await ctx.db
            .query("products")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .collect();

        const productIds = new Set(productsInDept.map((p) => p._id.toString()));

        if (productIds.size > 0) {
            const storeBatches = await ctx.db
                .query("batches")
                .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
                .collect();

            const hasStock = storeBatches.some(
                (batch) => productIds.has(batch.productId.toString()) && batch.quantity > 0
            );

            if (hasStock) {
                throw new Error(
                    "Cannot remove this department: the store still has stock for products in it"
                );
            }
        }

        await ctx.db.delete(link._id);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "storeDepartments.remove",
            entityType: "storeDepartments",
            entityId: link._id.toString(),
            description: `Removed department "${department?.name || 'Unknown'}" from store "${store?.name || 'Unknown'}"`,
        });

        return true;
    },
});

export const setStoreDepartments = mutation({
    args: {
        storeId: v.id("stores"),
        departmentIds: v.array(v.id("departments")),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const store = await ctx.db.get(args.storeId);
        if (!store) throw new Error("Store not found");

        for (const departmentId of args.departmentIds) {
            const department = await ctx.db.get(departmentId);
            if (!department) throw new Error("One or more departments not found");
        }

        const existing = await ctx.db
            .query("storeDepartments")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const desiredSet = new Set(args.departmentIds);
        const existingByDept = new Map(existing.map((sd) => [sd.departmentId, sd]));

        for (const sd of existing) {
            if (!desiredSet.has(sd.departmentId)) {
                await ctx.db.delete(sd._id);
            }
        }

        for (const departmentId of args.departmentIds) {
            if (!existingByDept.has(departmentId)) {
                await ctx.db.insert("storeDepartments", {
                    storeId: args.storeId,
                    departmentId,
                });
            }
        }

        return true;
    },
});