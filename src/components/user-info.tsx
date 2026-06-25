import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

function getInitials(name: string) {
    return name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
}

interface UserInfoProps {
    showEmail?: boolean
}

export function UserInfo({ showEmail = false }: UserInfoProps) {
    const user = useQuery(api.users.getUserProfile)

    if (!user) return null

    return (
        <>
            <Avatar className="h-8 w-8 overflow-hidden rounded-full">
                <AvatarImage src={user.image} alt={user.name} />
                <AvatarFallback className="rounded-lg bg-neutral-200 text-black dark:bg-neutral-700 dark:text-white">
                    {getInitials(user.name)}
                </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                {showEmail && (
                    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                )}
            </div>
        </>
    )
}