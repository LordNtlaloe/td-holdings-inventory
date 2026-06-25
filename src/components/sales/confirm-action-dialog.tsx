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
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type ActionType = 'void' | 'refund' | null

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
    const voidSale = useMutation(api.sales.voidSale)
    const refundSale = useMutation(api.sales.refundSale)

    async function handleConfirm() {
        if (!saleId) return
        setLoading(true)
        try {
            if (action === 'void') {
                await voidSale({ saleId })
                toast.success('Sale voided', { description: 'Stock has been credited back.' })
            } else {
                await refundSale({ saleId })
                toast.success('Sale refunded', { description: 'Stock has been restored.' })
            }
            onClose()
        } catch (err: any) {
            toast.error('Error', { description: err.message })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={!!action} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {action === 'void' ? 'Void Sale' : 'Refund Sale'}
                    </DialogTitle>
                    <DialogDescription>
                        {action === 'void'
                            ? 'This will mark the sale as voided and credit stock back to the original batches.'
                            : 'This will mark the sale as refunded and restore batch quantities.'}
                        {' '}This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleConfirm}
                        disabled={loading}
                    >
                        {loading
                            ? 'Processing…'
                            : action === 'void'
                                ? 'Void Sale'
                                : 'Refund Sale'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}