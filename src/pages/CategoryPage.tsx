import { Link, useParams } from 'react-router-dom'
import { usePublishedPosts } from '@/hooks/usePosts'
import { useCategories } from '@/hooks/useCategories'
import { PostGrid } from '@/components/blog/PostGrid'
import { CategoryNav } from '@/components/blog/CategoryNav'
import { Breadcrumbs } from '@/components/blog/Breadcrumbs'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Seo } from '@/components/common/Seo'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { buildBreadcrumbJsonLd } from '@/lib/seo/jsonld'
import { cn } from '@/lib/utils'

export function CategoryPage() {
  const { categorySlug, subcategorySlug } = useParams<{ categorySlug: string; subcategorySlug?: string }>()
  const { categories, isLoading: categoriesLoading } = useCategories()
  const { posts, isLoading: postsLoading, error } = usePublishedPosts({ categorySlug, subcategorySlug })

  if (categoriesLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    )
  }

  const category = categories.find((c) => c.slug === categorySlug)
  if (!category) return <NotFoundPage />

  const subcategory = subcategorySlug ? category.subcategories.find((s) => s.slug === subcategorySlug) : undefined
  if (subcategorySlug && !subcategory) return <NotFoundPage />

  const title = subcategory ? `${subcategory.name} · ${category.name}` : category.name
  const crumbItems = [
    { label: 'Home', to: '/' },
    { label: category.name, to: subcategory ? `/category/${category.slug}` : undefined },
    ...(subcategory ? [{ label: subcategory.name }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <Seo
        title={title}
        description={`Posts about ${title} — ${category.name} notes and write-ups.`}
        jsonLd={buildBreadcrumbJsonLd(
          crumbItems.map((c) => ({ label: c.label, path: c.to ?? `/category/${category.slug}` })),
          window.location.origin,
        )}
      />

      <Breadcrumbs items={crumbItems} />

      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>

      <div className="mt-8">
        <CategoryNav />
      </div>

      {category.subcategories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to={`/category/${category.slug}`}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors hover:border-brand hover:text-brand',
              !subcategory ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground',
            )}
          >
            All {category.name}
          </Link>
          {category.subcategories.map((sub) => (
            <Link
              key={sub.id}
              to={`/category/${category.slug}/${sub.slug}`}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors hover:border-brand hover:text-brand',
                subcategory?.slug === sub.slug
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-muted-foreground',
              )}
            >
              {sub.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <PostGrid posts={posts} isLoading={postsLoading} error={error} />
      </div>
    </div>
  )
}
