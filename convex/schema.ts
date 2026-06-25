import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("super_admin"), v.literal("admin"), v.literal("manager"), v.literal("cashier")),
    storeId: v.optional(v.id("stores")),
    image: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"), v.literal("banned"))),
  }).index("by_email", ["email"]),

  employees: defineTable({
    userId: v.id("users"),
    storeId: v.id("stores"),
    role: v.union(
      v.literal("super_admin"),
      v.literal("admin"),
      v.literal("manager"),
      v.literal("cashier")
    ),
    isActive: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_store", ["storeId"]),

  stores: defineTable({
    name: v.string(),
    type: v.union(v.literal("central"), v.literal("branch")),
    address: v.optional(v.string()),
    phone: v.string(),
    xCoordinates: v.string(),
    yCoordinates: v.string(),
    isActive: v.boolean(),
  }).index("by_type", ["type"]),

  departments: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
  }),

  categories: defineTable({
    name: v.string(),
    departmentId: v.id("departments"),
    description: v.optional(v.string()),
  }).index("by_department", ["departmentId"]),

  products: defineTable({
    name: v.string(),
    sku: v.string(),
    categoryId: v.id("categories"),
    departmentId: v.id("departments"),
    sizes: v.optional(v.array(v.string())),
    colors: v.optional(v.array(v.string())),
    variants: v.optional(v.array(v.string())),
    sizePricing: v.optional(v.array(v.object({
      size: v.string(),
      costPrice: v.number(),
      sellingPrice: v.number(),
    }))),
    costPrice: v.number(),
    sellingPrice: v.number(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
  })
    .index("by_sku", ["sku"])
    .index("by_category", ["categoryId"])
    .index("by_department", ["departmentId"]),

  storeDepartments: defineTable({
    storeId: v.id("stores"),
    departmentId: v.id("departments"),
  })
    .index("by_store", ["storeId"])
    .index("by_department", ["departmentId"]),

  inventory: defineTable({
    storeId: v.id("stores"),
    productId: v.id("products"),
    reorderLevel: v.optional(v.number()),
  })
    .index("by_store", ["storeId"])
    .index("by_product", ["productId"])
    .index("by_store_and_product", ["storeId", "productId"]),

  batches: defineTable({
    productId: v.id("products"),
    storeId: v.id("stores"),
    batchNumber: v.string(),
    quantity: v.number(),
    costPrice: v.number(),
    receivedAt: v.number(),
  })
    .index("by_store_and_product", ["storeId", "productId"])
    .index("by_product", ["productId"])
    .index("by_store", ["storeId"]),

  transfers: defineTable({
    fromStoreId: v.id("stores"),
    toStoreId: v.id("stores"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_transit"),
      v.literal("received"),
      v.literal("cancelled")
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    receivedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_from_store", ["fromStoreId"])
    .index("by_to_store", ["toStoreId"]),

  transferItems: defineTable({
    transferId: v.id("transfers"),
    productId: v.id("products"),
    quantityRequested: v.number(),
    quantityReceived: v.optional(v.number()),
  }).index("by_transfer", ["transferId"]),

  transferItemBatches: defineTable({
    transferItemId: v.id("transferItems"),
    batchId: v.id("batches"),
    side: v.union(v.literal("source"), v.literal("destination")),
    quantity: v.number(),
  })
    .index("by_transfer_item", ["transferItemId"])
    .index("by_batch", ["batchId"]),

  transferDiscrepancies: defineTable({
    transferItemId: v.id("transferItems"),
    expectedQty: v.number(),
    receivedQty: v.number(),
    reason: v.string(),
    reportedBy: v.id("users"),
    reportedAt: v.number(),
  })
    .index("by_transfer_item", ["transferItemId"]),

  ledgerEntries: defineTable({
    storeId: v.id("stores"),
    type: v.union(v.literal("income"), v.literal("expense")),
    category: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
    referenceType: v.optional(v.union(v.literal("sale"), v.literal("purchase"), v.literal("manual"))),
    saleId: v.optional(v.id("sales")),
    purchaseId: v.optional(v.id("purchases")),
    date: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_type", ["type"])
    .index("by_date", ["date"]),

  purchases: defineTable({
    storeId: v.id("stores"),
    supplierId: v.optional(v.id("suppliers")),
    totalAmount: v.number(),
    status: v.union(v.literal("received"), v.literal("pending"), v.literal("cancelled")),
    createdAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_supplier", ["supplierId"]),

  purchaseItems: defineTable({
    purchaseId: v.id("purchases"),
    productId: v.id("products"),
    quantity: v.number(),
    costPrice: v.number(),
    batchNumber: v.string(),
    batchId: v.optional(v.id("batches")),
  })
    .index("by_purchase", ["purchaseId"])
    .index("by_product", ["productId"]),

  customers: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    loyaltyPoints: v.optional(v.number()),
    totalSpent: v.optional(v.number()),
    lastPurchaseAt: v.optional(v.number()),
    visitCount: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_name", ["name"]),

  suppliers: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  }),

  sales: defineTable({
    storeId: v.id("stores"),
    customerId: v.optional(v.id("customers")),
    totalAmount: v.number(),
    discountTotal: v.optional(v.number()),
    status: v.union(v.literal("completed"), v.literal("refunded"), v.literal("voided")),
    paymentMethod: v.union(
      v.literal("Cash"),
      v.literal("POS"),
      v.literal("Mpesa"),
      v.literal("Ecocash"),
      v.literal("Bank Transfer")
    ),
    amountReceived: v.optional(v.number()),
    changeDue: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_customer", ["customerId"]),

  saleItems: defineTable({
    saleId: v.id("sales"),
    productId: v.id("products"),
    quantity: v.number(),
    unitPrice: v.number(),
    size: v.optional(v.string()),
    color: v.optional(v.string()),
    variant: v.optional(v.string()),
  })
    .index("by_sale", ["saleId"])
    .index("by_product", ["productId"]),

  saleItemBatches: defineTable({
    saleItemId: v.id("saleItems"),
    batchId: v.id("batches"),
    quantity: v.number(),
  })
    .index("by_sale_item", ["saleItemId"])
    .index("by_batch", ["batchId"]),

  saleDiscounts: defineTable({
    saleId: v.id("sales"),
    productId: v.id("products"),
    discountAmount: v.number(),
    reason: v.optional(v.string()),
  }).index("by_sale", ["saleId"]),

  activityLogs: defineTable({
    userId: v.id("users"),
    role: v.string(),
    action: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    description: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_action", ["action"])
    .index("by_created", ["createdAt"]),
});