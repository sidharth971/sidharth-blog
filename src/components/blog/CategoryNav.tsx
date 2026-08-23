import { Link, useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useCategories } from '@/hooks/useCategories'

export function CategoryNav() {
  const { categories, isLoading } = useCategories()
  const { categorySlug } = useParams<{ categorySlug?: string }>()

  if (isLoading || categories.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to="/"
        className={cn(
          'rounded-full border px-3 py-1 text-sm transition-colors hover:border-brand hover:text-brand',
          !categorySlug ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground',
        )}
      >
        All
      </Link>
      {categories.map((category) => (
        <Link
          key={category.id}
          to={`/category/${category.slug}`}
          className={cn(
            'rounded-full border px-3 py-1 text-sm transition-colors hover:border-brand hover:text-brand',
            categorySlug === category.slug
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-muted-foreground',
          )}
        >
          {category.name}
        </Link>
      ))}
    </div>
  )
}
