import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

export type Role = "admin" | "doctor" | "pharmacist" | "cashier"

export function useRole() {
    const user = useQuery(api.users.getUserProfile)

    return {
        role: user?.role as Role | undefined,
        isLoading: user === undefined,
        isAdmin: user?.role === "admin",
        isDoctor: user?.role === "doctor",
        isPharmacist: user?.role === "pharmacist",
        isCashier: user?.role === "cashier",
        hasRole: (roles: Role[]) => !!user?.role && roles.includes(user.role as Role),
    }
}