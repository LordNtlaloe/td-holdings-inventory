import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { useState, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { toast } from 'sonner'
import AppLayout from '#/layouts/app-layout'
import { api } from '../../../../convex/_generated/api'
import {
  InventoryStatCards,
  InventoryStoreSelector,
  InventoryTable,
  BatchesTable,
  LowStockTable,
  AssignProductDialog,
  ReceiveBatchDialog,
  ReorderLevelDialog,
  AdjustBatchDialog,
  generateBatchNumber,
  isProductEligibleForBatch,
  calculateInventoryStats,
  type Batch,
} from '#/components/inventory'

export const Route = createFileRoute('/dashboard/inventory/')({
  component: RouteComponent,
})

function RouteComponent() {
  // State
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [reorderDialogOpen, setReorderDialogOpen] = useState(false)
  const [receiveBatchDialogOpen, setReceiveBatchDialogOpen] = useState(false)
  const [adjustQuantityDialogOpen, setAdjustQuantityDialogOpen] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)
  const [searchTerm] = useState('')
  const [batchProductId, setBatchProductId] = useState<string | null>(null)
  const [batchDepartmentId, setBatchDepartmentId] = useState<string | null>(null)

  // Error states
  const [assignError, setAssignError] = useState<string | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [receiveBatchError, setReceiveBatchError] = useState<string | null>(null)
  const [adjustBatchError, setAdjustBatchError] = useState<string | null>(null)

  // Form state
  const [reorderLevel, setReorderLevel] = useState<number>(5)
  const [batchNumber, setBatchNumber] = useState('')
  const [batchQuantity, setBatchQuantity] = useState<number>(1)
  const [batchCostPrice, setBatchCostPrice] = useState<number>(0)
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0)
  const [adjustReason, setAdjustReason] = useState('')

  // Loading states
  const [assigning, setAssigning] = useState(false)
  const [updatingReorder, setUpdatingReorder] = useState(false)
  const [receivingBatch, setReceivingBatch] = useState(false)
  const [adjustingBatch, setAdjustingBatch] = useState(false)

  // Queries
  const stores = useQuery(api.stores.getAllStores)
  const departments = useQuery(api.departments.getAllDepartments)
  const inventoryItems = useQuery(api.inventory.getInventoryByStore,
    selectedStoreId ? { storeId: selectedStoreId as any } : 'skip'
  )
  const unassignedProducts = useQuery(api.inventory.getUnassignedProducts,
    selectedStoreId ? { storeId: selectedStoreId as any } : 'skip'
  )
  const batches = useQuery(api.batches.getBatchesByStore,
    selectedStoreId ? { storeId: selectedStoreId as any } : 'skip'
  )
  const lowStockItems = useQuery(api.inventory.getLowStock,
    selectedStoreId ? { storeId: selectedStoreId as any } : 'skip'
  )
  const allProducts = useQuery(api.products.getAllProducts)

  // Mutations
  const assignProduct = useMutation(api.inventory.assignProductToStore)
  const setReorderLevelMutation = useMutation(api.inventory.setReorderLevel)
  const removeProductFromStore = useMutation(api.inventory.removeProductFromStore)
  const receiveBatch = useMutation(api.batches.receiveBatch)
  const adjustBatchQuantity = useMutation(api.batches.adjustBatchQuantity)
  const deleteBatch = useMutation(api.batches.deleteBatch)

  // Stats
  const stats = useMemo(() => {
    return calculateInventoryStats(inventoryItems, lowStockItems, batches)
  }, [inventoryItems, lowStockItems, batches])

  const isLoading = inventoryItems === undefined || stores === undefined

  // Filter unassigned products by selected department
  const filteredUnassignedProducts = useMemo(() => {
    if (!unassignedProducts) return []
    if (!selectedDepartmentId) return unassignedProducts
    return unassignedProducts.filter(p => p.departmentId === selectedDepartmentId)
  }, [unassignedProducts, selectedDepartmentId])

  // Filter inventory items for the Receive Batch dialog
  const filteredInventoryItems = useMemo(() => {
    if (!inventoryItems) return []
    return inventoryItems.filter((item) => {
      if (batchDepartmentId && item.product?.departmentId !== batchDepartmentId) return false
      return true
    })
  }, [inventoryItems, batchDepartmentId])

  // Handlers
  const handleAssignProduct = async () => {
    if (!selectedStoreId || !selectedProductId) {
      toast.error('Please select a store and product')
      return
    }

    setAssigning(true)
    setAssignError(null)

    try {
      await assignProduct({
        storeId: selectedStoreId as any,
        productId: selectedProductId as any,
        reorderLevel: reorderLevel,
      })
      toast.success('Product assigned to store successfully')
      setAssignDialogOpen(false)
      setSelectedProductId(null)
      setSelectedDepartmentId(null)
      setReorderLevel(5)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to assign product'
      setAssignError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setAssigning(false)
    }
  }

  const handleSetReorderLevel = async () => {
    if (!selectedStoreId || !selectedProductId) {
      toast.error('Please select a store and product')
      return
    }

    setUpdatingReorder(true)
    setReorderError(null)

    try {
      await setReorderLevelMutation({
        storeId: selectedStoreId as any,
        productId: selectedProductId as any,
        reorderLevel: reorderLevel,
      })
      toast.success('Reorder level updated successfully')
      setReorderDialogOpen(false)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update reorder level'
      setReorderError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setUpdatingReorder(false)
    }
  }

  const openReceiveBatchDialog = (productId?: string, suggestedQuantity = 1) => {
    const eligible = productId ? isProductEligibleForBatch(productId, batches) : true
    const resolvedProductId = eligible ? (productId ?? null) : null

    setBatchProductId(resolvedProductId)
    setBatchDepartmentId(null)
    setBatchNumber(generateBatchNumber())
    setBatchQuantity(suggestedQuantity)

    const product = resolvedProductId
      ? inventoryItems?.find((item) => item.productId === resolvedProductId)?.product
      : null
    setBatchCostPrice(product?.costPrice || 0)
    setReceiveBatchError(null)
    setReceiveBatchDialogOpen(true)
  }

  const handleReceiveBatch = async () => {
    if (!selectedStoreId) {
      toast.error('Please select a store first')
      return
    }

    if (!batchProductId) {
      toast.error('Please select a product')
      return
    }

    if (!batchNumber.trim()) {
      toast.error('Batch number is required')
      return
    }

    if (batchQuantity <= 0) {
      toast.error('Quantity must be greater than 0')
      return
    }

    if (batchCostPrice < 0) {
      toast.error('Cost price cannot be negative')
      return
    }

    setReceivingBatch(true)
    setReceiveBatchError(null)

    try {
      await receiveBatch({
        storeId: selectedStoreId as any,
        productId: batchProductId as any,
        batchNumber: batchNumber.trim(),
        quantity: batchQuantity,
        costPrice: batchCostPrice,
      })
      toast.success(`Batch ${batchNumber} received successfully`)
      setReceiveBatchDialogOpen(false)
      setBatchNumber('')
      setBatchQuantity(1)
      setBatchCostPrice(0)
      setBatchProductId(null)
      setBatchDepartmentId(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to receive batch'
      setReceiveBatchError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setReceivingBatch(false)
    }
  }

  const handleAdjustQuantity = async () => {
    if (!selectedBatch) return

    if (adjustQuantity < 0) {
      toast.error('Quantity cannot be negative')
      return
    }

    setAdjustingBatch(true)
    setAdjustBatchError(null)

    try {
      await adjustBatchQuantity({
        batchId: selectedBatch._id,
        newQuantity: adjustQuantity,
        reason: adjustReason || undefined,
      })
      toast.success('Batch quantity adjusted successfully')
      setAdjustQuantityDialogOpen(false)
      setSelectedBatch(null)
      setAdjustQuantity(0)
      setAdjustReason('')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to adjust quantity'
      setAdjustBatchError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setAdjustingBatch(false)
    }
  }

  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm('Are you sure you want to delete this batch? The batch must have 0 quantity.')) {
      return
    }

    try {
      await deleteBatch({ batchId: batchId as any })
      toast.success('Batch deleted successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete batch')
    }
  }

  const handleRemoveProduct = async (productId: string) => {
    if (!selectedStoreId) return

    if (!confirm('Are you sure you want to remove this product from the store? It must have 0 stock.')) {
      return
    }

    try {
      await removeProductFromStore({
        storeId: selectedStoreId as any,
        productId: productId as any,
      })
      toast.success('Product removed from store')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove product')
    }
  }

  const handleEditReorder = (productId: string, reorderLevel: number) => {
    setSelectedProductId(productId)
    setReorderLevel(reorderLevel)
    setReorderError(null)
    setReorderDialogOpen(true)
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inventory Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage stock, batches, and inventory assignments across stores
            </p>
          </div>
          <InventoryStoreSelector
            stores={stores}
            selectedStoreId={selectedStoreId}
            onStoreChange={setSelectedStoreId}
          />
        </div>

        {/* Stats Cards */}
        <InventoryStatCards stats={stats} isLoading={isLoading} />

        {/* Tabs */}
        <Tabs defaultValue="inventory" className="space-y-4">
          <TabsList>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="batches">Batches</TabsTrigger>
            <TabsTrigger value="low-stock">Low Stock</TabsTrigger>
          </TabsList>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-4">
            <InventoryTable
              data={inventoryItems}
              isLoading={isLoading}
              searchTerm={searchTerm}
              onEditReorder={handleEditReorder}
              onReceiveBatch={openReceiveBatchDialog}
              onRemoveProduct={handleRemoveProduct}
            />
          </TabsContent>

          {/* Batches Tab */}
          <TabsContent value="batches" className="space-y-4">
            <BatchesTable
              data={batches}
              products={allProducts}
              isLoading={isLoading}
              onEditBatch={(batch) => {
                setSelectedBatch(batch)
                setAdjustQuantity(batch.quantity)
                setAdjustReason('')
                setAdjustBatchError(null)
                setAdjustQuantityDialogOpen(true)
              }}
              onDeleteBatch={handleDeleteBatch}
              onReceiveBatch={() => openReceiveBatchDialog()}
            />
          </TabsContent>

          {/* Low Stock Tab */}
          <TabsContent value="low-stock" className="space-y-4">
            <LowStockTable
              items={lowStockItems as any}
              onReceiveStock={(productId) => openReceiveBatchDialog(productId, 10)}
            />
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <AssignProductDialog
          open={assignDialogOpen}
          onOpenChange={(open) => {
            setAssignDialogOpen(open)
            if (!open) {
              setAssignError(null)
              setSelectedDepartmentId(null)
              setSelectedProductId(null)
            }
          }}
          departments={departments}
          unassignedProducts={filteredUnassignedProducts}
          selectedDepartmentId={selectedDepartmentId}
          selectedProductId={selectedProductId}
          reorderLevel={reorderLevel}
          onDepartmentChange={setSelectedDepartmentId}
          onProductChange={setSelectedProductId}
          onReorderLevelChange={setReorderLevel}
          onSubmit={handleAssignProduct}
          isLoading={assigning}
          error={assignError}
        />

        <ReceiveBatchDialog
          open={receiveBatchDialogOpen}
          onOpenChange={(open) => {
            setReceiveBatchDialogOpen(open)
            if (!open) {
              setReceiveBatchError(null)
              setBatchDepartmentId(null)
              setBatchProductId(null)
            }
          }}
          departments={departments}
          inventoryItems={filteredInventoryItems}
          selectedDepartmentId={batchDepartmentId}
          selectedProductId={batchProductId}
          batchNumber={batchNumber}
          batchQuantity={batchQuantity}
          batchCostPrice={batchCostPrice}
          onDepartmentChange={setBatchDepartmentId}
          onProductChange={setBatchProductId}
          onBatchNumberChange={setBatchNumber}
          onBatchQuantityChange={setBatchQuantity}
          onBatchCostPriceChange={setBatchCostPrice}
          onSubmit={handleReceiveBatch}
          isLoading={receivingBatch}
          error={receiveBatchError}
          isProductEligible={(productId) => isProductEligibleForBatch(productId, batches)}
        />

        <ReorderLevelDialog
          open={reorderDialogOpen}
          onOpenChange={(open) => {
            setReorderDialogOpen(open)
            if (!open) setReorderError(null)
          }}
          reorderLevel={reorderLevel}
          onReorderLevelChange={setReorderLevel}
          onSubmit={handleSetReorderLevel}
          isLoading={updatingReorder}
          error={reorderError}
        />

        <AdjustBatchDialog
          open={adjustQuantityDialogOpen}
          onOpenChange={(open) => {
            setAdjustQuantityDialogOpen(open)
            if (!open) {
              setAdjustBatchError(null)
              setSelectedBatch(null)
            }
          }}
          batch={selectedBatch}
          adjustQuantity={adjustQuantity}
          adjustReason={adjustReason}
          onQuantityChange={setAdjustQuantity}
          onReasonChange={setAdjustReason}
          onSubmit={handleAdjustQuantity}
          isLoading={adjustingBatch}
          error={adjustBatchError}
        />
      </div>
    </AppLayout>
  )
}