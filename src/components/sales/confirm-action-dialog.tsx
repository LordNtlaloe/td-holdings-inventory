import { useState } from 'react'
import { useMutation } from 'convex/react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type ActionType = 'void' | 'refund' | 'cancel' | null

interface ConfirmActionDialogProps {
    action: ActionType
    saleId: Id<'sales'> | null
    onClose: () => void
}

export function ConfirmActionDialog({
    action,
    saleId,
    onClose,
}: ConfirmActionDialogProps) {
    const [loading, setLoading] = useState(false)
    const [cancelReason, setCancelReason] = useState('')
    const voidSale = useMutation(api.sales.voidSale)
    const refundSale = useMutation(api.sales.refundSale)
    const cancelSale = useMutation(api.sales.cancelSale)

    async function handleConfirm() {
        if (!saleId) return
        setLoading(true)
        try {
            if (action === 'void') {
                await voidSale({ saleId })
                toast.success('Sale voided', { description: 'Stock has been credited back.' })
            } else if (action === 'refund') {
                await refundSale({ saleId })
                toast.success('Sale refunded', { description: 'Stock has been restored.' })
            } else if (action === 'cancel') {
                if (!cancelReason.trim()) {
                    toast.error('Please provide a reason for cancellation')
                    setLoading(false)
                    return
                }
                const result = await cancelSale({
                    saleId,
                    reason: cancelReason.trim()
                })
                toast.success('Sale cancelled', {
                    description: result.message || 'Stock has been restored and original sale stored for reference.'
                })
            }
            onClose()
        } catch (err: any) {
            toast.error('Error', { description: err.message })
        } finally {
            setLoading(false)
        }
    }

    const getTitle = () => {
        if (action === 'void') return 'Void Sale'
        if (action === 'refund') return 'Refund Sale'
        if (action === 'cancel') return 'Cancel Sale'
        return ''
    }

    const getDescription = () => {
        if (action === 'void') {
            return 'This will mark the sale as voided and credit stock back to the original batches.'
        }
        if (action === 'refund') {
            return 'This will mark the sale as refunded and restore batch quantities.'
        }
        if (action === 'cancel') {
            return 'This will cancel the sale, restore stock, and store the original sale data for reference. A cancelled sale record will be created with all original details preserved.'
        }
        return ''
    }

    const getButtonText = () => {
        if (action === 'void') return 'Void Sale'
        if (action === 'refund') return 'Refund Sale'
        if (action === 'cancel') return 'Cancel Sale'
        return 'Confirm'
    }

    const getButtonVariant = () => {
        if (action === 'cancel') return 'destructive'
        if (action === 'void') return 'destructive'
        return 'default'
    }

    return (
        <Dialog open={!!action} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{getTitle()}</DialogTitle>
                    <DialogDescription>
                        {getDescription()}
                        {' '}This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                {action === 'cancel' && (
                    <div className="space-y-2">
                        <Label htmlFor="cancel-reason">Cancellation Reason</Label>
                        <Input
                            id="cancel-reason"
                            placeholder="Enter reason for cancellation..."
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            disabled={loading}
                        />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button
                        variant={getButtonVariant()}
                        onClick={handleConfirm}
                        disabled={loading || (action === 'cancel' && !cancelReason.trim())}
                    >
                        {loading
                            ? 'Processing…'
                            : getButtonText()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}