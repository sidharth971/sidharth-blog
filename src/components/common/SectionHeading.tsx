import type { ReactNode } from 'react'

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</p>
        )}
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  )
}
