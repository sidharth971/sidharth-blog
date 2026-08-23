import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, PenSquare, FolderTree, Newspaper, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { profile } from '@/data/profile'

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/dashboard/compose', label: 'New Post', icon: PenSquare, end: false },
  { to: '/dashboard/categories', label: 'Categories', icon: FolderTree, end: true },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/')
    onNavigate?.()
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2 pt-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          {profile.name
            .split(' ')
            .map((p) => p[0])
            .join('')}
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{profile.name}</p>
          <p className="text-xs text-muted-foreground">Dashboard</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-accent text-accent-foreground',
              )
            }
          >
            <item.icon className="size-4" />
            {item.label}
          </NavLink>
        ))}

        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Newspaper className="size-4" />
          View Blog
        </Link>
      </nav>

      <Button variant="ghost" className="justify-start gap-2.5 text-muted-foreground" onClick={handleSignOut}>
        <LogOut className="size-4" />
        Logout
      </Button>
    </div>
  )
}
