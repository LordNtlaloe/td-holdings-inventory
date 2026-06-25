import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { DataTable, type ColumnDef } from '#/components/general/data-table'
import { CheckCircle, Plus } from 'lucide-react'
import type { Product } from '#/types/inventory'

interface LowStockItem {
    _id: string
    productId: string
    product: Product | null
    quantity: number
    reorderLevel?: number
}

interface LowStockTableProps {
    items?: LowStockItem[]
    onReceiveStock: (productId: string) => void
}

function getProductName(product: Product | null): string {
    return product?.name || 'Unknown'
}

function getProductSku(product: Product | null): string {
    return product?.sku || ''
}

export function LowStockTable({ items, onReceiveStock }: LowStockTableProps) {
    const columns: ColumnDef<LowStockItem>[] = [
        {
            key: 'product',
            header: 'Product',
            cell: (row) => (
                <div>
                    <div className="font-medium">{getProductName(row.product)}</div>
                    <div className="text-xs text-muted-foreground">{getProductSku(row.product)}</div>
                </div>
            ),
        },
        {
            key: 'quantity',
            header: 'Current Stock',
            cell: (row) => (
                <span className="font-medium text-red-600">{row.quantity}</span>
            ),
        },
        {
            key: 'reorderLevel',
            header: 'Reorder Level',
            cell: (row) => row.reorderLevel || '—',
        },
        {
            key: 'status',
            header: 'Status',
            cell: (row) => (
                <Badge variant={row.quantity === 0 ? 'destructive' : 'default'}>
                    {row.quantity === 0 ? 'Out of Stock' : 'Low Stock'}
                </Badge>
            ),
        },
        {
            key: 'actions',
            header: 'Actions',
            cell: (row) => (
                <Button
                    size="sm"
                    onClick={() => onReceiveStock(row.productId)}
                >
                    <Plus className="mr-2 h-3 w-3" />
                    Receive Stock
                </Button>
            ),
        },
    ]

    if (!items || items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <p className="mt-4 text-lg font-medium">All stock levels are healthy</p>
                <p className="text-sm">No products are currently low on stock</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">Low Stock Items</h3>
                    <p className="text-sm text-muted-foreground">
                        Products that need restocking
                    </p>
                </div>
                <Badge variant="destructive" className="text-sm">
                    {items.length} items need restocking
                </Badge>
            </div>

            <DataTable
                data={items as any}
                columns={columns as any}
                rowKey="_id"
                loading={false}
                searchPlaceholder="Search low stock items..."
                emptyMessage="No low stock items found"
                pageSizeOptions={[5, 10, 25]}
                defaultPageSize={10}
                enableColumnVisibility={true}
            />
        </div>
    )
}