import { Link } from 'react-router-dom'
import { FileText, Plus } from 'lucide-react'
import type { Post } from '@/types/post'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/components/common/SectionHeading'
import { EmptyState } from '@/components/common/EmptyState'
import { formatRelative } from '@/lib/dateFormat'

export function RecentPostsWidget({ posts }: { posts: Post[] }) {
  const recent = posts.slice(0, 5)

  return (
    <Card className="p-5">
      <SectionHeading
        eyebrow="Writing"
        title="Recent posts"
        action={
          <Button asChild size="sm">
            <Link to="/dashboard/compose">
              <Plus className="size-3.5" />
              New post
            </Link>
          </Button>
        }
      />

      {recent.length === 0 ? (
        <EmptyState icon={FileText} title="No posts yet" description="Write your first post to get started." />
      ) : (
        <ul className="space-y-1">
          {recent.map((post) => (
            <li key={post.id}>
              <Link
                to={`/dashboard/compose/${post.id}`}
                className="flex items-center justify-between gap-4 rounded-md px-2 py-2.5 -mx-2 hover:bg-accent"
              >
                <span className="truncate text-sm font-medium">{post.title || 'Untitled'}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant={post.status === 'published' ? 'default' : 'secondary'} className="font-normal">
                    {post.status}
                  </Badge>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatRelative(post.updated_at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
