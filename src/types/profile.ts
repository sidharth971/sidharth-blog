export interface ExperienceEntry {
  id: string
  company: string
  companyGroupId?: string
  title: string
  startDate: string
  endDate: string | null
  location?: string
  summary?: string
  bullets: string[]
  skills?: string[]
  isPlaceholder?: boolean
}

export interface Project {
  id: string
  name: string
  category: string
  description: string
  bullets?: string[]
  relatedExperienceId?: string
  tags?: string[]
  link?: string
  period?: string
}

export interface SkillGroup {
  category: string
  skills: string[]
}

export interface Certification {
  name: string
  issuer?: string
  year: string
}

export interface EducationEntry {
  institution: string
  degree: string
  field?: string
  year?: string
  location?: string
}

export interface ProfileLink {
  label: string
  url: string
  icon: 'github' | 'linkedin' | 'mail' | 'phone' | 'map-pin'
}

export interface Profile {
  name: string
  title: string
  currentCompany: string
  location?: string
  email: string
  phone?: string
  links: ProfileLink[]
  summary: string
  experience: ExperienceEntry[]
  projects: Project[]
  skills: SkillGroup[]
  certifications: Certification[]
  education: EducationEntry[]
  languages?: string[]
  honors?: { title: string; issuer?: string; date?: string }[]
}
