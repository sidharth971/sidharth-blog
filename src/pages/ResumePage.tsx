import { Printer } from 'lucide-react'
import { profile } from '@/data/profile'
import { TimelineSection } from '@/components/resume/TimelineSection'
import { SkillsMatrix } from '@/components/resume/SkillsMatrix'
import { ContactCard } from '@/components/resume/ContactCard'
import { SectionHeading } from '@/components/common/SectionHeading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Seo } from '@/components/common/Seo'
import { buildPersonJsonLd } from '@/lib/seo/jsonld'

export function ResumePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 print:py-0">
      <Seo title="Resume" description={profile.summary} jsonLd={buildPersonJsonLd(profile, window.location.origin)} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand">Resume</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{profile.name}</h1>
          <p className="mt-1 text-lg text-muted-foreground">{profile.title}</p>
        </div>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="size-3.5" />
          Print / Save PDF
        </Button>
      </div>

      <ContactCard profile={profile} className="mt-6" />

      <p className="mt-8 leading-relaxed text-muted-foreground">{profile.summary}</p>

      <div className="mt-14">
        <SectionHeading eyebrow="Career" title="Experience" />
        <TimelineSection entries={profile.experience} />
      </div>

      <div className="mt-14">
        <SectionHeading eyebrow="Capabilities" title="Skills" />
        <SkillsMatrix groups={profile.skills} />
      </div>

      <div className="mt-14">
        <SectionHeading eyebrow="Selected work" title="Projects" />
        <div className="space-y-6">
          {profile.projects.map((project) => (
            <div key={project.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="font-medium">{project.name}</h3>
                {project.period && <p className="text-sm text-muted-foreground">{project.period}</p>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
              {project.tags && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-10 sm:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Credentials" title="Certifications" />
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {profile.certifications.map((cert) => (
              <li key={cert.name}>
                {cert.name} <span className="text-xs">({cert.year})</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Background" title="Education" />
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {profile.education.map((edu) => (
              <li key={edu.institution}>
                {edu.degree}{edu.field ? `, ${edu.field}` : ''} — {edu.institution}
                {edu.year && <span className="text-xs"> ({edu.year})</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
