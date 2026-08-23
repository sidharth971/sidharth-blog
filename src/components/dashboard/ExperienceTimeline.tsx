import { Link } from 'react-router-dom'
import type { ExperienceEntry } from '@/types/profile'
import { formatMonthYear } from '@/lib/dateFormat'
import { Card } from '@/components/ui/card'
import { SectionHeading } from '@/components/common/SectionHeading'

export function ExperienceTimeline({ entries }: { entries: ExperienceEntry[] }) {
  return (
    <Card className="p-5">
      <SectionHeading
        eyebrow="Career"
        title="Experience"
        action={
          <Link to="/resume" className="text-sm text-brand hover:underline">
            Full resume
          </Link>
        }
      />
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
            <div>
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="text-xs text-muted-foreground">{entry.company}</p>
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">
              {formatMonthYear(entry.startDate)} – {entry.endDate ? formatMonthYear(entry.endDate) : 'Present'}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
