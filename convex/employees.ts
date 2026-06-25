import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { createAccount } from "@convex-dev/auth/server";

// ===============================
// QUERIES
// ===============================

export const getMyEmployeeRecord = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;

        const employee = await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first();

        if (!employee) return null;

        const store = await ctx.db.get(employee.storeId);
        const user = await ctx.db.get(employee.userId);

        return {
            ...employee,
            store: store || null,
            user: user || null,
        };
    },
});

export const getStoreEmployees = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (currentUser.role === "manager") {
            const employee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!employee || employee.storeId !== args.storeId) {
                throw new Error("Unauthorized: Cannot access employees of another store");
            }
        }

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const employeeDetails = await Promise.all(
            employees.map(async (employee) => {
                const user = await ctx.db.get(employee.userId);
                return {
                    ...employee,
                    user: user || null,
                };
            })
        );

        return employeeDetails.filter((emp) => emp.user !== null);
    },
});

export const getAllEmployees = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin"]);

        const employees = await ctx.db.query("employees").collect();

        const employeeDetails = await Promise.all(
            employees.map(async (employee) => {
                const user = await ctx.db.get(employee.userId);
                const store = await ctx.db.get(employee.storeId);
                return {
                    ...employee,
                    user: user || null,
                    store: store || null,
                };
            })
        );

        return employeeDetails.filter((emp) => emp.user !== null);
    },
});

export const getEmployeeById = query({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new Error("Employee not found");

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            const user = await ctx.db.get(employee.userId);
            const store = await ctx.db.get(employee.storeId);
            return {
                ...employee,
                user: user || null,
                store: store || null,
            };
        }

        if (currentUser.role === "manager") {
            const currentEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!currentEmployee || currentEmployee.storeId !== employee.storeId) {
                throw new Error("Unauthorized");
            }

            const user = await ctx.db.get(employee.userId);
            const store = await ctx.db.get(employee.storeId);
            return {
                ...employee,
                user: user || null,
                store: store || null,
            };
        }

        throw new Error("Unauthorized");
    },
});

export const getUsersByStore = query({
    args: { storeId: v.id("stores") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        if (currentUser.role === "manager") {
            const currentEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!currentEmployee || currentEmployee.storeId !== args.storeId) {
                throw new Error("Unauthorized");
            }
        }

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
            .collect();

        const usersWithEmployeeInfo = await Promise.all(
            employees.map(async (employee) => {
                const user = await ctx.db.get(employee.userId);
                return {
                    ...user,
                    employeeId: employee._id,
                    employeeRole: employee.role,
                    isActiveEmployee: employee.isActive,
                    storeId: employee.storeId,
                };
            })
        );

        return usersWithEmployeeInfo.filter((item) => item !== null);
    },
});

export const isUserEmployeeOfStore = query({
    args: {
        userId: v.id("users"),
        storeId: v.id("stores"),
    },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const employee = await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();

        return employee?.storeId === args.storeId && employee?.isActive === true;
    },
});

// ===============================
// MUTATIONS
// ===============================

// Internal — used by createEmployeeWithUser action after account creation.
export const insertEmployee = internalMutation({
    args: {
        userId: v.id("users"),
        storeId: v.id("stores"),
        role: v.union(
            v.literal("super_admin"),
            v.literal("admin"),
            v.literal("manager"),
            v.literal("cashier")
        ),
        isActive: v.boolean(),
        createdByUserId: v.id("users"),
        createdByRole: v.string(),
        storeName: v.string(),
        userEmail: v.string(),
    },
    handler: async (ctx, args) => {
        // Guard: user must not already be an employee
        const existingEmployee = await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();

        if (existingEmployee) {
            throw new Error("User is already an employee");
        }

        const employeeId = await ctx.db.insert("employees", {
            userId: args.userId,
            storeId: args.storeId,
            role: args.role,
            isActive: args.isActive,
        });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: args.createdByUserId,
            role: args.createdByRole,
            action: "employee.create",
            entityType: "employees",
            entityId: employeeId.toString(),
            description: `Added ${args.userEmail} as ${args.role} at store ${args.storeName}`,
        });

        return employeeId;
    },
});

export const updateEmployee = mutation({
    args: {
        employeeId: v.id("employees"),
        role: v.optional(v.union(
            v.literal("super_admin"),
            v.literal("admin"),
            v.literal("manager"),
            v.literal("cashier")
        )),
        isActive: v.optional(v.boolean()),
        storeId: v.optional(v.id("stores")),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new Error("Employee not found");

        const targetUser = await ctx.db.get(employee.userId);

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            const updates: any = {};
            if (args.role !== undefined) updates.role = args.role;
            if (args.isActive !== undefined) updates.isActive = args.isActive;
            if (args.storeId !== undefined) {
                const store = await ctx.db.get(args.storeId);
                if (!store) throw new Error("Store not found");
                updates.storeId = args.storeId;
            }

            await ctx.db.patch(args.employeeId, updates);

            await ctx.runMutation(internal.activities.logActivity, {
                userId: currentUser._id,
                role: currentUser.role,
                action: "employee.update",
                entityType: "employees",
                entityId: args.employeeId.toString(),
                description: `Updated employee ${targetUser?.email ?? args.employeeId}: ${JSON.stringify(updates)}`,
            });

            return true;
        }

        if (currentUser.role === "manager") {
            const currentEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!currentEmployee || currentEmployee.storeId !== employee.storeId) {
                throw new Error("Unauthorized");
            }

            const updates: any = {};
            if (args.isActive !== undefined) updates.isActive = args.isActive;
            if (args.role !== undefined) {
                if (args.role !== "cashier") {
                    throw new Error("Managers can only assign cashier role");
                }
                updates.role = args.role;
            }

            await ctx.db.patch(args.employeeId, updates);

            await ctx.runMutation(internal.activities.logActivity, {
                userId: currentUser._id,
                role: currentUser.role,
                action: "employee.update",
                entityType: "employees",
                entityId: args.employeeId.toString(),
                description: `Updated employee ${targetUser?.email ?? args.employeeId}: ${JSON.stringify(updates)}`,
            });

            return true;
        }

        throw new Error("Unauthorized");
    },
});

export const deactivateEmployee = mutation({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new Error("Employee not found");

        const targetUser = await ctx.db.get(employee.userId);

        if (currentUser.role === "super_admin" || currentUser.role === "admin") {
            await ctx.db.patch(args.employeeId, { isActive: false });

            await ctx.runMutation(internal.activities.logActivity, {
                userId: currentUser._id,
                role: currentUser.role,
                action: "employee.deactivate",
                entityType: "employees",
                entityId: args.employeeId.toString(),
                description: `Deactivated employee ${targetUser?.email ?? args.employeeId}`,
            });

            return true;
        }

        if (currentUser.role === "manager") {
            const currentEmployee = await ctx.db
                .query("employees")
                .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
                .first();

            if (!currentEmployee || currentEmployee.storeId !== employee.storeId) {
                throw new Error("Unauthorized");
            }

            if (currentEmployee._id === args.employeeId) {
                throw new Error("Cannot deactivate yourself");
            }

            await ctx.db.patch(args.employeeId, { isActive: false });

            await ctx.runMutation(internal.activities.logActivity, {
                userId: currentUser._id,
                role: currentUser.role,
                action: "employee.deactivate",
                entityType: "employees",
                entityId: args.employeeId.toString(),
                description: `Deactivated employee ${targetUser?.email ?? args.employeeId}`,
            });

            return true;
        }

        throw new Error("Unauthorized");
    },
});

export const reactivateEmployee = mutation({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new Error("Employee not found");

        const targetUser = await ctx.db.get(employee.userId);

        await ctx.db.patch(args.employeeId, { isActive: true });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "employee.reactivate",
            entityType: "employees",
            entityId: args.employeeId.toString(),
            description: `Reactivated employee ${targetUser?.email ?? args.employeeId}`,
        });

        return true;
    },
});

export const transferEmployee = mutation({
    args: {
        employeeId: v.id("employees"),
        toStoreId: v.id("stores"),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new Error("Employee not found");

        const destinationStore = await ctx.db.get(args.toStoreId);
        if (!destinationStore) throw new Error("Destination store not found");
        if (!destinationStore.isActive) throw new Error("Cannot transfer to an inactive store");

        if (employee.storeId === args.toStoreId) {
            throw new Error("Employee is already assigned to this store");
        }

        const targetUser = await ctx.db.get(employee.userId);
        const fromStore = await ctx.db.get(employee.storeId);

        await ctx.db.patch(args.employeeId, { storeId: args.toStoreId });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "employee.transfer",
            entityType: "employees",
            entityId: args.employeeId.toString(),
            description: `Transferred ${targetUser?.email ?? args.employeeId} from ${fromStore?.name ?? "unknown store"} to ${destinationStore.name}`,
        });

        return true;
    },
});

// ===============================
// ACTIONS
// ===============================

// Creates a user account with a default password of "user123" via
// Convex Auth's Password provider, then inserts the employees row.
// Must be an action (not mutation) because createAccount requires ActionCtx.
export const createEmployeeWithUser = action({
    args: {
        name: v.string(),
        email: v.string(),
        storeId: v.id("stores"),
        role: v.union(
            v.literal("super_admin"),
            v.literal("admin"),
            v.literal("manager"),
            v.literal("cashier")
        ),
        isActive: v.boolean(),
    },
    handler: async (ctx, args) => {
        // Auth check — actions can't use ctx.db directly; run as internal query.
        const currentUser = await ctx.runQuery(internal.users.getCurrentUserInternal);
        if (!currentUser) throw new Error("Not authenticated");

        const allowedRoles = ["super_admin", "admin", "manager"];
        if (!allowedRoles.includes(currentUser.role)) {
            throw new Error("Unauthorized");
        }

        // Managers can only create cashiers
        if (currentUser.role === "manager" && args.role !== "cashier") {
            throw new Error("Managers can only create cashier roles");
        }

        // Validate store exists and manager belongs to it
        const store = await ctx.runQuery(internal.stores.getStoreInternal, {
            storeId: args.storeId,
        });
        if (!store) throw new Error("Store not found");
        if (!store.isActive) throw new Error("Store is inactive");

        if (currentUser.role === "manager") {
            const myEmployee = await ctx.runQuery(internal.employees.getEmployeeByUserInternal, {
                userId: currentUser._id,
            });
            if (!myEmployee || myEmployee.storeId !== args.storeId) {
                throw new Error("Unauthorized: Cannot add employees to other stores");
            }
        }

        // Check email not already taken
        const existingUser = await ctx.runQuery(internal.users.getUserByEmailInternal, {
            email: args.email,
        });
        if (existingUser) {
            throw new Error(`A user with email "${args.email}" already exists`);
        }

        // Create the auth account + user row via Convex Auth.
        // The Password provider stores a Scrypt hash of the secret in authAccounts.
        const { user } = await createAccount(ctx, {
            provider: "password",
            account: {
                id: args.email,
                secret: "user123",
            },
            profile: {
                name: args.name,
                email: args.email,
                role: args.role,
            },
        });

        // Insert employees row
        await ctx.runMutation(internal.employees.insertEmployee, {
            userId: user._id,
            storeId: args.storeId,
            role: args.role,
            isActive: args.isActive,
            createdByUserId: currentUser._id,
            createdByRole: currentUser.role,
            storeName: store.name,
            userEmail: args.email,
        });

        return { userId: user._id };
    },
});

export const getEmployeeByUserInternal = internalQuery({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("employees")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();
    },
});