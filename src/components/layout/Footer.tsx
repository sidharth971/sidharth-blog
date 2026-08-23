import { Link } from 'react-router-dom'
import { profile } from '@/data/profile'

export function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <p>
          &copy; {new Date().getFullYear()} {profile.name}
        </p>
        <div className="flex items-center gap-4">
          {profile.links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target={link.url.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <Link to="/login" className="hover:text-foreground">
            Owner login
          </Link>
        </div>
      </div>
    </footer>
  )
}
