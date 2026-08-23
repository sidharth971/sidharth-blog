import type { Project } from '@/types/profile'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/SectionHeading'

export function ProjectsGrid({ projects }: { projects: Project[] }) {
  return (
    <div>
      <SectionHeading eyebrow="Selected work" title="Projects" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Card key={project.id} className="p-5">
            <p className="text-xs font-medium text-brand">{project.category}</p>
            <h3 className="mt-1 font-medium">{project.name}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{project.description}</p>
            {project.tags && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
