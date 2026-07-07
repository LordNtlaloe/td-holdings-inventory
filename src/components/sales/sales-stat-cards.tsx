import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Receipt, RotateCcw, XCircle } from 'lucide-react'
import { formatCurrency } from './sales-utils'
import type { SalesStats } from '#/types/sales'

interface SalesStatCardsProps {
    stats: SalesStats
    isLoading?: boolean
}

function StatCard({
    title,
    value,
    sub,
    icon: Icon,
}: {
    title: string
    value: string | number
    sub: string
    icon: React.ElementType
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
        </Card>
    )
}

export function SalesStatCards({ stats, isLoading }: SalesStatCardsProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i}>
                        <CardContent className="p-6">
                            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
                            <div className="mt-2 h-4 w-16 animate-pulse rounded bg-muted" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
                title="Revenue"
                value={formatCurrency(stats.totalRevenue)}
                sub="Completed sales"
                icon={TrendingUp}
            />
            <StatCard
                title="Sales Count"
                value={stats.salesCount}
                sub="Completed transactions"
                icon={Receipt}
            />
            <StatCard
                title="Avg Order Value"
                value={formatCurrency(stats.avgOrderValue)}
                sub="Per completed sale"
                icon={TrendingUp}
            />
            <StatCard
                title="Refunds / Voids"
                value={`${stats.refundCount} / ${stats.voidCount}`}
                sub="In selected period"
                icon={RotateCcw}
            />
            <StatCard
                title="Cancelled"
                value={stats.cancelledCount}
                sub="Sales cancelled"
                icon={XCircle}
            />
        </div>
    )
}