import { useMemo, useState } from 'react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from './sales-utils'

const COLORS = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#6366f1',
    '#84cc16',
]

interface SalesChartsProps {
    salesData: any[]
    isLoading: boolean
    isGlobal: boolean
}

// Helper to get week number
function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// Helper to get Monday of the week
function getMonday(date: Date): Date {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    d.setHours(0, 0, 0, 0)
    return d
}

// Helper to get week label
function getWeekLabel(date: Date): string {
    const monday = getMonday(date)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    const month = monday.toLocaleString('default', { month: 'short' })
    const day1 = monday.getDate()
    const day2 = sunday.getDate()
    return `${month} ${day1} - ${day2}`
}

export function SalesCharts({ salesData, isLoading, isGlobal }: SalesChartsProps) {
    const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '12m'>('30d')
    const [chartView, setChartView] = useState<'overview' | 'departments' | 'stores'>('overview')

    // Calculate department sales
    const departmentSales = useMemo(() => {
        if (!salesData || salesData.length === 0) return []

        const deptMap = new Map<string, { revenue: number; count: number }>()

        salesData.forEach((sale: any) => {
            if (sale.status !== 'completed') return

            sale.items?.forEach((item: any) => {
                const deptName = item.product?.department?.name || 'Uncategorized'
                const existing = deptMap.get(deptName)
                if (existing) {
                    existing.revenue += item.unitPrice * item.quantity
                    existing.count += 1
                } else {
                    deptMap.set(deptName, {
                        revenue: item.unitPrice * item.quantity,
                        count: 1,
                    })
                }
            })
        })

        return Array.from(deptMap.entries())
            .map(([name, data]) => ({
                departmentName: name,
                revenue: data.revenue,
                count: data.count,
            }))
            .sort((a, b) => b.revenue - a.revenue)
    }, [salesData])

    // Calculate store sales
    const storeSales = useMemo(() => {
        if (!salesData || salesData.length === 0) return []

        const storeMap = new Map<string, { revenue: number; count: number }>()

        salesData.forEach((sale: any) => {
            if (sale.status !== 'completed') return
            const storeName = sale.store?.name || 'Unknown'
            const existing = storeMap.get(storeName)
            if (existing) {
                existing.revenue += sale.totalAmount
                existing.count += 1
            } else {
                storeMap.set(storeName, {
                    revenue: sale.totalAmount,
                    count: 1,
                })
            }
        })

        return Array.from(storeMap.entries())
            .map(([name, data]) => ({
                storeName: name,
                revenue: data.revenue,
                count: data.count,
            }))
            .sort((a, b) => b.revenue - a.revenue)
    }, [salesData])

    // Calculate timeline data - grouped by week (Monday to Sunday)
    const timelineData = useMemo(() => {
        if (!salesData || salesData.length === 0) return []

        const now = new Date()
        let days: number

        switch (timeRange) {
            case '7d':
                days = 7
                break
            case '30d':
                days = 30
                break
            case '90d':
                days = 90
                break
            case '12m':
                days = 365
                break
            default:
                days = 30
        }

        const startDate = new Date(now)
        startDate.setDate(startDate.getDate() - days)

        // For 12 months, group by month
        if (timeRange === '12m') {
            const monthMap = new Map<string, { revenue: number; count: number }>()
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

            salesData.forEach((sale: any) => {
                if (sale.status !== 'completed') return
                const date = new Date(sale.createdAt)
                const monthKey = months[date.getMonth()]
                const yearKey = date.getFullYear()
                const key = `${monthKey} ${yearKey}`

                const existing = monthMap.get(key)
                if (existing) {
                    existing.revenue += sale.totalAmount
                    existing.count += 1
                } else {
                    monthMap.set(key, {
                        revenue: sale.totalAmount,
                        count: 1,
                    })
                }
            })

            // Get last 12 months
            const result: any[] = []
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now)
                d.setMonth(d.getMonth() - i)
                const monthKey = months[d.getMonth()]
                const yearKey = d.getFullYear()
                const key = `${monthKey} ${yearKey}`
                const data = monthMap.get(key) || { revenue: 0, count: 0 }
                result.push({
                    period: key,
                    revenue: data.revenue,
                    count: data.count,
                })
            }
            return result
        }

        // For weeks, group by Monday-Sunday
        const weekMap = new Map<string, { 
            revenue: number; 
            count: number; 
            monday: Date 
        }>()

        // Process sales data - only include sales after startDate
        salesData.forEach((sale: any) => {
            if (sale.status !== 'completed') return
            const date = new Date(sale.createdAt)
            if (date >= startDate) {
                const monday = getMonday(date)
                const weekKey = monday.toISOString().split('T')[0]
                const existing = weekMap.get(weekKey)
                if (existing) {
                    existing.revenue += sale.totalAmount
                    existing.count += 1
                } else {
                    weekMap.set(weekKey, {
                        revenue: sale.totalAmount,
                        count: 1,
                        monday: monday,
                    })
                }
            }
        })

        // Fill in missing weeks
        const result: any[] = []
        const currentDate = new Date(now)
        const startCopy = new Date(startDate)
        
        // Find the Monday of the start week
        let currentMonday = getMonday(startCopy)
        
        // Loop through weeks until we reach current week
        while (currentMonday <= currentDate) {
            const weekKey = currentMonday.toISOString().split('T')[0]
            const data = weekMap.get(weekKey) || { 
                revenue: 0, 
                count: 0, 
                monday: currentMonday 
            }
            
            // Get the Sunday of this week
            const sunday = new Date(currentMonday)
            sunday.setDate(sunday.getDate() + 6)
            
            result.push({
                period: getWeekLabel(currentMonday),
                revenue: data.revenue,
                count: data.count,
                monday: currentMonday.getTime(),
                weekNumber: getWeekNumber(currentMonday),
            })
            
            // Move to next week (Monday + 7 days)
            currentMonday.setDate(currentMonday.getDate() + 7)
        }
        
        return result
    }, [salesData, timeRange])

    // Calculate total revenue
    const totalRevenue = useMemo(() => {
        return timelineData.reduce((sum, d) => sum + d.revenue, 0)
    }, [timelineData])

    // Calculate average daily revenue
    const avgRevenue = useMemo(() => {
        if (timelineData.length === 0) return 0
        return totalRevenue / timelineData.length
    }, [timelineData, totalRevenue])

    // Tooltip formatter helper
    const formatTooltipValue = (value: any) => {
        if (typeof value === 'number') {
            return formatCurrency(value)
        }
        return String(value)
    }

    if (isLoading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i}>
                        <CardHeader>
                            <Skeleton className="h-5 w-32" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-50 w-full" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    if (!salesData || salesData.length === 0) {
        return (
            <Card>
                <CardContent className="flex h-75 items-center justify-center">
                    <p className="text-muted-foreground">No sales data available for charts</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header with controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold">Sales Analytics</h2>
                    <p className="text-sm text-muted-foreground">
                        Total Revenue: {formatCurrency(totalRevenue)} · Avg {formatCurrency(avgRevenue)} per period
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Select value={timeRange} onValueChange={(v: any) => setTimeRange(v)}>
                        <SelectTrigger className="w-30">
                            <SelectValue placeholder="Time range" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7d">Last 7 days</SelectItem>
                            <SelectItem value="30d">Last 30 days</SelectItem>
                            <SelectItem value="90d">Last 90 days</SelectItem>
                            <SelectItem value="12m">Last 12 months</SelectItem>
                        </SelectContent>
                    </Select>

                    <Tabs value={chartView} onValueChange={(v: any) => setChartView(v)}>
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="departments">Departments</TabsTrigger>
                            {isGlobal && <TabsTrigger value="stores">Stores</TabsTrigger>}
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            {/* Charts - Side by side grid */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* Timeline Chart - Week view */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">
                            Revenue Timeline (Week-by-Week)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={timelineData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis
                                    dataKey="period"
                                    tick={{ fontSize: 10 }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={60}
                                />
                                <YAxis
                                    tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                    formatter={formatTooltipValue}
                                    labelFormatter={(label) => `Week: ${label}`}
                                />
                                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Department Pie Chart */}
                {(chartView === 'overview' || chartView === 'departments') && departmentSales.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">
                                Revenue by Department
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={250}>
                                <PieChart>
                                    <Pie
                                        data={departmentSales.slice(0, 8)}
                                        dataKey="revenue"
                                        nameKey="departmentName"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        label={({ name, percent }) => {
                                            const pct = percent || 0
                                            return `${name}: ${(pct * 100).toFixed(0)}%`
                                        }}
                                    >
                                        {departmentSales.slice(0, 8).map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={COLORS[index % COLORS.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={formatTooltipValue} />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                )}

                {/* Store Chart - only if global */}
                {isGlobal && (chartView === 'overview' || chartView === 'stores') && storeSales.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">
                                Revenue by Store
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart data={storeSales.slice(0, 8)}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis
                                        dataKey="storeName"
                                        tick={{ fontSize: 10 }}
                                        angle={-45}
                                        textAnchor="end"
                                        height={60}
                                    />
                                    <YAxis
                                        tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                                    />
                                    <Tooltip formatter={formatTooltipValue} />
                                    <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                )}

                {/* Department Bar Chart - detailed view */}
                {chartView === 'departments' && departmentSales.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">
                                Department Performance
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart
                                    data={departmentSales.slice(0, 8)}
                                    layout="vertical"
                                    margin={{ left: 60 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis
                                        type="number"
                                        tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                                    />
                                    <YAxis type="category" dataKey="departmentName" />
                                    <Tooltip formatter={formatTooltipValue} />
                                    <Bar dataKey="revenue" fill="#22c55e" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}