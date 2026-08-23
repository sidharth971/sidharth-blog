import { useMemo, useState } from 'react'
import { usePublishedPosts } from '@/hooks/usePosts'
import { PostGrid } from '@/components/blog/PostGrid'
import { CategoryNav } from '@/components/blog/CategoryNav'
import { TagFilter } from '@/components/blog/TagFilter'
import { Seo } from '@/components/common/Seo'
import { buildBlogJsonLd } from '@/lib/seo/jsonld'
import { profile } from '@/data/profile'

export function BlogHomePage() {
  const { posts, isLoading, error } = usePublishedPosts()
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    posts.forEach((post) => post.tags.forEach((tag) => set.add(tag)))
    return Array.from(set).sort()
  }, [posts])

  const filteredPosts = useMemo(
    () => (activeTag ? posts.filter((post) => post.tags.includes(activeTag)) : posts),
    [posts, activeTag],
  )

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <Seo
        title="Home"
        description={`Notes from ${profile.name} on ${profile.title.toLowerCase()} — AWS, DevOps, MLOps, AIOps, and SRE.`}
        jsonLd={buildBlogJsonLd(profile, window.location.origin)}
      />
      <div className="mb-10 space-y-3">
        <p className="text-sm font-medium text-brand">{profile.name}</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Notes on DevOps, MLOps, AIOps & SRE</h1>
        <p className="max-w-2xl text-muted-foreground">
          Lessons from building and operating cloud-native and generative AI systems — AWS, Kubernetes, Terraform,
          CI/CD, and everything in between.
        </p>
      </div>

      <CategoryNav />

      {allTags.length > 0 && <TagFilter tags={allTags} active={activeTag} onChange={setActiveTag} className="mt-4" />}

      <div className="mt-8">
        <PostGrid posts={filteredPosts} isLoading={isLoading} error={error} />
      </div>
    </div>
  )
}
