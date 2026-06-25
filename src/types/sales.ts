import type { Id } from "../../convex/_generated/dataModel"

export type SaleStatus = 'completed' | 'refunded' | 'voided'

export interface Sale {
    _id: Id<'sales'>
    _creationTime: number
    createdAt: number
    storeId: Id<'stores'>
    store?: {
        _id: Id<'stores'>
        name: string
    }
    customer?: {
        _id: Id<'customers'>
        name: string
    }
    items: SaleItem[]
    status: SaleStatus
    totalAmount: number
    paymentMethod: string
}

export interface SaleItem {
    _id: Id<'saleItems'>
    productId: Id<'products'>
    product?: {
        _id: Id<'products'>
        name: string
    }
    quantity: number
    unitPrice: number
    size?: string
    color?: string
    variant?: string
    batches?: BatchAllocation[]
}

export interface BatchAllocation {
    batchId: string
    batchNumber?: string
    quantity: number
}

export interface SalesStats {
    totalRevenue: number
    salesCount: number
    avgOrderValue: number
    refundCount: number
    voidCount: number
}

export interface SalesFiltersType {
    status: string
    store: string
    search: string
    dateFrom: string
    dateTo: string
}