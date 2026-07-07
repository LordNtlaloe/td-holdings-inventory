import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

export function useStats() {
    return useQuery(api.dashboard.getStats)
}