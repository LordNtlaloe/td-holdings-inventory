import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

export const getUserProfile = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        return await ctx.db.get(userId);
    },
});

export const updateUserProfile = mutation({
    args: {
        name: v.optional(v.string()),
        image: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Not authenticated");

        const user = await ctx.db.get(userId);
        if (!user) throw new Error("User not found");

        if (user.status === "banned") throw new Error("Account is banned");

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.image !== undefined) updates.image = args.image;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(userId, updates);
        return true;
    },
});

export const updateUserStatus = mutation({
    args: {
        userId: v.id("users"),
        status: v.union(v.literal("active"), v.literal("suspended"), v.literal("banned")),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error("User not found");

        if (currentUser._id.toString() === targetUser._id.toString()) {
            throw new Error("Cannot change your own status");
        }

        if (targetUser.role === "super_admin" && currentUser.role !== "super_admin") {
            throw new Error("Unauthorized: only super_admin can change super_admin status");
        }

        await ctx.db.patch(args.userId, { status: args.status });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: `user.status.${args.status}`,
            entityType: "users",
            entityId: args.userId.toString(),
            description: `Changed user ${targetUser.email} status to ${args.status}`,
        });

        return true;
    },
});

export const getAllUsers = query({
    args: {},
    handler: async (ctx) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            return await ctx.db.query("users").collect();
        }

        if (currentUser.role === "manager") {
            // Managers should only see users in their store
            // Get the manager's employee record to find their store
            const employee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!employee) {
                // If manager has no employee record, they see no users
                return [];
            }

            // Get all users who are employees of this manager's store
            const storeEmployees = await ctx.db
                .query("employees")
                .withIndex("by_store", (q) => q.eq("storeId", employee.storeId))
                .collect();

            const userIds = storeEmployees.map(emp => emp.userId);

            // Fetch all users for these employee IDs
            const users = await Promise.all(
                userIds.map(id => ctx.db.get(id))
            );

            return users.filter((user): user is Doc<"users"> => user !== null);
        }

        return [];
    },
});

export const getUserById = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        const targetUser = await ctx.db.get(args.userId);

        if (!targetUser) throw new Error("User not found");

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            return targetUser;
        }

        if (currentUser.role === "cashier") {
            if (currentUser._id.toString() !== targetUser._id.toString()) {
                throw new Error("Unauthorized");
            }
            return targetUser;
        }

        if (currentUser.role === "manager") {
            // Check if the target user works in the manager's store
            const currentEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!currentEmployee) {
                throw new Error("Manager not properly assigned");
            }

            const targetEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", targetUser._id))
                .first();

            if (!targetEmployee || targetEmployee.storeId !== currentEmployee.storeId) {
                throw new Error("Unauthorized");
            }

            return targetUser;
        }

        return null;
    },
});

export const getUserByEmail = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        return await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .first();
    },
});

export const searchUsers = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const users = await ctx.db.query("users").collect();

        return users.filter(user =>
            user.name.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(args.searchTerm.toLowerCase())
        );
    },
});

export const deleteUser = mutation({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error("User not found");

        if (currentUser._id.toString() === targetUser._id.toString()) {
            throw new Error("Cannot delete yourself");
        }

        if (targetUser.role === "super_admin" && currentUser.role !== "super_admin") {
            throw new Error("Unauthorized: only super_admin can delete another super_admin");
        }

        const employee = await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();

        if (employee) {
            await ctx.db.delete(employee._id);
        }

        await ctx.db.delete(args.userId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "user.delete",
            entityType: "users",
            entityId: args.userId.toString(),
            description: `Deleted user ${targetUser.email}`,
        });

        return true;
    },
});

export const getUserRole = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;

        const user = await ctx.db.get(userId);
        if (!user) return null;

        return {
            role: user.role,
            userId: user._id,
        };
    },
});

export const getCurrentUser = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;

        const user = await ctx.db.get(userId);
        if (!user) return null;

        return user;
    },
});


// Add these to your existing users.ts

export const getCurrentUserInternal = internalQuery({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        return await ctx.db.get(userId);
    },
});

export const getUserByEmailInternal = internalQuery({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .first();
    },
});