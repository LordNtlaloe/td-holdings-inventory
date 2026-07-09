import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getStoreInternal = internalQuery({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.storeId);
  },
});