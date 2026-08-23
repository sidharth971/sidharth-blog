import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Seo } from '@/components/common/Seo'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-6 text-center">
      <Seo title="Page not found" />
      <Compass className="size-10 text-muted-foreground" strokeWidth={1.5} />
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
      </div>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  )
}
