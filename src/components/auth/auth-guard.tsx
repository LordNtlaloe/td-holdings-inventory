import { useConvexAuth } from 'convex/react'
import { Navigate } from '@tanstack/react-router'
import { useRole, type Role } from '#/hooks/use-role'

interface AuthGuardProps {
    children: React.ReactNode
    redirectTo?: string
}

interface RoleGuardProps {
    children: React.ReactNode
    allowed: Role[]
    redirectTo?: string
}

function Spinner() {
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
    )
}

export function AuthGuard({ children, redirectTo = '/sign-in' }: AuthGuardProps) {
    const { isLoading, isAuthenticated } = useConvexAuth()

    if (isLoading) return <Spinner />
    if (!isAuthenticated) return <Navigate to={redirectTo} replace />

    return <>{children}</>
}

export function RoleGuard({ children, allowed, redirectTo = '/dashboard' }: RoleGuardProps) {
    const { isLoading, hasRole } = useRole()

    if (isLoading) return <Spinner />
    if (!hasRole(allowed)) return <Navigate to={redirectTo} replace />

    return <>{children}</>
}

export function GuestGuard({ children, redirectTo = '/dashboard' }: AuthGuardProps) {
    const { isLoading, isAuthenticated } = useConvexAuth()

    if (isLoading) return <Spinner />
    if (isAuthenticated) return <Navigate to={redirectTo} replace />

    return <>{children}</>
}