import { Link } from 'react-router-dom'
import { PenSquare } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { profile } from '@/data/profile'

export function ProfileHeader() {
  return (
    <div className="flex flex-col items-start justify-between gap-4 rounded-lg border bg-card p-6 sm:flex-row sm:items-center">
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="bg-brand text-lg font-semibold text-brand-foreground">
            {profile.name
              .split(' ')
              .map((p) => p[0])
              .join('')}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-lg font-semibold">{profile.name}</h1>
          <p className="text-sm text-muted-foreground">
            {profile.title} · {profile.currentCompany}
          </p>
        </div>
      </div>
      <Button asChild>
        <Link to="/dashboard/compose">
          <PenSquare className="size-4" />
          Write a post
        </Link>
      </Button>
    </div>
  )
}
