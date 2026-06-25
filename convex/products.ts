import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./utils";
import { internal } from "./_generated/api";

const sizePricingValidator = v.array(v.object({
    size: v.string(),
    costPrice: v.number(),
    sellingPrice: v.number(),
}));

function validateSizePricing(sizePricing: { size: string; costPrice: number; sellingPrice: number }[] | undefined) {
    if (!sizePricing) return;
    const seen = new Set<string>();
    for (const row of sizePricing) {
        if (!row.size.trim()) {
            throw new Error("Each size pricing row must have a size name");
        }
        if (seen.has(row.size)) {
            throw new Error(`Duplicate size pricing entry for "${row.size}"`);
        }
        seen.add(row.size);
        if (row.costPrice < 0 || row.sellingPrice < 0) {
            throw new Error(`Prices for size "${row.size}" cannot be negative`);
        }
        if (row.sellingPrice < row.costPrice) {
            throw new Error(`Selling price for size "${row.size}" cannot be lower than its cost price`);
        }
    }
}

export const getAllProducts = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);
        return await ctx.db.query("products").collect();
    },
});

export const getAllProductsWithDetails = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const products = await ctx.db.query("products").collect();

        const productsWithDetails = await Promise.all(
            products.map(async (product) => {
                const category = await ctx.db.get(product.categoryId);
                const department = await ctx.db.get(product.departmentId);

                const batches = await ctx.db
                    .query("batches")
                    .withIndex("by_product", (q) => q.eq("productId", product._id))
                    .collect();

                const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

                const saleItems = await ctx.db
                    .query("saleItems")
                    .withIndex("by_product", (q) => q.eq("productId", product._id))
                    .collect();

                const totalSales = saleItems.reduce((sum, item) => sum + item.quantity, 0);

                return {
                    ...product,
                    category: category || null,
                    department: department || null,
                    totalStock,
                    totalSales,
                    storeCount: batches.length > 0 ? new Set(batches.map(b => b.storeId)).size : 0,
                };
            })
        );

        return productsWithDetails;
    },
});

export const getProductActivityStats = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager"]);

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_created")
            .order("desc")
            .collect();

        const productLogs = logs.filter(log =>
            log.entityType === "products" ||
            log.action.includes("product")
        );

        const recentLogs = productLogs.filter(log => log.createdAt >= sevenDaysAgo);

        const dayMap = new Map<string, {
            created: number,
            updated: number,
            deleted: number,
            deactivated: number,
            reactivated: number,
        }>();
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        dayOrder.forEach(day => {
            dayMap.set(day, { created: 0, updated: 0, deleted: 0, deactivated: 0, reactivated: 0 });
        });

        recentLogs.forEach((log) => {
            const date = new Date(log.createdAt);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            if (dayMap.has(day)) {
                const entry = dayMap.get(day)!;
                if (log.action === "product.create") entry.created++;
                else if (log.action === "product.update") entry.updated++;
                else if (log.action === "product.delete") entry.deleted++;
                else if (log.action === "product.deactivate") entry.deactivated++;
                else if (log.action === "product.reactivate") entry.reactivated++;
            }
        });

        const activityData = Array.from(dayMap.entries()).map(([label, data]) => ({
            label,
            Created: data.created,
            Updated: data.updated,
            Deleted: data.deleted,
            Deactivated: data.deactivated,
            Reactivated: data.reactivated,
        }));

        return activityData;
    },
});

export const getActiveProducts = query({
    args: {},
    handler: async (ctx) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const products = await ctx.db.query("products").collect();
        return products.filter((product) => product.isActive);
    },
});

export const getProductById = query({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        return product;
    },
});

export const getProductBySku = query({
    args: { sku: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        return await ctx.db
            .query("products")
            .withIndex("by_sku", (q) => q.eq("sku", args.sku))
            .first();
    },
});

export const getProductsByCategory = query({
    args: { categoryId: v.id("categories") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        return await ctx.db
            .query("products")
            .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
            .collect();
    },
});

export const getProductsByDepartment = query({
    args: { departmentId: v.id("departments") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        return await ctx.db
            .query("products")
            .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
            .collect();
    },
});

export const getProductWithDetails = query({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        const category = await ctx.db.get(product.categoryId);
        const department = await ctx.db.get(product.departmentId);

        const batches = await ctx.db
            .query("batches")
            .withIndex("by_product", (q) => q.eq("productId", product._id))
            .collect();

        const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

        return {
            ...product,
            category: category || null,
            department: department || null,
            totalStock,
        };
    },
});

export const searchProducts = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, args) => {
        await requireRole(ctx, ["super_admin", "admin", "manager", "cashier"]);

        const products = await ctx.db.query("products").collect();
        const term = args.searchTerm.toLowerCase();

        return products.filter((product) => {
            const matchesName = product.name.toLowerCase().includes(term);
            const matchesSku = product.sku.toLowerCase().includes(term);
            const matchesSize = product.sizes?.some(s => s.toLowerCase().includes(term)) || false;
            const matchesColor = product.colors?.some(c => c.toLowerCase().includes(term)) || false;
            const matchesVariant = product.variants?.some(v => v.toLowerCase().includes(term)) || false;

            return matchesName || matchesSku || matchesSize || matchesColor || matchesVariant;
        });
    },
});

export const createProduct = mutation({
    args: {
        name: v.string(),
        sku: v.string(),
        categoryId: v.id("categories"),
        departmentId: v.id("departments"),
        sizes: v.optional(v.array(v.string())),
        colors: v.optional(v.array(v.string())),
        variants: v.optional(v.array(v.string())),
        sizePricing: v.optional(sizePricingValidator),
        costPrice: v.number(),
        sellingPrice: v.number(),
        description: v.optional(v.string()),
        isActive: v.boolean(),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        if (args.costPrice < 0 || args.sellingPrice < 0) {
            throw new Error("Prices cannot be negative");
        }
        if (args.sellingPrice < args.costPrice) {
            throw new Error("Selling price cannot be lower than cost price");
        }

        validateSizePricing(args.sizePricing);

        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");

        const department = await ctx.db.get(args.departmentId);
        if (!department) throw new Error("Department not found");

        if (category.departmentId !== args.departmentId) {
            throw new Error("Category does not belong to the specified department");
        }

        const existingSku = await ctx.db
            .query("products")
            .withIndex("by_sku", (q) => q.eq("sku", args.sku))
            .first();
        if (existingSku) throw new Error("A product with this SKU already exists");

        const productId = await ctx.db.insert("products", {
            name: args.name,
            sku: args.sku,
            categoryId: args.categoryId,
            departmentId: args.departmentId,
            sizes: args.sizes,
            colors: args.colors,
            variants: args.variants,
            sizePricing: args.sizePricing,
            costPrice: args.costPrice,
            sellingPrice: args.sellingPrice,
            description: args.description,
            isActive: args.isActive,
        });

        const sizeInfo = args.sizes?.length ? ` Sizes: ${args.sizes.join(', ')}` : '';
        const colorInfo = args.colors?.length ? ` Colors: ${args.colors.join(', ')}` : '';
        const pricingInfo = args.sizePricing?.length
            ? ` Size pricing: ${args.sizePricing.map(p => `${p.size}=R${p.sellingPrice.toFixed(2)}`).join(', ')}`
            : '';

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "product.create",
            entityType: "products",
            entityId: productId.toString(),
            description: `Created product "${args.name}" (SKU: ${args.sku})${sizeInfo}${colorInfo}${pricingInfo} in category "${category.name}"`,
        });

        return productId;
    },
});

export const updateProduct = mutation({
    args: {
        productId: v.id("products"),
        name: v.optional(v.string()),
        sku: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        departmentId: v.optional(v.id("departments")),
        sizes: v.optional(v.array(v.string())),
        colors: v.optional(v.array(v.string())),
        variants: v.optional(v.array(v.string())),
        sizePricing: v.optional(sizePricingValidator),
        costPrice: v.optional(v.number()),
        sellingPrice: v.optional(v.number()),
        description: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        const nextCostPrice = args.costPrice ?? product.costPrice;
        const nextSellingPrice = args.sellingPrice ?? product.sellingPrice;

        if (nextCostPrice < 0 || nextSellingPrice < 0) {
            throw new Error("Prices cannot be negative");
        }
        if (nextSellingPrice < nextCostPrice) {
            throw new Error("Selling price cannot be lower than cost price");
        }

        if (args.sizePricing !== undefined) {
            validateSizePricing(args.sizePricing);
        }

        const nextCategoryId = args.categoryId ?? product.categoryId;
        const nextDepartmentId = args.departmentId ?? product.departmentId;

        if (args.categoryId !== undefined || args.departmentId !== undefined) {
            const category = await ctx.db.get(nextCategoryId);
            if (!category) throw new Error("Category not found");

            const department = await ctx.db.get(nextDepartmentId);
            if (!department) throw new Error("Department not found");

            if (category.departmentId !== nextDepartmentId) {
                throw new Error("Category does not belong to the specified department");
            }
        }

        if (args.sku !== undefined && args.sku !== product.sku) {
            const existingSku = await ctx.db
                .query("products")
                .withIndex("by_sku", (q) => q.eq("sku", args.sku as string))
                .first();
            if (existingSku) throw new Error("A product with this SKU already exists");
        }

        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.sku !== undefined) updates.sku = args.sku;
        if (args.categoryId !== undefined) updates.categoryId = args.categoryId;
        if (args.departmentId !== undefined) updates.departmentId = args.departmentId;
        if (args.sizes !== undefined) updates.sizes = args.sizes;
        if (args.colors !== undefined) updates.colors = args.colors;
        if (args.variants !== undefined) updates.variants = args.variants;
        if (args.sizePricing !== undefined) updates.sizePricing = args.sizePricing;
        if (args.costPrice !== undefined) updates.costPrice = args.costPrice;
        if (args.sellingPrice !== undefined) updates.sellingPrice = args.sellingPrice;
        if (args.description !== undefined) updates.description = args.description;
        if (args.isActive !== undefined) updates.isActive = args.isActive;

        if (Object.keys(updates).length === 0) return true;

        await ctx.db.patch(args.productId, updates);

        const category = await ctx.db.get(nextCategoryId);
        const sizeInfo = args.sizes?.length ? ` Sizes: ${args.sizes.join(', ')}` : '';

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "product.update",
            entityType: "products",
            entityId: args.productId.toString(),
            description: `Updated product "${product.name}" (SKU: ${product.sku})${sizeInfo}${category ? ` in category "${category.name}"` : ''}`,
        });

        return true;
    },
});

export const deactivateProduct = mutation({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        await ctx.db.patch(args.productId, { isActive: false });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "product.deactivate",
            entityType: "products",
            entityId: args.productId.toString(),
            description: `Deactivated product "${product.name}" (SKU: ${product.sku})`,
        });

        return true;
    },
});

export const reactivateProduct = mutation({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        await ctx.db.patch(args.productId, { isActive: true });

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "product.reactivate",
            entityType: "products",
            entityId: args.productId.toString(),
            description: `Reactivated product "${product.name}" (SKU: ${product.sku})`,
        });

        return true;
    },
});

export const deleteProduct = mutation({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        const product = await ctx.db.get(args.productId);
        if (!product) throw new Error("Product not found");

        const batch = await ctx.db
            .query("batches")
            .withIndex("by_product", (q) => q.eq("productId", args.productId))
            .first();
        if (batch) throw new Error("Cannot delete a product with existing batch/stock records");

        await ctx.db.delete(args.productId);

        await ctx.runMutation(internal.activities.logActivity, {
            userId: currentUser._id,
            role: currentUser.role,
            action: "product.delete",
            entityType: "products",
            entityId: args.productId.toString(),
            description: `Deleted product "${product.name}" (SKU: ${product.sku})`,
        });

        return true;
    },
});

export const seedProducts = mutation({
    args: {
        products: v.array(
            v.object({
                name: v.string(),
                sku: v.string(),
                categoryId: v.id("categories"),
                departmentId: v.id("departments"),
                sizes: v.optional(v.array(v.string())),
                colors: v.optional(v.array(v.string())),
                variants: v.optional(v.array(v.string())),
                sizePricing: v.optional(
                    v.array(
                        v.object({
                            size: v.string(),
                            costPrice: v.number(),
                            sellingPrice: v.number(),
                        })
                    )
                ),
                costPrice: v.number(),
                sellingPrice: v.number(),
                description: v.optional(v.string()),
                isActive: v.boolean(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const currentUser = await requireRole(ctx, ["super_admin", "admin"]);

        let createdCount = 0;
        let skippedCount = 0;

        for (const productData of args.products) {
            // Check if SKU already exists
            const existingSku = await ctx.db
                .query("products")
                .withIndex("by_sku", (q) => q.eq("sku", productData.sku))
                .first();

            if (existingSku) {
                skippedCount++;
                continue;
            }

            // Verify category exists
            const category = await ctx.db.get(productData.categoryId);
            if (!category) {
                throw new Error(`Category with ID ${productData.categoryId} not found for product ${productData.name}`);
            }

            // Verify department exists
            const department = await ctx.db.get(productData.departmentId);
            if (!department) {
                throw new Error(`Department with ID ${productData.departmentId} not found for product ${productData.name}`);
            }

            // Verify category belongs to department
            if (category.departmentId !== productData.departmentId) {
                throw new Error(
                    `Category "${category.name}" does not belong to department "${department.name}" for product ${productData.name}`
                );
            }

            // Validate prices
            if (productData.costPrice < 0 || productData.sellingPrice < 0) {
                throw new Error(`Prices for product ${productData.name} cannot be negative`);
            }
            if (productData.sellingPrice < productData.costPrice) {
                throw new Error(`Selling price for product ${productData.name} cannot be lower than cost price`);
            }

            // Validate size pricing if provided
            if (productData.sizePricing) {
                const seen = new Set<string>();
                for (const row of productData.sizePricing) {
                    if (!row.size.trim()) {
                        throw new Error(`Each size pricing row must have a size name for product ${productData.name}`);
                    }
                    if (seen.has(row.size)) {
                        throw new Error(`Duplicate size pricing entry for "${row.size}" in product ${productData.name}`);
                    }
                    seen.add(row.size);
                    if (row.costPrice < 0 || row.sellingPrice < 0) {
                        throw new Error(`Prices for size "${row.size}" in product ${productData.name} cannot be negative`);
                    }
                    if (row.sellingPrice < row.costPrice) {
                        throw new Error(`Selling price for size "${row.size}" cannot be lower than cost price for product ${productData.name}`);
                    }
                }
            }

            // Create the product
            const productId = await ctx.db.insert("products", {
                name: productData.name,
                sku: productData.sku,
                categoryId: productData.categoryId,
                departmentId: productData.departmentId,
                sizes: productData.sizes,
                colors: productData.colors,
                variants: productData.variants,
                sizePricing: productData.sizePricing,
                costPrice: productData.costPrice,
                sellingPrice: productData.sellingPrice,
                description: productData.description,
                isActive: productData.isActive,
            });

            createdCount++;

            // Log the activity
            const sizeInfo = productData.sizes?.length ? ` Sizes: ${productData.sizes.join(', ')}` : '';
            const colorInfo = productData.colors?.length ? ` Colors: ${productData.colors.join(', ')}` : '';

            await ctx.runMutation(internal.activities.logActivity, {
                userId: currentUser._id,
                role: currentUser.role,
                action: "product.create",
                entityType: "products",
                entityId: productId.toString(),
                description: `Seeded product "${productData.name}" (SKU: ${productData.sku})${sizeInfo}${colorInfo} in category "${category.name}"`,
            });
        }

        return {
            success: true,
            created: createdCount,
            skipped: skippedCount,
            message: `Successfully created ${createdCount} products${skippedCount > 0 ? `, ${skippedCount} skipped (duplicates)` : ''}`,
        };
    },
});

export const checkProductsSeeded = query({
    args: {},
    handler: async (ctx) => {
        const products = await ctx.db.query("products").collect();
        return {
            isSeeded: products.length > 0,
            count: products.length,
        };
    },
});