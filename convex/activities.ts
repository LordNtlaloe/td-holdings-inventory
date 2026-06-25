import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { getAuthUserId } from "@convex-dev/auth/server";

// --- Internal helper, called from other mutations ---
// Best-effort logging: failures here should never block the actual
// operation, so callers should not let a logging error bubble up.
export const logActivity = internalMutation({
    args: {
        userId: v.id("users"),
        role: v.string(),
        action: v.string(),
        entityType: v.optional(v.string()),
        entityId: v.optional(v.string()),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            role: args.role,
            action: args.action,
            entityType: args.entityType,
            entityId: args.entityId,
            description: args.description,
            createdAt: Date.now(),
        });
    },
});

// --- Reads, admin/super_admin only ---

export const getRecentActivity = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .take(args.limit ?? 100);

        const withUser = await Promise.all(
            logs.map(async (log) => {
                const user = await ctx.db.get(log.userId);
                return { ...log, user: user || null };
            })
        );

        return withUser;
    },
});

export const getActivityByUser = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        return await ctx.db
            .query("activityLogs")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect();
    },
});

export const getActivityByAction = query({
    args: { action: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        return await ctx.db
            .query("activityLogs")
            .withIndex("by_action", (q) => q.eq("action", args.action))
            .collect();
    },
});

// --- User activity stats for dashboard ---
// Gets activity data grouped by day of week for the last 7 days
export const getUserActivityStats = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        // Get activities from the last 7 days
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .collect();

        // Filter to last 7 days
        const recentLogs = logs.filter(log => log.createdAt >= sevenDaysAgo);

        // Group by day of week
        const dayMap = new Map<string, { users: Set<string>; actions: Set<string> }>();
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        // Initialize all days with empty sets
        dayOrder.forEach(day => {
            dayMap.set(day, { users: new Set(), actions: new Set() });
        });

        recentLogs.forEach((log) => {
            const date = new Date(log.createdAt);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            if (dayMap.has(day)) {
                const entry = dayMap.get(day)!;
                entry.users.add(log.userId);
                entry.actions.add(log.action);
            }
        });

        // Convert to array format for the chart
        const activityData = Array.from(dayMap.entries()).map(([label, data]) => ({
            label,
            users: data.users.size,
            active: data.actions.size,
        }));

        return activityData;
    },
});

// --- Get activity count by date range ---
export const getActivityCountByDateRange = query({
    args: {
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        let logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .collect();

        if (args.startDate) {
            logs = logs.filter(log => log.createdAt >= args.startDate!);
        }
        if (args.endDate) {
            logs = logs.filter(log => log.createdAt <= args.endDate!);
        }

        return logs.length;
    },
});