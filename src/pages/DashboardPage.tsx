import { useOwnPosts } from '@/hooks/usePosts'
import { profile } from '@/data/profile'
import { ProfileHeader } from '@/components/dashboard/ProfileHeader'
import { StatsCards } from '@/components/dashboard/StatsCards'
import { ExperienceTimeline } from '@/components/dashboard/ExperienceTimeline'
import { SkillsPanel } from '@/components/dashboard/SkillsPanel'
import { ProjectsGrid } from '@/components/dashboard/ProjectsGrid'
import { CertificationsList } from '@/components/dashboard/CertificationsList'
import { RecentPostsWidget } from '@/components/dashboard/RecentPostsWidget'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Seo } from '@/components/common/Seo'

export function DashboardPage() {
  const { posts, isLoading } = useOwnPosts()

  return (
    <div className="space-y-6">
      <Seo title="Overview" />
      <ProfileHeader />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <StatsCards posts={posts} />

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ExperienceTimeline entries={profile.experience} />
              <ProjectsGrid projects={profile.projects} />
            </div>
            <div className="space-y-6">
              <RecentPostsWidget posts={posts} />
              <SkillsPanel groups={profile.skills} />
              <CertificationsList certifications={profile.certifications} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
