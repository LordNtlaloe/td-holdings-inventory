
import { useMemo, useState, useRef, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SearchIcon,
  CheckIcon,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatCurrency } from './sales-utils'

interface SalesByProductProps {
  storeFilter: string
  stores: { _id: Id<'stores'>; name: string }[] | undefined
}

interface Transaction {
  saleId: string
  createdAt: number
  quantity: number
  unitPrice: number
  totalItemPrice: number
  customerName: string
  storeName: string
}

interface PeriodData {
  totalQuantity: number
  totalRevenue: number
  saleCount: number
  transactions: Transaction[]
}

interface PeriodsMap {
  [key: string]: PeriodData
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'pastWeek', label: 'Past 7 Days' },
  { key: 'pastMonth', label: 'Past 30 Days' },
  { key: 'allTime', label: 'All Time' },
] as const

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SalesByProduct({
  storeFilter,
  stores,
}: SalesByProductProps) {
  const [periodTab, setPeriodTab] = useState('today')
  const products = useQuery(api.products.getActiveProducts)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const productSalesOverview = useQuery(
    api.sales.getProductSalesOverView,
    selectedProductId
      ? {
        productId: selectedProductId as Id<'products'>,
        storeId:
          storeFilter !== 'all'
            ? (storeFilter as Id<'stores'>)
            : undefined,
      }
      : 'skip',
  )

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50)
    } else {
      setSearchQuery('')
    }
  }, [open])

  const filteredProducts = useMemo(() => {
    if (!products) return []

    if (!searchQuery.trim()) return products

    const q = searchQuery.toLowerCase()

    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q),
    )
  }, [products, searchQuery])

  const periods = useMemo(() => {
    if (!productSalesOverview) return null

    return productSalesOverview.periods as PeriodsMap
  }, [productSalesOverview])

  const selectedProductName = useMemo(() => {
    if (!products || !selectedProductId) return ''

    return (
      products.find((p) => p._id === selectedProductId)?.name ?? ''
    )
  }, [products, selectedProductId])

  const activePeriodData = useMemo(() => {
    if (!periods) return null

    return periods[periodTab] ?? null
  }, [periods, periodTab])

  if (products === undefined) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="min-w-0">
            <CardTitle className="text-base sm:text-lg">
              Sales by Product
            </CardTitle>

            <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Select a product to view its sales performance across time
              periods
              {storeFilter !== 'all' && stores
                ? ` · ${stores.find((s) => s._id === storeFilter)?.name ?? ''
                }`
                : ''}
            </p>
          </div>

          {/* Product selector */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full min-w-0 justify-between font-normal sm:max-w-xs"
              >
                <span className="truncate">
                  {selectedProductId && selectedProductName
                    ? selectedProductName
                    : 'Select a product...'}
                </span>

                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>

            <PopoverContent
              className="w-[calc(100vw-2rem)] max-w-sm p-1 sm:w-72"
              align="end"
            >
              <div className="flex items-center gap-1 border-b px-2 pb-1">
                <SearchIcon className="h-4 w-4 shrink-0 opacity-50" />

                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search products..."
                  className="flex h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="max-h-64 overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No products found.
                  </p>
                ) : (
                  filteredProducts.map((product) => (
                    <button
                      key={product._id}
                      onClick={() => {
                        setSelectedProductId(product._id)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted',
                        selectedProductId === product._id && 'bg-muted',
                      )}
                    >
                      <CheckIcon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          selectedProductId === product._id
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {product.name}
                        </div>

                        <div className="truncate text-xs text-muted-foreground">
                          {product.sku}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>

      <CardContent className="px-3 sm:px-6">
        {!selectedProductId ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Choose a product from the dropdown above to see its sales
            breakdown.
          </p>
        ) : productSalesOverview === undefined ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-5 sm:space-y-6">
            {/* Product Info */}
            <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold sm:text-lg">
                    {productSalesOverview.productName}
                  </p>

                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    SKU: {productSalesOverview.sku}

                    {productSalesOverview.department && (
                      <> · Department: {productSalesOverview.department}</>
                    )}
                  </p>
                </div>

                {/* Product financial stats */}
                <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-end sm:gap-5">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      Selling Price
                    </p>

                    <p className="truncate text-sm font-semibold">
                      {formatCurrency(
                        productSalesOverview.sellingPrice,
                      )}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      Cost Price
                    </p>

                    <p className="truncate text-sm font-semibold">
                      {formatCurrency(
                        productSalesOverview.costPrice,
                      )}
                    </p>
                  </div>

                  {productSalesOverview.sellingPrice > 0 && (
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="text-xs text-muted-foreground">
                        Margin
                      </p>

                      <p className="truncate text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(
                          productSalesOverview.sellingPrice -
                          productSalesOverview.costPrice,
                        )}{' '}
                        (
                        {Math.round(
                          ((productSalesOverview.sellingPrice -
                            productSalesOverview.costPrice) /
                            productSalesOverview.sellingPrice) *
                          100,
                        )}
                        %)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Period Tabs */}
            <Tabs
              value={periodTab}
              onValueChange={setPeriodTab}
              className="w-full"
            >
              <div className="space-y-3">
                {/* Horizontally scrollable timeline selector */}
                <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
                  <TabsList className="inline-flex h-auto min-w-full justify-start gap-1 p-1 sm:min-w-0">
                    {PERIODS.map(({ key, label }) => {
                      const data = periods?.[key]

                      return (
                        <TabsTrigger
                          key={key}
                          value={key}
                          className="min-h-10 shrink-0 whitespace-nowrap px-3 text-xs sm:px-4 sm:text-sm"
                        >
                          {label}

                          {data && data.saleCount > 0 && (
                            <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary sm:text-xs">
                              {data.saleCount}
                            </span>
                          )}
                        </TabsTrigger>
                      )
                    })}
                  </TabsList>
                </div>

                {/* Active period summary */}
                {activePeriodData && (
                  <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs sm:flex sm:items-center sm:justify-end sm:gap-5 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
                    <div className="flex items-center justify-between gap-2 sm:block">
                      <span className="text-muted-foreground">
                        Qty
                      </span>

                      <strong className="text-foreground">
                        {activePeriodData.totalQuantity}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:block">
                      <span className="text-muted-foreground">
                        Revenue
                      </span>

                      <strong className="text-foreground">
                        {formatCurrency(
                          activePeriodData.totalRevenue,
                        )}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              {PERIODS.map(({ key }) => (
                <TabsContent
                  key={key}
                  value={key}
                  className="pt-3 sm:pt-4"
                >
                  <TransactionTable periodData={periods?.[key]} />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const PAGE_SIZE = 25

function TransactionTable({
  periodData,
}: {
  periodData: PeriodData | undefined
}) {
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [periodData])

  if (!periodData) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (periodData.transactions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No sales recorded in this period.
      </p>
    )
  }

  const totalPages = Math.ceil(
    periodData.transactions.length / PAGE_SIZE,
  )

  const start = page * PAGE_SIZE
  const end = start + PAGE_SIZE

  const pageTransactions = periodData.transactions.slice(start, end)

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 font-medium">Date &amp; Time</th>
              <th className="pb-2 font-medium">Store</th>
              <th className="pb-2 font-medium">Customer</th>
              <th className="pb-2 text-right font-medium">
                Quantity
              </th>
              <th className="pb-2 text-right font-medium">
                Unit Price
              </th>
              <th className="pb-2 text-right font-medium">Total</th>
            </tr>
          </thead>

          <tbody>
            {pageTransactions.map((tx) => (
              <tr
                key={tx.saleId}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                <td className="py-2">{formatDateTime(tx.createdAt)}</td>
                <td className="py-2">{tx.storeName}</td>
                <td className="py-2">{tx.customerName}</td>
                <td className="py-2 text-right">{tx.quantity}</td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(tx.unitPrice)}
                </td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(tx.totalItemPrice)}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t bg-muted/30 font-medium">
              <td className="py-2" colSpan={3}>
                Total (
                {periodData.transactions.length} transaction
                {periodData.transactions.length !== 1 ? 's' : ''})
              </td>

              <td className="py-2 text-right">
                {periodData.totalQuantity}
              </td>

              <td />

              <td className="py-2 text-right">
                {formatCurrency(periodData.totalRevenue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {pageTransactions.map((tx) => (
          <div
            key={tx.saleId}
            className="rounded-lg border bg-card p-3 shadow-sm"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">
                {tx.customerName}
              </span>

              <span className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
                {formatDateTime(tx.createdAt)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <span className="text-muted-foreground">
                Store
              </span>

              <span className="min-w-0 truncate text-right">
                {tx.storeName}
              </span>

              <span className="text-muted-foreground">
                Quantity
              </span>

              <span className="text-right font-medium">
                {tx.quantity}
              </span>

              <span className="text-muted-foreground">
                Unit Price
              </span>

              <span className="text-right">
                {formatCurrency(tx.unitPrice)}
              </span>

              <span className="text-muted-foreground">
                Total
              </span>

              <span className="text-right font-semibold">
                {formatCurrency(tx.totalItemPrice)}
              </span>
            </div>
          </div>
        ))}

        {/* Mobile summary */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <span className="text-muted-foreground">
              Transactions
            </span>

            <span className="text-right font-medium">
              {periodData.transactions.length}
            </span>

            <span className="text-muted-foreground">
              Total Quantity
            </span>

            <span className="text-right font-medium">
              {periodData.totalQuantity}
            </span>

            <span className="text-muted-foreground">
              Total Revenue
            </span>

            <span className="text-right font-semibold">
              {formatCurrency(periodData.totalRevenue)}
            </span>
          </div>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:pt-0">
          <p className="text-center text-xs text-muted-foreground sm:text-left sm:text-sm">
            Showing {start + 1}–
            {Math.min(end, periodData.transactions.length)} of{' '}
            {periodData.transactions.length}
          </p>

          <div className="flex items-center justify-center gap-1 overflow-x-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 p-0"
              disabled={page === 0}
              onClick={() =>
                setPage((p) => Math.max(0, p - 1))
              }
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {totalPages <= 7
              ? Array.from({ length: totalPages }, (_, i) => (
                <Button
                  key={i}
                  variant={
                    i === page ? 'default' : 'outline'
                  }
                  size="sm"
                  className="h-9 min-w-9 shrink-0 px-2"
                  onClick={() => setPage(i)}
                >
                  {i + 1}
                </Button>
              ))
              : renderCondensedPageNumbers(
                page,
                totalPages,
                setPage,
              )}

            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 p-0"
              disabled={page >= totalPages - 1}
              onClick={() =>
                setPage((p) =>
                  Math.min(totalPages - 1, p + 1),
                )
              }
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function renderCondensedPageNumbers(
  currentPage: number,
  totalPages: number,
  setPage: (fn: (prev: number) => number) => void,
) {
  const pages: (number | string)[] = []

  pages.push(0)

  if (currentPage > 2) {
    pages.push('...')
  }

  for (
    let i = Math.max(1, currentPage - 1);
    i <= Math.min(totalPages - 2, currentPage + 1);
    i++
  ) {
    pages.push(i)
  }

  if (currentPage < totalPages - 3) {
    pages.push('...')
  }

  if (totalPages > 1) {
    pages.push(totalPages - 1)
  }

  return pages.map((p, idx) =>
    typeof p === 'string' ? (
      <span
        key={`ellipsis-${idx}`}
        className="shrink-0 px-1 text-muted-foreground"
      >
        …
      </span>
    ) : (
      <Button
        key={p}
        variant={p === currentPage ? 'default' : 'outline'}
        size="sm"
        className="h-9 min-w-9 shrink-0 px-2"
        onClick={() => setPage(() => p)}
      >
        {p + 1}
      </Button>
    ),
  )
}
