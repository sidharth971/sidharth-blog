import type { Post } from '@/types/post'
import type { Profile } from '@/types/profile'

export interface JsonLdCrumb {
  label: string
  path: string
}

export function buildPersonJsonLd(profile: Profile, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.title,
    worksFor: { '@type': 'Organization', name: profile.currentCompany },
    url: siteUrl,
    email: profile.email,
    sameAs: profile.links.filter((l) => l.url.startsWith('http')).map((l) => l.url),
    knowsAbout: profile.skills.flatMap((group) => group.skills),
  }
}

export function buildArticleJsonLd(post: Post, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: post.cover_image_url ?? undefined,
    datePublished: post.published_at ?? post.created_at,
    dateModified: post.updated_at,
    keywords: post.tags.length > 0 ? post.tags.join(', ') : undefined,
    articleSection: post.category?.name,
    url: `${siteUrl}/blog/${post.slug}`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${siteUrl}/blog/${post.slug}` },
    author: { '@type': 'Person', name: 'Sidharth Sahoo' },
  }
}

export function buildBreadcrumbJsonLd(crumbs: JsonLdCrumb[], siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: `${siteUrl}${crumb.path}`,
    })),
  }
}

export function buildBlogJsonLd(profile: Profile, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${profile.name} — Blog`,
    description: profile.summary,
    url: siteUrl,
    author: { '@type': 'Person', name: profile.name },
  }
}
