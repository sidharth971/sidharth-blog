import { Outlet } from 'react-router-dom'
import { TopNav } from '@/components/layout/TopNav'
import { Footer } from '@/components/layout/Footer'

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
