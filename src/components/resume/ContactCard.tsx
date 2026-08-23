import { Mail, MapPin, Phone } from 'lucide-react'
import { GithubIcon, LinkedinIcon } from '@/components/common/BrandIcons'
import type { Profile } from '@/types/profile'

const iconMap = { github: GithubIcon, linkedin: LinkedinIcon, mail: Mail, phone: Phone, 'map-pin': MapPin }

export function ContactCard({ profile, className }: { profile: Profile; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground ${className ?? ''}`}>
      {profile.location && (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4" />
          {profile.location}
        </span>
      )}
      {profile.phone && (
        <span className="inline-flex items-center gap-1.5">
          <Phone className="size-4" />
          {profile.phone}
        </span>
      )}
      {profile.links.map((link) => {
        const Icon = iconMap[link.icon]
        return (
          <a
            key={link.label}
            href={link.url}
            target={link.url.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <Icon className="size-4" />
            {link.label}
          </a>
        )
      })}
    </div>
  )
}
