import { NavLink, Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { useCategories } from '@/hooks/useCategories'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { profile } from '@/data/profile'

export function TopNav() {
  const { categories } = useCategories()

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
            {profile.name
              .split(' ')
              .map((p) => p[0])
              .join('')}
          </span>
          <span className="hidden sm:inline">{profile.name}</span>
        </NavLink>

        <nav className="flex items-center gap-1">
          {categories.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none">
                Categories
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {categories.map((category) => (
                  <DropdownMenuItem key={category.id} asChild>
                    <Link to={`/category/${category.slug}`}>{category.name}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <NavLink
            to="/resume"
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                isActive && 'text-foreground',
              )
            }
          >
            Resume
          </NavLink>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
