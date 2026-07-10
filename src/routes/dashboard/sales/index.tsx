import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState, useMemo } from 'react'

import AppLayout from '#/layouts/app-layout'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
  SalesStatCards,
  SalesFilters,
  SaleDetailSheet,
  ConfirmActionDialog,
  SalesCharts,
  ProductSalesBreakdownCard,
  SalesHistoryCard,
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
  Mpesa: '#f59e0b',
  Ecocash: '#8b5cf6',
  Credit: '#6366f1',
  Voucher: '#f97316',
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
  const [actionType, setActionType] = useState<'void' | 'cancel' | null>(null)
  const [actionSaleId, setActionSaleId] = useState<Id<'sales'> | null>(null)
  const [breakdownDepartment, setBreakdownDepartment] = useState<string>('all')

  const currentUser = useQuery(api.users.getUserProfile)
  const isGlobal =
    currentUser?.role === 'super_admin' || currentUser?.role === 'admin'
  const canAction =
    currentUser?.role === 'super_admin' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager'
  const canVoid =
    currentUser?.role === 'super_admin' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager' ||
    currentUser?.role === 'cashier'

  const employee = useQuery(
    api.employees.getMyEmployeeRecord,
    isGlobal === false && currentUser !== undefined ? {} : 'skip'
  )

  const allSalesRaw = useQuery(api.sales.allCompletedSales, isGlobal ? {} : 'skip')
  const storeSalesRaw = useQuery(
    api.sales.getSalesByStore,
    !isGlobal && employee?.storeId ? { storeId: employee.storeId } : 'skip'
  )

  const salesRaw = isGlobal ? allSalesRaw : storeSalesRaw
  const stores = useQuery(api.stores.getAllStores, isGlobal ? {} : 'skip')
  const departments = useQuery(api.departments.getAllDepartments, {})

  // Today's date range
  const todayStart = useMemo(() => startOfDay(new Date()), [])
  const todayEnd = useMemo(() => endOfDay(new Date()), [])

  // Get department ID for filtering
  const departmentId = useMemo(() => {
    if (breakdownDepartment === 'all' || !departments) return undefined
    const dept = departments.find((d) => d.name === breakdownDepartment)
    return dept?._id as Id<'departments'> | undefined
  }, [breakdownDepartment, departments])

  // Product breakdown with department filtering (TODAY ONLY)
  const todayProductSales = useQuery(api.sales.getProductSalesWithPaymentMethods, {
    storeId: filters.store !== 'all' ? (filters.store as Id<'stores'>) : undefined,
    dateFrom: todayStart,
    dateTo: todayEnd,
    departmentId,
  })

  const paymentMethodBreakdown = useQuery(api.sales.getSalesByPaymentMethod, {
    storeId: filters.store !== 'all' ? (filters.store as Id<'stores'>) : undefined,
    dateFrom: filters.dateFrom ? startOfDay(new Date(filters.dateFrom)) : undefined,
    dateTo: filters.dateTo ? endOfDay(new Date(filters.dateTo)) : undefined,
  })

  const dateFromTs = filters.dateFrom ? startOfDay(new Date(filters.dateFrom)) : undefined
  const dateToTs = filters.dateTo ? endOfDay(new Date(filters.dateTo)) : undefined

  // FILTERED SALES for charts (respects all filters)
  const filteredSales = useMemo(() => {
    if (!salesRaw) return []
    let rows = salesRaw as any[]
    if (filters.status !== 'all') rows = rows.filter((s) => s.status === filters.status)
    if (filters.store !== 'all') rows = rows.filter((s) => s.storeId === filters.store)
    if (dateFromTs !== undefined) rows = rows.filter((s) => s.createdAt >= dateFromTs)
    if (dateToTs !== undefined) rows = rows.filter((s) => s.createdAt <= dateToTs)
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

  // ALL SALES for history (no date filters applied)
  const allSalesForHistory = useMemo(() => {
    if (!salesRaw) return []
    let rows = salesRaw as any[]
    if (filters.status !== 'all') rows = rows.filter((s) => s.status === filters.status)
    if (filters.store !== 'all') rows = rows.filter((s) => s.storeId === filters.store)
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase()
      rows = rows.filter(
        (s) =>
          (s.customer?.name ?? 'walk-in').toLowerCase().includes(q) ||
          (s.store?.name ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [salesRaw, filters])

  // Stats — all figures today-scoped; only completed sales count for revenue
  const stats = useMemo(() => {
    if (!salesRaw) {
      return {
        totalRevenue: 0,
        salesCount: 0,
        avgOrderValue: 0,
        refundCount: 0,
        voidCount: 0,
        cancelledCount: 0,
      }
    }

    // Get today's sales
    let todayRows = (salesRaw as any[]).filter(
      (s) => s.createdAt >= todayStart && s.createdAt <= todayEnd
    )
    if (filters.store !== 'all') {
      todayRows = todayRows.filter((s) => s.storeId === filters.store)
    }

    // ONLY completed sales count for revenue and transactions
    const todayCompleted = todayRows.filter((s: any) => s.status === 'completed')
    const salesCount = todayCompleted.length

    // Calculate revenue ONLY from completed sales
    const revenue = todayCompleted.reduce((sum: number, s: any) => sum + s.totalAmount, 0)
    const avgOrderValue = salesCount > 0 ? revenue / salesCount : 0

    // Count non-completed sales for awareness (from filtered view)
    const refundCount = filteredSales.filter((s: any) => s.status === 'refunded').length
    const voidCount = filteredSales.filter((s: any) => s.status === 'voided').length
    const cancelledCount = filteredSales.filter((s: any) => s.status === 'cancelled').length

    return {
      totalRevenue: revenue,
      salesCount,
      avgOrderValue,
      refundCount,
      voidCount,
      cancelledCount,
    }
  }, [salesRaw, filteredSales, todayStart, todayEnd, filters.store])

  const paymentMethodData: DistributionSlice[] = useMemo(() => {
    if (!paymentMethodBreakdown) return []
    return paymentMethodBreakdown.map((item) => ({
      label: item.method,
      value: item.totalAmount,
      color: PAYMENT_METHOD_COLORS[item.method] ?? '#14b8a6',
    }))
  }, [paymentMethodBreakdown])

  const availableDepartments = useMemo(() => {
    if (departments) {
      return departments.map((d) => d.name)
    }
    return []
  }, [departments])

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
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleClearFilters = () => {
    setFilters({ status: 'all', store: 'all', search: '', dateFrom: '', dateTo: '' })
  }

  const openVoid = (id: Id<'sales'>) => {
    setSelectedSaleId(null)
    setActionSaleId(id)
    setActionType('void')
  }
  const openCancel = (id: Id<'sales'>) => {
    setSelectedSaleId(null)
    setActionSaleId(id)
    setActionType('cancel')
  }

  const isLoading = salesRaw === undefined || currentUser === undefined
  const isLoadingDepartments = departments === undefined

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
          <SalesCharts salesData={filteredSales} isLoading={isLoading} isGlobal={isGlobal} />
          <DistributionChart
            data={paymentMethodData}
            title="Revenue by Payment Method"
            description="Total revenue breakdown by how customers paid"
          />
        </div>

        <ProductSalesBreakdownCard
          todayProductSales={todayProductSales}
          availableDepartments={availableDepartments}
          isLoadingDepartments={isLoadingDepartments}
          breakdownDepartment={breakdownDepartment}
          onBreakdownDepartmentChange={setBreakdownDepartment}
          storeFilter={filters.store}
          stores={stores}
        />

        <SalesHistoryCard
          sales={allSalesForHistory}
          isLoading={isLoading}
          isGlobal={isGlobal}
          canAction={canAction}
          canVoid={canVoid}
          statusFilter={filters.status}
          storeFilter={filters.store}
          stores={stores}
          onSelectSale={setSelectedSaleId}
          onVoid={openVoid}
          onCancel={openCancel}
          onRefund={(_: Id<'sales'>) => {
            throw new Error('Function not implemented.')
          }}
        />
      </div>

      <SaleDetailSheet
        saleId={selectedSaleId}
        open={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        canAction={canAction}
        onVoid={openVoid}
        onCancel={openCancel}
        canVoid={false}
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