import type { ExperienceEntry } from '@/types/profile'
import { formatMonthYear, formatDuration } from '@/lib/dateFormat'
import { Badge } from '@/components/ui/badge'

function groupByCompany(entries: ExperienceEntry[]) {
  const groups: { key: string; company: string; entries: ExperienceEntry[] }[] = []
  for (const entry of entries) {
    const key = entry.companyGroupId ?? entry.id
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.entries.push(entry)
    } else {
      groups.push({ key, company: entry.company, entries: [entry] })
    }
  }
  return groups
}

export function TimelineSection({ entries }: { entries: ExperienceEntry[] }) {
  const groups = groupByCompany(entries)

  return (
    <ol className="space-y-10">
      {groups.map((group, index) => (
        <li key={group.key} className="relative pl-6">
          <span className="absolute top-1.5 left-0 size-2.5 rounded-full bg-brand" />
          {index < groups.length - 1 && (
            <span className="absolute top-4 left-[4.5px] -bottom-10 w-px bg-border" />
          )}

          <p className="font-semibold text-foreground">{group.company}</p>

          <div className="mt-4 space-y-6">
            {group.entries.map((entry) => (
              <div key={entry.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-medium text-foreground">{entry.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatMonthYear(entry.startDate)} – {entry.endDate ? formatMonthYear(entry.endDate) : 'Present'}
                    <span className="ml-1.5 text-xs">({formatDuration(entry.startDate, entry.endDate)})</span>
                  </p>
                </div>

                {entry.summary && <p className="mt-1.5 text-sm text-muted-foreground">{entry.summary}</p>}

                {entry.isPlaceholder ? (
                  <p className="mt-2 text-sm text-muted-foreground italic">
                    Details to be added.
                  </p>
                ) : (
                  entry.bullets.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground marker:text-brand">
                      {entry.bullets.map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                    </ul>
                  )
                )}

                {entry.skills && entry.skills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="font-normal">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}
