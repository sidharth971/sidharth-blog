import { CalendarDays, Clock } from 'lucide-react'
import { formatDate } from '@/lib/dateFormat'
import { readingTime } from '@/lib/readingTime'
import { Badge } from '@/components/ui/badge'
import type { Post } from '@/types/post'

export function PostMeta({ post, className }: { post: Post; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3.5" />
          {formatDate(post.published_at ?? post.created_at)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {readingTime(post.content)} min read
        </span>
      </div>
      {post.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
