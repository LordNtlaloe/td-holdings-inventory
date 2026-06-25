import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'

import AppLayout from '#/layouts/app-layout'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
  SalesStatCards,
  SalesFilters,
  SalesTable,
  SaleDetailSheet,
  ConfirmActionDialog,
  SalesCharts,
  startOfDay,
  endOfDay,
  type SalesFiltersType,
} from '#/components/sales'
import { DistributionChart, type DistributionSlice } from '#/components/general/distribution-chart'

export const Route = createFileRoute('/dashboard/sales/')({
  component: SalesPage,
})

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  Cash: '#16a34a',
  Card: '#0ea5e9',
  'Mobile Payment': '#f59e0b',
  Credit: '#8b5cf6',
  Voucher: '#ec4899',
  Unknown: '#94a3b8',
}

function SalesPage() {
  const [filters, setFilters] = useState<SalesFiltersType>({
    status: 'all',
    store: 'all',
    search: '',
    dateFrom: '',
    dateTo: '',
  })

  const [selectedSaleId, setSelectedSaleId] = useState<Id<'sales'> | null>(null)
  const [actionType, setActionType] = useState<'void' | 'refund' | null>(null)
  const [actionSaleId, setActionSaleId] = useState<Id<'sales'> | null>(null)

  const currentUser = useQuery(api.users.getUserProfile)
  const isGlobal =
    currentUser?.role === 'super_admin' || currentUser?.role === 'admin'
  const canAction =
    currentUser?.role === 'super_admin' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager'

  // Global users use getAllSales; store-scoped users need their storeId first
  const employee = useQuery(
    api.employees.getMyEmployeeRecord,
    isGlobal === false && currentUser !== undefined ? {} : 'skip'
  )

  const allSalesRaw = useQuery(
    api.sales.getAllSales,
    isGlobal ? {} : 'skip'
  )

  const storeSalesRaw = useQuery(
    api.sales.getSalesByStore,
    !isGlobal && employee?.storeId
      ? { storeId: employee.storeId }
      : 'skip'
  )

  const salesRaw = isGlobal ? allSalesRaw : storeSalesRaw
  const stores = useQuery(api.stores.getAllStores, isGlobal ? {} : 'skip')

  // Apply filters
  const dateFromTs = filters.dateFrom ? startOfDay(new Date(filters.dateFrom)) : undefined
  const dateToTs = filters.dateTo ? endOfDay(new Date(filters.dateTo)) : undefined

  const filteredSales = useMemo(() => {
    if (!salesRaw) return []
    let rows = salesRaw as any[]

    if (filters.status !== 'all') {
      rows = rows.filter((s) => s.status === filters.status)
    }
    if (filters.store !== 'all') {
      rows = rows.filter((s) => s.storeId === filters.store)
    }
    if (dateFromTs !== undefined) {
      rows = rows.filter((s) => s.createdAt >= dateFromTs)
    }
    if (dateToTs !== undefined) {
      rows = rows.filter((s) => s.createdAt <= dateToTs)
    }
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase()
      rows = rows.filter(
        (s) =>
          (s.customer?.name ?? 'walk-in').toLowerCase().includes(q) ||
          (s.store?.name ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [salesRaw, filters, dateFromTs, dateToTs])

  const stats = useMemo(() => {
    const completed = filteredSales.filter((s: any) => s.status === 'completed')
    const totalRevenue = completed.reduce((sum: number, s: any) => sum + s.totalAmount, 0)
    const salesCount = completed.length
    const avgOrderValue = salesCount > 0 ? totalRevenue / salesCount : 0
    const refundCount = filteredSales.filter((s: any) => s.status === 'refunded').length
    const voidCount = filteredSales.filter((s: any) => s.status === 'voided').length
    return { totalRevenue, salesCount, avgOrderValue, refundCount, voidCount }
  }, [filteredSales])

  // Breakdown of completed sales by how the customer paid. Refunded/voided
  // sales are excluded so the chart reflects actual realized revenue mix,
  // not transactions that were later reversed. Sales recorded before
  // `paymentMethod` was added to the schema will bucket under "Unknown".
  const paymentMethodData: DistributionSlice[] = useMemo(() => {
    const completed = filteredSales.filter((s: any) => s.status === 'completed')

    const counts: Record<string, number> = {}
    for (const sale of completed) {
      const method = sale.paymentMethod ?? 'Unknown'
      counts[method] = (counts[method] || 0) + 1
    }

    return Object.entries(counts).map(([label, value]) => ({
      label,
      value,
      color: PAYMENT_METHOD_COLORS[label] ?? '#14b8a6',
    }))
  }, [filteredSales])

  const hasActiveFilters = useMemo(() => {
    return (
      filters.status !== 'all' ||
      filters.store !== 'all' ||
      filters.dateFrom !== '' ||
      filters.dateTo !== '' ||
      filters.search !== ''
    )
  }, [filters])

  const handleFilterChange = (key: keyof SalesFiltersType, value: string) => {
    setFilters((prev: SalesFiltersType) => ({ ...prev, [key]: value }))
  }

  const handleClearFilters = () => {
    setFilters({
      status: 'all',
      store: 'all',
      search: '',
      dateFrom: '',
      dateTo: '',
    })
  }

  const openVoid = (id: Id<'sales'>) => {
    setSelectedSaleId(null)
    setActionSaleId(id)
    setActionType('void')
  }

  const openRefund = (id: Id<'sales'>) => {
    setSelectedSaleId(null)
    setActionSaleId(id)
    setActionType('refund')
  }

  const isLoading = salesRaw === undefined || currentUser === undefined

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="text-sm text-muted-foreground">
            {isGlobal ? 'All stores' : 'Your store'}
          </p>
        </div>

        <SalesStatCards stats={stats} isLoading={isLoading} />

        <SalesFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isGlobal={isGlobal}
          stores={stores}
          hasActiveFilters={hasActiveFilters}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <SalesCharts
            salesData={filteredSales}
            isLoading={isLoading}
            isGlobal={isGlobal}
          />
          <DistributionChart
            data={paymentMethodData}
            title="Sales by Payment Method"
            description="Completed sales, by how customers paid"
          />
        </div>

        <Card>
          <SalesTable
            sales={filteredSales}
            isLoading={isLoading}
            isGlobal={isGlobal}
            canAction={canAction}
            onSelectSale={setSelectedSaleId}
            onVoid={openVoid}
            onRefund={openRefund}
          />
        </Card>
      </div>

      <SaleDetailSheet
        saleId={selectedSaleId}
        open={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        canAction={canAction}
        onVoid={openVoid}
        onRefund={openRefund}
      />

      <ConfirmActionDialog
        action={actionType}
        saleId={actionSaleId}
        onClose={() => {
          setActionType(null)
          setActionSaleId(null)
        }}
      />
    </AppLayout>
  )
}