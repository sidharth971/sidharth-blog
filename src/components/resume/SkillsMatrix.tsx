import type { SkillGroup } from '@/types/profile'
import { Badge } from '@/components/ui/badge'

export function SkillsMatrix({ groups }: { groups: SkillGroup[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {groups.map((group) => (
        <div key={group.category}>
          <p className="mb-2 text-sm font-medium text-foreground">{group.category}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.skills.map((skill) => (
              <Badge key={skill} variant="outline" className="font-normal">
                {skill}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
