import { useParams } from 'react-router-dom'
import { usePost } from '@/hooks/usePost'
import { MarkdownRenderer } from '@/components/blog/MarkdownRenderer'
import { PostMeta } from '@/components/blog/PostMeta'
import { Breadcrumbs, type Crumb } from '@/components/blog/Breadcrumbs'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Seo } from '@/components/common/Seo'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from '@/lib/seo/jsonld'

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const { post, isLoading, error } = usePost(slug)

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !post || post.status !== 'published') {
    return <NotFoundPage />
  }

  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }]
  if (post.category) {
    crumbs.push({
      label: post.category.name,
      to: `/category/${post.category.slug}`,
    })
  }
  if (post.subcategory) {
    crumbs.push({
      label: post.subcategory.name,
      to: `/category/${post.category!.slug}/${post.subcategory.slug}`,
    })
  }
  crumbs.push({ label: post.title })

  const siteUrl = window.location.origin

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <Seo
        title={post.title}
        description={post.excerpt ?? undefined}
        image={post.cover_image_url ?? undefined}
        type="article"
        publishedAt={post.published_at ?? undefined}
        modifiedAt={post.updated_at}
        tags={post.tags}
        jsonLd={[
          buildArticleJsonLd(post, siteUrl),
          buildBreadcrumbJsonLd(
            crumbs.map((c) => ({ label: c.label, path: c.to ?? `/blog/${post.slug}` })),
            siteUrl,
          ),
        ]}
      />

      <Breadcrumbs items={crumbs} />

      <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">{post.title}</h1>
      <PostMeta post={post} className="mt-4" />

      {post.cover_image_url && (
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="mt-8 aspect-video w-full rounded-lg border border-border object-cover"
        />
      )}

      <MarkdownRenderer content={post.content} className="mt-10" />
    </article>
  )
}
