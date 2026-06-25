import { useQuery } from 'convex/react'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { XCircle, RotateCcw } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatCurrency, formatTimestamp, getStatusVariant } from './sales-utils'

interface SaleDetailSheetProps {
    saleId: Id<'sales'> | null
    open: boolean
    onClose: () => void
    canAction: boolean
    onVoid: (id: Id<'sales'>) => void
    onRefund: (id: Id<'sales'>) => void
}

export function SaleDetailSheet({
    saleId,
    open,
    onClose,
    canAction,
    onVoid,
    onRefund,
}: SaleDetailSheetProps) {
    const sale = useQuery(api.sales.getSaleById, saleId ? { saleId } : 'skip')

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                {sale === undefined ? (
                    <div className="space-y-4 pt-6">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-64" />
                        <Skeleton className="h-48 w-full" />
                    </div>
                ) : !sale ? (
                    <p className="pt-6 text-sm text-muted-foreground">Sale not found.</p>
                ) : (
                    <>
                        <SheetHeader className="mb-4">
                            <SheetTitle>Sale Detail</SheetTitle>
                            <SheetDescription>
                                {sale.store?.name ?? 'Unknown'} · {formatTimestamp(sale.createdAt)}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Customer</span>
                                <span>{sale.customer?.name ?? 'Walk-in'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Status</span>
                                <Badge variant={getStatusVariant(sale.status)}>{sale.status}</Badge>
                            </div>
                            <div className="flex justify-between font-medium">
                                <span className="text-muted-foreground">Total</span>
                                <span>{formatCurrency(sale.totalAmount)}</span>
                            </div>
                        </div>

                        <Separator className="my-4" />

                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Line Items
                        </p>
                        <div className="space-y-3">
                            {sale.items.map((item: any) => (
                                <div key={item._id} className="rounded-md border p-3 text-sm">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-medium">
                                            {item.product?.name ?? 'Unknown'}
                                        </span>
                                        <span className="shrink-0 font-medium">
                                            {formatCurrency(item.unitPrice * item.quantity)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                        <span>Qty: {item.quantity}</span>
                                        <span>Unit: {formatCurrency(item.unitPrice)}</span>
                                        {item.size && <span>Size: {item.size}</span>}
                                        {item.color && <span>Color: {item.color}</span>}
                                        {item.variant && <span>Variant: {item.variant}</span>}
                                    </div>
                                    {item.batches?.length > 0 && (
                                        <div className="mt-2 space-y-0.5">
                                            {item.batches.map((b: any) => (
                                                <div
                                                    key={b.batchId}
                                                    className="flex justify-between text-xs text-muted-foreground"
                                                >
                                                    <span>Batch {b.batchNumber ?? b.batchId}</span>
                                                    <span>×{b.quantity}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {canAction && sale.status === 'completed' && (
                            <>
                                <Separator className="my-4" />
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => onVoid(sale._id)}
                                    >
                                        <XCircle className="mr-1.5 h-4 w-4" />
                                        Void
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => onRefund(sale._id)}
                                    >
                                        <RotateCcw className="mr-1.5 h-4 w-4" />
                                        Refund
                                    </Button>
                                </div>
                            </>
                        )}
                    </>
                )}
            </SheetContent>
        </Sheet>
    )
}