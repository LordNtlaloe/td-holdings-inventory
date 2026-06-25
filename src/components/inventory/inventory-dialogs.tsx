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
import type { Department, Product, Batch, InventoryItemWithDetails } from '#/types/inventory'

interface AssignProductDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    departments?: Department[]
    unassignedProducts?: Product[]
    selectedDepartmentId: string | null
    selectedProductId: string | null
    reorderLevel: number
    onDepartmentChange: (value: string | null) => void
    onProductChange: (value: string | null) => void
    onReorderLevelChange: (value: number) => void
    onSubmit: () => void
    isLoading: boolean
    error?: string | null
}

export function AssignProductDialog({
    open,
    onOpenChange,
    departments,
    unassignedProducts,
    selectedDepartmentId,
    selectedProductId,
    reorderLevel,
    onDepartmentChange,
    onProductChange,
    onReorderLevelChange,
    onSubmit,
    isLoading,
    error,
}: AssignProductDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign Product to Store</DialogTitle>
                    <DialogDescription>
                        Add a product to this store's inventory catalog.
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
                            value={selectedDepartmentId || undefined}
                            onValueChange={(value) => onDepartmentChange(value === 'all' ? null : value)}
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
                            value={selectedProductId || undefined}
                            onValueChange={(value) => onProductChange(value || null)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a product" />
                            </SelectTrigger>
                            <SelectContent>
                                {!unassignedProducts || unassignedProducts.length === 0 ? (
                                    <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                        {selectedDepartmentId
                                            ? 'No products in this department'
                                            : 'No products available to assign'}
                                    </div>
                                ) : (
                                    unassignedProducts.map((product) => {
                                        const department = departments?.find(d => d._id === product.departmentId)
                                        return (
                                            <SelectItem key={product._id} value={product._id}>
                                                <div className="flex items-center gap-2">
                                                    <span>{product.name}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        ({product.sku})
                                                    </span>
                                                    {department && (
                                                        <Badge variant="outline" className="text-xs">
                                                            {department.name}
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
                        <Label>Reorder Level</Label>
                        <Input
                            type="number"
                            value={reorderLevel}
                            onChange={(e) => onReorderLevelChange(Number(e.target.value))}
                            min={0}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={isLoading}>
                        {isLoading ? 'Assigning...' : 'Assign Product'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

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
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Receive Batch</DialogTitle>
                    <DialogDescription>
                        Add a new batch of stock to inventory. Only products without a batch in the last 7 days are shown.
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
                            value={selectedDepartmentId || undefined}
                            onValueChange={(value) => onDepartmentChange(value === 'all' ? null : value)}
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
                            value={selectedProductId || undefined}
                            onValueChange={(value) => onProductChange(value || null)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a product" />
                            </SelectTrigger>
                            <SelectContent>
                                {!inventoryItems || inventoryItems.length === 0 ? (
                                    <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                        {selectedDepartmentId
                                            ? 'No eligible products in this department'
                                            : 'No eligible products — all have batches within the last 7 days'}
                                    </div>
                                ) : (
                                    inventoryItems.map((item) => {
                                        const eligible = isProductEligible(item.productId)
                                        return (
                                            <SelectItem 
                                                key={item.productId} 
                                                value={item.productId}
                                                disabled={!eligible}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{item.product?.name || 'Unknown'}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        ({item.product?.sku || ''})
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
                    <Button onClick={onSubmit} disabled={isLoading}>
                        {isLoading ? 'Receiving...' : 'Receive Batch'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface ReorderLevelDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    reorderLevel: number
    onReorderLevelChange: (value: number) => void
    onSubmit: () => void
    isLoading: boolean
    error?: string | null
}

export function ReorderLevelDialog({
    open,
    onOpenChange,
    reorderLevel,
    onReorderLevelChange,
    onSubmit,
    isLoading,
    error,
}: ReorderLevelDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set Reorder Level</DialogTitle>
                    <DialogDescription>
                        Set the minimum stock level for this product.
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
                        <Label>Reorder Level</Label>
                        <Input
                            type="number"
                            value={reorderLevel}
                            onChange={(e) => onReorderLevelChange(Number(e.target.value))}
                            min={0}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={isLoading}>
                        {isLoading ? 'Saving...' : 'Save'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface AdjustBatchDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    batch: Batch | null
    adjustQuantity: number
    adjustReason: string
    onQuantityChange: (value: number) => void
    onReasonChange: (value: string) => void
    onSubmit: () => void
    isLoading: boolean
    error?: string | null
}

export function AdjustBatchDialog({
    open,
    onOpenChange,
    adjustQuantity,
    adjustReason,
    onQuantityChange,
    onReasonChange,
    onSubmit,
    isLoading,
    error,
}: AdjustBatchDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adjust Batch Quantity</DialogTitle>
                    <DialogDescription>
                        Update the quantity for this batch.
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
                        <Label>New Quantity</Label>
                        <Input
                            type="number"
                            value={adjustQuantity}
                            onChange={(e) => onQuantityChange(Number(e.target.value))}
                            min={0}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Reason (Optional)</Label>
                        <Input
                            value={adjustReason}
                            onChange={(e) => onReasonChange(e.target.value)}
                            placeholder="Why is this adjustment needed?"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={isLoading}>
                        {isLoading ? 'Updating...' : 'Update Quantity'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}