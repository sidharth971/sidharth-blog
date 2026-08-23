import type { SkillGroup } from '@/types/profile'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/SectionHeading'

export function SkillsPanel({ groups }: { groups: SkillGroup[] }) {
  return (
    <Card className="p-5">
      <SectionHeading eyebrow="Capabilities" title="Skills" />
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.category}>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{group.category}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.skills.map((skill) => (
                <Badge key={skill} variant="secondary" className="font-normal">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
