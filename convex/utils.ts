import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Helper to get the currently authenticated user's document.
 */
export async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
        throw new Error("User not found");
    }

    return user;
}

/**
 * Helper to get the currently authenticated employee's document (if they are an employee).
 */
export async function getCurrentEmployee(ctx: QueryCtx | MutationCtx): Promise<Doc<"employees"> | null> {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        return null;
    }

    const employee = await ctx.db
        .query("employees")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();

    return employee || null;
}

/**
 * Helper to enforce role-based access control using the user's role from the users table.
 */
export async function requireRole(
    ctx: QueryCtx | MutationCtx,
    allowedRoles: Array<"super_admin" | "admin" | "manager" | "cashier">
): Promise<Doc<"users">> {
    const user = await getCurrentUser(ctx);
    
    if (!allowedRoles.includes(user.role)) {
        throw new Error("Unauthorized: Insufficient permissions");
    }
    
    return user;
}

/**
 * Helper to get current user with their employee information.
 */
export async function getCurrentUserWithEmployee(
    ctx: QueryCtx | MutationCtx
): Promise<{ user: Doc<"users">; employee: Doc<"employees"> | null }> {
    const user = await getCurrentUser(ctx);
    const employee = await getCurrentEmployee(ctx);
    
    return { user, employee };
}