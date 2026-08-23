import { Link } from 'react-router-dom'
import { CalendarDays, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/dateFormat'
import { readingTime } from '@/lib/readingTime'
import type { Post } from '@/types/post'

export function PostCard({ post }: { post: Post }) {
  return (
    <Link to={`/blog/${post.slug}`}>
      <Card className="group h-full gap-3 overflow-hidden py-0 transition-colors hover:border-brand/50">
        {post.cover_image_url && (
          <div className="aspect-video w-full overflow-hidden bg-muted">
            <img
              src={post.cover_image_url}
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-5 pt-4">
          {post.category && (
            <p className="text-xs font-medium text-brand">
              {post.category.name}
              {post.subcategory && ` · ${post.subcategory.name}`}
            </p>
          )}
          <h3 className="line-clamp-2 font-semibold tracking-tight text-balance group-hover:text-brand">
            {post.title}
          </h3>
          {post.excerpt && <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>}
          <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" />
              {formatDate(post.published_at ?? post.created_at)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {readingTime(post.content)} min
            </span>
          </div>
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {post.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Link>
  )
}
