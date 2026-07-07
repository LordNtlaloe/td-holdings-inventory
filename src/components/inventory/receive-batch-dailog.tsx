import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import type { Department, InventoryItemWithDetails } from '#/types/inventory'

interface ReceiveBatchDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    departments?: Department[]
    inventoryItems?: InventoryItemWithDetails[]
    selectedDepartmentId: string | null
    selectedProductId: string | null
    batchNumber: string
    batchQuantity: number
    batchCostPrice: number
    onDepartmentChange: (value: string | null) => void
    onProductChange: (value: string | null) => void
    onBatchNumberChange: (value: string) => void
    onBatchQuantityChange: (value: number) => void
    onBatchCostPriceChange: (value: number) => void
    onSubmit: () => void
    isLoading: boolean
    error?: string | null
    isProductEligible: (productId: string) => boolean
}

export function ReceiveBatchDialog({
    open,
    onOpenChange,
    departments,
    inventoryItems,
    selectedDepartmentId,
    selectedProductId,
    batchNumber,
    batchQuantity,
    batchCostPrice,
    onDepartmentChange,
    onProductChange,
    onBatchNumberChange,
    onBatchQuantityChange,
    onBatchCostPriceChange,
    onSubmit,
    isLoading,
    error,
    isProductEligible,
}: ReceiveBatchDialogProps) {
    // Filter inventory items by selected department
    const filteredItems = selectedDepartmentId
        ? inventoryItems?.filter(item => item.product?.departmentId === selectedDepartmentId)
        : inventoryItems

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Receive Batch</DialogTitle>
                    <DialogDescription>
                        Add a new batch of stock to inventory.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="space-y-2">
                        <Label>Filter by Department</Label>
                        <Select
                            value={selectedDepartmentId || 'all'}
                            onValueChange={(value) => {
                                onDepartmentChange(value === 'all' ? null : value)
                                // Reset product selection when department changes
                                if (value !== selectedDepartmentId) {
                                    onProductChange(null)
                                }
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="All Departments" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Departments</SelectItem>
                                {departments?.map((department) => (
                                    <SelectItem key={department._id} value={department._id}>
                                        {department.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Product</Label>
                        <Select
                            value={selectedProductId || ''}
                            onValueChange={(value) => onProductChange(value || null)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a product" />
                            </SelectTrigger>
                            <SelectContent>
                                {!filteredItems || filteredItems.length === 0 ? (
                                    <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                        {selectedDepartmentId && selectedDepartmentId !== 'all'
                                            ? 'No products in this department'
                                            : 'No products available'}
                                    </div>
                                ) : (
                                    filteredItems.map((item) => {
                                        const eligible = item.product ? isProductEligible(item.productId) : false
                                        const productName = item.product?.name || 'Unknown Product'
                                        const sku = item.product?.sku || ''
                                        return (
                                            <SelectItem
                                                key={item.productId}
                                                value={item.productId}
                                                disabled={!eligible}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{productName}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        ({sku})
                                                    </span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {item.quantity || 0} in stock
                                                    </Badge>
                                                    {!eligible && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            Recent batch
                                                        </Badge>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        )
                                    })
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Batch Number</Label>
                        <Input
                            value={batchNumber}
                            onChange={(e) => onBatchNumberChange(e.target.value)}
                            placeholder="Enter batch number"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Quantity</Label>
                        <Input
                            type="number"
                            value={batchQuantity}
                            onChange={(e) => onBatchQuantityChange(Number(e.target.value))}
                            min={1}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Cost Price per Unit</Label>
                        <Input
                            type="number"
                            value={batchCostPrice}
                            onChange={(e) => onBatchCostPriceChange(Number(e.target.value))}
                            min={0}
                            step={0.01}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={isLoading || !selectedProductId}>
                        {isLoading ? 'Receiving...' : 'Receive Batch'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}