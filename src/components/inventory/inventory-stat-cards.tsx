import { Package, Layers, Store, AlertTriangle, Box } from 'lucide-react'
import { StatCard } from '#/components/general/stat-cards'
import type { InventoryStats } from '#/types/inventory'
import { formatCurrency } from './inventory-utils'

interface InventoryStatCardsProps {
    stats: InventoryStats
    isLoading: boolean
}

export function InventoryStatCards({ stats, isLoading }: InventoryStatCardsProps) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
                title="Total Products"
                value={stats.totalProducts}
                icon={Package}
                loading={isLoading}
            />
            <StatCard
                title="Total Stock"
                value={stats.totalStock}
                icon={Layers}
                loading={isLoading}
            />
            <StatCard
                title="Inventory Value"
                value={formatCurrency(stats.totalValue)}
                icon={Store}
                loading={isLoading}
            />
            <StatCard
                title="Low Stock"
                value={stats.lowStockCount}
                icon={AlertTriangle}
                loading={isLoading}
                description={stats.lowStockCount > 0 ? 'Items below reorder level' : 'All stock levels healthy'}
                className={stats.lowStockCount > 0 ? 'border-yellow-500' : ''}
            />
            <StatCard
                title="Batches"
                value={stats.batchCount}
                icon={Box}
                loading={isLoading}
            />
        </div>
    )
}