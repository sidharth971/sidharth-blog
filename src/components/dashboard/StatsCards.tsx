import type { LucideIcon } from 'lucide-react'
import { Briefcase, FileText, Globe, PenLine } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { Post } from '@/types/post'
import { yearsOfExperience } from '@/lib/dateFormat'
import { profile } from '@/data/profile'

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <Card className="flex flex-row items-center gap-3 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-lg font-semibold leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  )
}

export function StatsCards({ posts }: { posts: Post[] }) {
  const published = posts.filter((p) => p.status === 'published').length
  const drafts = posts.length - published
  const years = yearsOfExperience(profile.experience[profile.experience.length - 1].startDate)

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard icon={Briefcase} label="Years of experience" value={`${years}+`} />
      <StatCard icon={Globe} label="Published posts" value={published} />
      <StatCard icon={PenLine} label="Drafts" value={drafts} />
      <StatCard icon={FileText} label="Total posts" value={posts.length} />
    </div>
  )
}
