import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

export const getAllDepartments = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        return await ctx.db.query("departments").collect();
    },
});

export const getAllDepartmentsWithStoreCount = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const departments = await ctx.db.query("departments").collect();

        const departmentsWithCounts = await Promise.all(
            departments.map(async (department) => {
                const storeDepartments = await ctx.db
                    .query("storeDepartments")
                    .withIndex("by_department", (q) => q.eq("departmentId", department._id))
                    .collect();

                const storeIds = storeDepartments.map(sd => sd.storeId);
                const stores = await Promise.all(
                    storeIds.map(id => ctx.db.get(id))
                );
                const validStores = stores.filter(s => s !== null);

                let totalEmployees = 0
                for (const store of validStores) {
                    const employees = await ctx.db
                        .query("employees")
                        .withIndex("by_store", (q) => q.eq("storeId", store._id))
                        .collect();
                    totalEmployees += employees.filter(e => e.isActive).length;
                }

                return {
                    ...department,
                    storeCount: validStores.length,
                    stores: validStores,
                    employeeCount: totalEmployees,
                };
            })
        );

        return departmentsWithCounts;
    },
});

export const getDepartmentActivityStats = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .collect();

        const departmentLogs = logs.filter(log =>
            log.entityType === "departments" ||
            log.action.includes("department") ||
            log.action.includes("storeDepartments")
        );

        const recentLogs = departmentLogs.filter(log => log.createdAt >= sevenDaysAgo);

        const dayMap = new Map<string, {
            created: number,
            updated: number,
            deleted: number,
            assigned: number,
            removed: number
        }>();
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        dayOrder.forEach(day => {
            dayMap.set(day, { created: 0, updated: 0, deleted: 0, assigned: 0, removed: 0 });
        });

        recentLogs.forEach((log) => {
            const date = new Date(log.createdAt);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            if (dayMap.has(day)) {
                const entry = dayMap.get(day)!;
                if (log.action === "department.create") entry.created++;
                else if (log.action === "department.update") entry.updated++;
                else if (log.action === "department.delete") entry.deleted++;
                else if (log.action === "storeDepartments.assign") entry.assigned++;
                else if (log.action === "storeDepartments.remove") entry.removed++;
            }
        });

        const activityData = Array.from(dayMap.entries()).map(([label, data]) => ({
            label,
            Created: data.created,
            Updated: data.updated,
            Deleted: data.deleted,
            Assigned: data.assigned,
            Removed: data.removed,
        }));

        return activityData;
    },
});

export const getDepartmentById = query({
    args: { departmentId: v.id("departments") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        return department;
    },
});

export const searchDepartments = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const departments = await ctx.db.query("departments").collect();

        return departments.filter((department) =>
            department.name.toLowerCase().includes(args.searchTerm.toLowerCase())
        );
    },
});

export const createDepartment = mutation({
    args: {
        name: v.string(),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const existing = await ctx.db.query("departments").collect();
        const duplicate = existing.find(
            (d) => d.name.toLowerCase() === args.name.toLowerCase()
        );
        if (duplicate) throw new Error("A department with this name already exists");

        const departmentId = await ctx.db.insert("departments", {
            name: args.name,
            description: args.description,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "department.create",
            entityType: "departments",
            entityId: departmentId.toString(),
            description: `Created department "${args.name}"`,
        });

        return departmentId;
    },
});

export const updateDepartment = mutation({
    args: {
        departmentId: v.id("departments"),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        if (args.name !== undefined) {
            const existing = await ctx.db.query("departments").collect();
            const duplicate = existing.find(
                (d) =>
                    d._id !== args.departmentId &&
                    d.name.toLowerCase() === args.name!.toLowerCase()
            );
            if (duplicate) throw new Error("A department with this name already exists");
        }

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.description !== undefined) updates.description = args.description;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.departmentId, updates);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "department.update",
            entityType: "departments",
            entityId: args.departmentId.toString(),
            description: `Updated department "${department.name}": ${JSON.stringify(updates)}`,
        });

        return true;
    },
});

export const deleteDepartment = mutation({
    args: { departmentId: v.id("departments") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        const category = await ctx.db
            .query("categories")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .first();
        if (category) throw new Error("Cannot delete a department with existing categories");

        const product = await ctx.db
            .query("products")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .first();
        if (product) throw new Error("Cannot delete a department with existing products");

        const storeDepartment = await ctx.db
            .query("storeDepartments")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .first();
        if (storeDepartment) throw new Error("Cannot delete a department assigned to stores");

        await ctx.db.delete(args.departmentId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "department.delete",
            entityType: "departments",
            entityId: args.departmentId.toString(),
            description: `Deleted department "${department.name}"`,
        });

        return true;
    },
});