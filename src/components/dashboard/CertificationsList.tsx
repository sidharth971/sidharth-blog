import { Award } from 'lucide-react'
import type { Certification } from '@/types/profile'
import { Card } from '@/components/ui/card'
import { SectionHeading } from '@/components/common/SectionHeading'

export function CertificationsList({ certifications }: { certifications: Certification[] }) {
  return (
    <Card className="p-5">
      <SectionHeading eyebrow="Credentials" title="Certifications" />
      <ul className="space-y-2.5">
        {certifications.map((cert) => (
          <li key={cert.name} className="flex items-center gap-2.5 text-sm">
            <Award className="size-4 shrink-0 text-brand" />
            <span>
              {cert.name} <span className="text-muted-foreground">· {cert.year}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
