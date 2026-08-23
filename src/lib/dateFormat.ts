import { format, formatDistanceToNow, differenceInYears, differenceInMonths } from 'date-fns'

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy')
}

export function formatMonthYear(date: string | Date): string {
  return format(new Date(date), 'MMM yyyy')
}

export function formatRelative(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function formatDuration(start: string, end: string | null): string {
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  const years = differenceInYears(endDate, startDate)
  const months = differenceInMonths(endDate, startDate) % 12
  const parts: string[] = []
  if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`)
  if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`)
  return parts.length ? parts.join(' ') : '< 1 mo'
}

export function yearsOfExperience(earliestStart: string): number {
  return differenceInYears(new Date(), new Date(earliestStart))
}
