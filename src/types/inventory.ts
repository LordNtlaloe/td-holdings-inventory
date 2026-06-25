import type { Doc } from "../../convex/_generated/dataModel"

export type Store = Doc<"stores">
export type Batch = Doc<"batches">
export type Product = Doc<"products">
export type Department = Doc<"departments">

export interface InventoryItemWithDetails {
    inventoryId: string
    productId: string
    product: Product | null
    quantity: number
    reorderLevel?: number
}

export interface InventoryStats {
    totalProducts: number
    totalStock: number
    totalValue: number
    lowStockCount: number
    outOfStockCount: number
    batchCount: number
}

export interface ReceiveBatchData {
    productId: string | null
    departmentId: string | null
    batchNumber: string
    quantity: number
    costPrice: number
}