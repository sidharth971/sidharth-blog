import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Sidebar } from '@/components/layout/Sidebar'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/compose': 'New Post',
  '/dashboard/categories': 'Categories',
}

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const title =
    pageTitles[location.pathname] ?? (location.pathname.startsWith('/dashboard/compose') ? 'Edit Post' : 'Dashboard')

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-background md:block">
        <Sidebar />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border/60 bg-background px-4 md:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="size-4" />
            </Button>
            <h1 className="text-sm font-semibold">{title}</h1>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
