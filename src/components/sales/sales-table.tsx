import { useState, useMemo } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw,
    Search,
    X,
    XCircle,
} from 'lucide-react'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Sale } from '#/types/sales'
import { formatCurrency, formatTimestamp, getStatusVariant } from './sales-utils'

interface SalesTableProps {
    sales: Sale[]
    isLoading: boolean
    isGlobal: boolean
    canAction: boolean
    onSelectSale: (id: Id<'sales'>) => void
    onVoid: (id: Id<'sales'>) => void
    onRefund: (id: Id<'sales'>) => void
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50]

export function SalesTable({
    sales,
    isLoading,
    isGlobal,
    canAction,
    onSelectSale,
    onVoid,
    onRefund,
}: SalesTableProps) {
    // Filter states
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [storeFilter, setStoreFilter] = useState<string>('all')

    // Pagination states
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)

    // Get unique stores for filter dropdown
    const stores = useMemo(() => {
        const storeSet = new Set<string>()
        sales.forEach((sale) => {
            if (sale.store?.name) {
                storeSet.add(sale.store.name)
            }
        })
        return Array.from(storeSet).sort()
    }, [sales])

    // Apply filters
    const filteredSales = useMemo(() => {
        let filtered = sales

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim()
            filtered = filtered.filter((sale) => {
                const customerName = (sale.customer?.name || 'walk-in').toLowerCase()
                const storeName = (sale.store?.name || '').toLowerCase()
                return customerName.includes(query) || storeName.includes(query)
            })
        }

        // Status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter((sale) => sale.status === statusFilter)
        }

        // Store filter
        if (storeFilter !== 'all' && isGlobal) {
            filtered = filtered.filter((sale) => sale.store?.name === storeFilter)
        }

        return filtered
    }, [sales, searchQuery, statusFilter, storeFilter, isGlobal])

    // Pagination
    const totalItems = filteredSales.length
    const totalPages = Math.ceil(totalItems / pageSize)
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalItems)
    const currentSales = filteredSales.slice(startIndex, endIndex)

    // Reset to first page when filters change
    useMemo(() => {
        setCurrentPage(1)
    }, [searchQuery, statusFilter, storeFilter, pageSize])

    // Clear all filters
    const clearFilters = () => {
        setSearchQuery('')
        setStatusFilter('all')
        setStoreFilter('all')
        setCurrentPage(1)
    }

    // Check if any filters are active
    const hasActiveFilters = searchQuery || statusFilter !== 'all' || storeFilter !== 'all'

    const colSpan = isGlobal ? (canAction ? 6 : 5) : canAction ? 5 : 4

    if (isLoading) {
        return (
            <div className='p-4'>
                <Table>
                    <TableHeader>
                        <TableRow>
                            {isGlobal && <TableHead>Store</TableHead>}
                            <TableHead>Customer</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            {canAction && <TableHead />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: pageSize }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell colSpan={colSpan}>
                                    <Skeleton className="h-4 w-full" />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        )
    }

    return (
        <div className="space-y-4 p-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-50 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search customer or store..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8"
                    />
                    {searchQuery && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-7 w-7"
                            onClick={() => setSearchQuery('')}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    )}
                </div>

                {/* Status filter */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-35">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="refunded">Refunded</SelectItem>
                        <SelectItem value="voided">Voided</SelectItem>
                    </SelectContent>
                </Select>

                {/* Store filter - only for global users */}
                {isGlobal && stores.length > 0 && (
                    <Select value={storeFilter} onValueChange={setStoreFilter}>
                        <SelectTrigger className="w-37.5">
                            <SelectValue placeholder="Store" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All stores</SelectItem>
                            {stores.map((storeName) => (
                                <SelectItem key={storeName} value={storeName}>
                                    {storeName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Clear filters button */}
                {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                    </Button>
                )}

                {/* Results count */}
                <span className="text-sm text-muted-foreground ml-auto">
                    {totalItems} result{totalItems !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Table */}
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {isGlobal && <TableHead>Store</TableHead>}
                            <TableHead>Customer</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            {canAction && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {currentSales.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={colSpan} className="py-12 text-center text-muted-foreground">
                                    {hasActiveFilters ? 'No sales match your filters' : 'No sales found'}
                                </TableCell>
                            </TableRow>
                        )}

                        {currentSales.map((sale) => (
                            <TableRow
                                key={sale._id}
                                className="cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => onSelectSale(sale._id)}
                            >
                                {isGlobal && (
                                    <TableCell>{sale.store?.name ?? 'Unknown'}</TableCell>
                                )}
                                <TableCell className="font-medium">
                                    {sale.customer?.name ?? 'Walk-in'}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={getStatusVariant(sale.status)}>
                                        {sale.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {formatTimestamp(sale.createdAt)}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                    {formatCurrency(sale.totalAmount)}
                                </TableCell>
                                {canAction && (
                                    <TableCell
                                        className="text-right"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {sale.status === 'completed' && (
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                                                    title="Void"
                                                    onClick={() => onVoid(sale._id)}
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                                                    title="Refund"
                                                    onClick={() => onRefund(sale._id)}
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {totalItems > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>
                            Showing {startIndex + 1} to {endIndex} of {totalItems} results
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Page size selector */}
                        <Select
                            value={String(pageSize)}
                            onValueChange={(value) => setPageSize(Number(value))}
                        >
                            <SelectTrigger className="w-30">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZE_OPTIONS.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size} per page
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Pagination controls */}
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                            >
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setCurrentPage(currentPage - 1)}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>

                            <span className="px-3 text-sm">
                                Page {currentPage} of {totalPages || 1}
                            </span>

                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setCurrentPage(currentPage + 1)}
                                disabled={currentPage === totalPages || totalPages === 0}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage === totalPages || totalPages === 0}
                            >
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}