import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

export const getAllCategories = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        return await ctx.db.query("categories").collect();
    },
});

export const getAllCategoriesWithDetails = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const categories = await ctx.db.query("categories").collect();

        const categoriesWithDetails = await Promise.all(
            categories.map(async (category) => {
                const department = await ctx.db.get(category.departmentId);

                const products = await ctx.db
                    .query("products")
                    .withIndex("by_category", (q) => q.eq("categoryId", category._id))
                    .collect();

                return {
                    ...category,
                    department: department || null,
                    productCount: products.length,
                };
            })
        );

        return categoriesWithDetails;
    },
});

export const getCategoryActivityStats = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .collect();

        const categoryLogs = logs.filter(log =>
            log.entityType === "categories" ||
            log.action.includes("category")
        );

        const recentLogs = categoryLogs.filter(log => log.createdAt >= sevenDaysAgo);

        const dayMap = new Map<string, {
            created: number,
            updated: number,
            deleted: number,
        }>();
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        dayOrder.forEach(day => {
            dayMap.set(day, { created: 0, updated: 0, deleted: 0 });
        });

        recentLogs.forEach((log) => {
            const date = new Date(log.createdAt);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            if (dayMap.has(day)) {
                const entry = dayMap.get(day)!;
                if (log.action === "category.create") entry.created++;
                else if (log.action === "category.update") entry.updated++;
                else if (log.action === "category.delete") entry.deleted++;
            }
        });

        const activityData = Array.from(dayMap.entries()).map(([label, data]) => ({
            label,
            Created: data.created,
            Updated: data.updated,
            Deleted: data.deleted,
        }));

        return activityData;
    },
});

export const getCategoriesByDepartment = query({
    args: { departmentId: v.id("departments") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        return await ctx.db
            .query("categories")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .collect();
    },
});

export const getCategoryById = query({
    args: { categoryId: v.id("categories") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");

        return category;
    },
});

export const getCategoryWithDepartment = query({
    args: { categoryId: v.id("categories") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");

        const department = await ctx.db.get(category.departmentId);

        return {
            ...category,
            department: department || null,
        };
    },
});

export const searchCategories = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const categories = await ctx.db.query("categories").collect();

        return categories.filter((category) =>
            category.name.toLowerCase().includes(args.searchTerm.toLowerCase())
        );
    },
});

export const createCategory = mutation({
    args: {
        name: v.string(),
        departmentId: v.id("departments"),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        const existing = await ctx.db
            .query("categories")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .collect();

        const duplicate = existing.find(
            (c) => c.name.toLowerCase() === args.name.toLowerCase()
        );
        if (duplicate) throw new Error("A category with this name already exists in this department");

        const categoryId = await ctx.db.insert("categories", {
            name: args.name,
            departmentId: args.departmentId,
            description: args.description,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "category.create",
            entityType: "categories",
            entityId: categoryId.toString(),
            description: `Created category "${args.name}" in department "${department.name}"`,
        });

        return categoryId;
    },
});

export const updateCategory = mutation({
    args: {
        categoryId: v.id("categories"),
        name: v.optional(v.string()),
        departmentId: v.optional(v.id("departments")),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");

        const targetDepartmentId = args.departmentId ?? category.departmentId;

        if (args.departmentId !== undefined) {
            const department = await ctx.db.get(args.departmentId);
            if (!department) throw new Error("Department not found");
        }

        if (args.name !== undefined) {
            const existing = await ctx.db
                .query("categories")
                .withIndex("by_department", (q) => q.eq("departmentId", targetDepartmentId))
                .collect();

            const duplicate = existing.find(
                (c) =>
                    c._id !== args.categoryId &&
                    c.name.toLowerCase() === args.name!.toLowerCase()
            );
            if (duplicate) throw new Error("A category with this name already exists in this department");
        }

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.departmentId !== undefined) updates.departmentId = args.departmentId;
        if (args.description !== undefined) updates.description = args.description;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.categoryId, updates);

        const department = await ctx.db.get(targetDepartmentId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "category.update",
            entityType: "categories",
            entityId: args.categoryId.toString(),
            description: `Updated category "${category.name}": ${JSON.stringify(updates)}${department ? ` in department "${department.name}"` : ''}`,
        });

        return true;
    },
});

export const deleteCategory = mutation({
    args: { categoryId: v.id("categories") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");

        const product = await ctx.db
            .query("products")
            .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
            .first();
        if (product) throw new Error("Cannot delete a category with existing products");

        const department = await ctx.db.get(category.departmentId);

        await ctx.db.delete(args.categoryId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "category.delete",
            entityType: "categories",
            entityId: args.categoryId.toString(),
            description: `Deleted category "${category.name}"${department ? ` from department "${department.name}"` : ''}`,
        });

        return true;
    },
});