import { query, mutation, action, internalQuery } from "./_generated/server";
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

export const getStorePrintSettings = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
    const store = await ctx.db.get(args.storeId);
    if (!store) throw new Error("Store not found");
    return {
      printAgentId: store.printAgentId || null,
      storeName: store.name,
      storePhone: store.phone,
      storeAddress: store.address,
    };
  },
});

export const getAllStoresWithPrintAgents = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["super_admin", "admin"]);
    const stores = await ctx.db.query("stores").collect();
    return stores.map((store) => ({
      _id: store._id,
      name: store.name,
      printAgentId: store.printAgentId || null,
      isActive: store.isActive,
      phone: store.phone,
      address: store.address,
    }));
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
      printAgentId: undefined,
    });

    await ctx.runMutation(internal.activities.logActivity, {
      userId: currentUser._id,
      role: currentUser.role,
      action: "store.create",
      entityType: "stores",
      entityId: storeId.toString(),
      description: `Created store "${args.name}" (${args.type}) at ${args.address || "no address"}`,
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

export const updatePrintAgentId = mutation({
  args: {
    storeId: v.id("stores"),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

    const store = await ctx.db.get(args.storeId);
    if (!store) throw new Error("Store not found");

    await ctx.db.patch(args.storeId, {
      printAgentId: args.agentId,
    });

    await ctx.runMutation(internal.activities.logActivity, {
      userId: currentUser._id,
      role: currentUser.role,
      action: "store.updatePrintAgent",
      entityType: "stores",
      entityId: args.storeId.toString(),
      description: `Updated print agent ID for store "${store.name}" to ${args.agentId}`,
    });

    return { success: true };
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
      throw new Error(
        "Cannot deactivate a store with active employees. Transfer or deactivate them first."
      );
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
    if (employees)
      throw new Error("Cannot delete a store with assigned employees");

    const inventory = await ctx.db
      .query("inventory")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .first();
    if (inventory)
      throw new Error("Cannot delete a store with inventory records");

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

// FIXED: testPrintConnection - uses the health endpoint to check connected agents
export const testPrintConnection = action({
  args: {
    storeId: v.id("stores"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; message?: string; error?: string }> => {
    const store = await ctx.runQuery(internal.stores.getStoreInternal, {
      storeId: args.storeId,
    });

    if (!store) throw new Error("Store not found");

    if (!store.printAgentId) {
      return {
        success: false,
        error: "No printer agent configured for this store",
      };
    }

    const RELAY_URL = (process.env.RELAY_URL || "").trim();
    const RELAY_SECRET = (process.env.RELAY_SECRET || "").trim();

    if (!RELAY_URL || !RELAY_SECRET) {
      return {
        success: false,
        error: "Relay not configured",
      };
    }

    try {
      // Check the health endpoint to see which agents are connected
      const healthResponse = await fetch(`${RELAY_URL}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${RELAY_SECRET}`,
        },
      });

      if (!healthResponse.ok) {
        return {
          success: false,
          error: `Relay health check failed (${healthResponse.status})`,
        };
      }

      const healthData = await healthResponse.json();
      const connectedAgents: string[] = healthData.connectedAgents || [];
      
      // Check if our agent is in the connected list
      if (connectedAgents.includes(store.printAgentId)) {
        return { 
          success: true, 
          message: `Printer agent is online and connected! (${connectedAgents.length} agent(s) connected)` 
        };
      } else {
        return {
          success: false,
          error: `Printer agent "${store.printAgentId}" not found. Connected agents: ${connectedAgents.join(", ") || "none"}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  },
});

// FIXED: testPrint - sends a test print job using the /print endpoint
export const testPrint = action({
  args: {
    storeId: v.id("stores"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; message?: string; error?: string }> => {
    const store = await ctx.runQuery(internal.stores.getStoreInternal, {
      storeId: args.storeId,
    });

    if (!store) throw new Error("Store not found");

    if (!store.printAgentId) {
      return {
        success: false,
        error: "No printer agent configured for this store",
      };
    }

    const RELAY_URL = (process.env.RELAY_URL || "").trim();
    const RELAY_SECRET = (process.env.RELAY_SECRET || "").trim();

    if (!RELAY_URL || !RELAY_SECRET) {
      return {
        success: false,
        error: "Relay not configured",
      };
    }

    // Create a simple test receipt that the printer can handle
    const testReceiptData = `
==============================
      TEST PRINT
==============================
Store: ${store.name}
Agent ID: ${store.printAgentId}
Time: ${new Date().toLocaleString()}
==============================
This is a test print to verify
the printer connection is working
correctly.
==============================
Thank you for testing!
    `.trim();

    // The relay expects a base64 encoded string, but for test we can send plain text
    // or we can create a simple thermal receipt format
    const testData = Buffer.from(testReceiptData).toString("base64");

    try {
      const response = await fetch(`${RELAY_URL}/print/${store.printAgentId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RELAY_SECRET}`,
        },
        body: JSON.stringify({
          receiptData: testData,
          paymentMethod: "Test",
        }),
      });

      if (response.ok) {
        return { success: true, message: "Test print sent successfully!" };
      } else {
        const errorText = await response.text();
        return {
          success: false,
          error: `Test print failed (${response.status}): ${errorText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Test print failed",
      };
    }
  },
});