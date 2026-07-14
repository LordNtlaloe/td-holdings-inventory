import type { InventoryItemWithDetails, InventoryStats, Batch, Product } from '#/types/inventory'

export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function calculateInventoryStats(
    inventoryItems?: InventoryItemWithDetails[],
    lowStockItems?: any[],
    batches?: Batch[]
): InventoryStats {
    if (!inventoryItems) {
        return {
            totalProducts: 0,
            totalStock: 0,
            totalValue: 0,
            lowStockCount: 0,
            outOfStockCount: 0,
            batchCount: 0,
        }
    }

    const totalProducts = inventoryItems.length
    let totalStock = 0
    let totalValue = 0
    let outOfStockCount = 0

    inventoryItems.forEach((item) => {
        totalStock += item.quantity || 0
        totalValue += (item.quantity || 0) * (item.product?.costPrice || 0)
        if (item.quantity === 0) outOfStockCount++
    })

    return {
        totalProducts,
        totalStock,
        totalValue,
        lowStockCount: lowStockItems?.length || 0,
        outOfStockCount,
        batchCount: batches?.length || 0,
    }
}

export function isProductEligibleForBatch(
    productId: string,
    batches?: Batch[]
): boolean {
    if (!batches) return true
    const productBatches = batches.filter((b) => b.productId === productId)
    const lastBatch = productBatches.reduce<Batch | null>(
        (latest, b) => (!latest || b.receivedAt > latest.receivedAt ? b : latest),
        null
    )
    return !lastBatch || Date.now() - lastBatch.receivedAt >= ONE_WEEK_MS
}

export function generateBatchNumber(): string {
    return `BATCH-${Date.now()}`
}

export function getProductName(product?: Product | null): string {
    return product?.name || 'Unknown'
}

export function getProductSku(product?: Product | null): string {
    return product?.sku || ''
}

export function formatCurrency(amount: number): string {
    return `R${amount.toLocaleString('en-ZA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`
}

export function getStockStatus(
    quantity: number,
    reorderLevel: number
): { variant: 'default' | 'destructive' | 'secondary'; label: string } {
    const isOut = quantity === 0
    const isLow = quantity <= reorderLevel && reorderLevel > 0

    if (isOut) {
        return { variant: 'destructive', label: 'Out of Stock' }
    } else if (isLow) {
        return { variant: 'secondary', label: `${quantity} units (Low)` }
    }
    return { variant: 'default', label: `${quantity} units` }
}