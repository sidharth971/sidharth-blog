import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function TagFilter({
  tags,
  active,
  onChange,
  className,
}: {
  tags: string[]
  active: string | null
  onChange: (tag: string | null) => void
  className?: string
}) {
  if (tags.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <Badge
        variant={active === null ? 'default' : 'outline'}
        className="cursor-pointer select-none"
        onClick={() => onChange(null)}
      >
        All
      </Badge>
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant={active === tag ? 'default' : 'outline'}
          className="cursor-pointer select-none"
          onClick={() => onChange(active === tag ? null : tag)}
        >
          {tag}
        </Badge>
      ))}
    </div>
  )
}
