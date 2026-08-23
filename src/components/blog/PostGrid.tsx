import { Newspaper } from 'lucide-react'
import type { Post } from '@/types/post'
import { PostCard } from '@/components/blog/PostCard'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

export function PostGrid({ posts, isLoading, error }: { posts: Post[]; isLoading: boolean; error: Error | null }) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return <EmptyState icon={Newspaper} title="Couldn't load posts" description={error.message} />
  }

  if (posts.length === 0) {
    return (
      <EmptyState icon={Newspaper} title="No posts yet" description="Check back soon — new posts are published regularly." />
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  )
}
