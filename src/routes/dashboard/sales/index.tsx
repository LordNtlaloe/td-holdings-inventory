import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

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
import { formatCurrency } from '#/components/sales/sales-utils'

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

  // Today's revenue - ONLY COMPLETED SALES
  const todayRevenue = useMemo(() => {
    if (!salesRaw) return 0

    // First filter by date range and store
    let rows = (salesRaw as any[]).filter(
      (s) => s.createdAt >= todayStart && s.createdAt <= todayEnd
    )
    if (filters.store !== 'all') {
      rows = rows.filter((s) => s.storeId === filters.store)
    }

    // CRITICAL: Only include COMPLETED sales
    // Exclude: voided, cancelled, refunded
    const completedRows = rows.filter((s: any) => s.status === 'completed')

    return completedRows.reduce((sum: number, s: any) => sum + s.totalAmount, 0)
  }, [salesRaw, filters.store, todayStart, todayEnd])

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
      cancelledCount
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

  // Get available departments from the API
  const availableDepartments = useMemo(() => {
    if (departments) {
      return departments.map((d) => d.name)
    }
    return []
  }, [departments])

  const filteredTodayProductSales = useMemo(() => {
    if (!todayProductSales) return []
    return todayProductSales
  }, [todayProductSales])

  const todayTotals = useMemo(() => {
    return {
      qty: filteredTodayProductSales.reduce((sum: number, p: any) => sum + p.totalQuantity, 0),
      revenue: filteredTodayProductSales.reduce((sum: number, p: any) => sum + p.totalRevenue, 0),
    }
  }, [filteredTodayProductSales])

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

  const totalByMethod = useMemo(() => {
    if (!paymentMethodBreakdown) return {}
    return paymentMethodBreakdown.reduce(
      (acc, item) => {
        acc[item.method] = item.totalAmount
        return acc
      },
      {} as Record<string, number>
    )
  }, [paymentMethodBreakdown])

  const isLoadingDepartments = departments === undefined

  // History count - only completed sales
  const historyTransactionCount = useMemo(() => {
    return allSalesForHistory.filter((s: any) => s.status === 'completed').length
  }, [allSalesForHistory])

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

        {/* Product Sales Breakdown with department filtering - TODAY ONLY */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <CardTitle>Today's Product Sales</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {new Date().toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  {filters.store !== 'all' && stores
                    ? ` · ${stores.find((s: any) => s._id === filters.store)?.name ?? ''}`
                    : ''}
                  {breakdownDepartment !== 'all' && ` · ${breakdownDepartment}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isLoadingDepartments && availableDepartments.length > 0 && (
                  <Select value={breakdownDepartment} onValueChange={setBreakdownDepartment}>
                    <SelectTrigger className="w-44 shrink-0">
                      <SelectValue placeholder="All departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {availableDepartments.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {todayProductSales === undefined ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : filteredTodayProductSales.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                No sales recorded today
                {breakdownDepartment !== 'all' ? ` in ${breakdownDepartment}` : ''}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Product</th>
                      <th className="pb-2 font-medium text-right">SKU</th>
                      {availableDepartments.length > 0 && breakdownDepartment === 'all' && (
                        <th className="pb-2 font-medium text-right">Department</th>
                      )}
                      <th className="pb-2 font-medium text-right">Qty</th>
                      <th className="pb-2 font-medium text-right">Revenue</th>
                      <th className="pb-2 font-medium text-right">Payment Methods</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTodayProductSales.map((product: any) => (
                      <tr key={product.productId} className="border-b last:border-0">
                        <td className="py-2 font-medium">{product.productName}</td>
                        <td className="py-2 text-right font-mono text-xs text-muted-foreground">
                          {product.sku}
                        </td>
                        {availableDepartments.length > 0 && breakdownDepartment === 'all' && (
                          <td className="py-2 text-right">
                            {product.department ? (
                              <Badge variant="secondary" className="text-xs">
                                {product.department}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                        <td className="py-2 text-right">{product.totalQuantity}</td>
                        <td className="py-2 text-right font-medium">
                          {formatCurrency(product.totalRevenue)}
                        </td>
                        <td className="py-2 text-right">
                          <div className="space-y-0.5">
                            {product.paymentMethods.map((pm: any) => (
                              <div key={pm.method} className="flex justify-end gap-2 text-xs">
                                <span className="text-muted-foreground">{pm.method}:</span>
                                <span>{formatCurrency(pm.amount)}</span>
                                <span className="text-muted-foreground">
                                  ({Math.round(pm.quantity)} units)
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-medium">
                      <td className="py-2 pl-1">
                        Total
                        {breakdownDepartment !== 'all' && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({breakdownDepartment})
                          </span>
                        )}
                      </td>
                      <td />
                      {availableDepartments.length > 0 && breakdownDepartment === 'all' && <td />}
                      <td className="py-2 text-right">{todayTotals.qty}</td>
                      <td className="py-2 text-right">{formatCurrency(todayTotals.revenue)}</td>
                      <td className="py-2 text-right">
                        {Object.entries(totalByMethod).map(([method, amount]) => (
                          <div key={method} className="text-xs">
                            {method}: {formatCurrency(amount as number)}
                          </div>
                        ))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Full sales history - ALL SALES, no date restrictions */}
        <Card>
          <CardHeader>
            <CardTitle>Sales History</CardTitle>
            <p className="text-sm text-muted-foreground">
              {historyTransactionCount} completed transaction{historyTransactionCount !== 1 ? 's' : ''}
              {filters.status !== 'all' && ` · filtered by ${filters.status}`}
              {filters.store !== 'all' && stores
                ? ` · ${stores.find((s: any) => s._id === filters.store)?.name ?? ''}`
                : ''}
            </p>
          </CardHeader>
          <CardContent>
            <SalesTable
              sales={allSalesForHistory}
              isLoading={isLoading}
              isGlobal={isGlobal}
              canAction={canAction}
              canVoid={canVoid}
              onSelectSale={setSelectedSaleId}
              onVoid={openVoid}
              onCancel={openCancel}
              onRefund={function (_: Id<'sales'>): void {
                throw new Error('Function not implemented.')
              }}
            />
          </CardContent>
        </Card>
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