import { useAuthActions } from '@convex-dev/auth/react'
import { useRouter } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
    const { signOut } = useAuthActions()
    const router = useRouter()

    const handleLogout = async () => {
        await signOut()
        router.navigate({ to: '/sign-in', replace: true })
    }

    return (
        <button
            onClick={handleLogout}
            className="
        flex w-full items-center gap-2 rounded-md
        px-2 py-1.5 text-sm
        text-foreground
        hover:bg-accent
        hover:text-accent-foreground
        transition-colors
      "
        >
            <LogOut className="size-4" />
            <span>Logout</span>
        </button>
    )
}