import { useEffect } from 'react'
import { profile } from '@/data/profile'

interface SeoProps {
  title: string
  description?: string
  image?: string
  type?: 'website' | 'article'
  publishedAt?: string
  modifiedAt?: string
  tags?: string[]
  jsonLd?: object | object[]
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): () => void {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  const existed = Boolean(el)
  const previous = el?.content ?? null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
  return () => {
    if (!el) return
    if (existed && previous !== null) {
      el.content = previous
    } else {
      el.remove()
    }
  }
}

function upsertLink(rel: string, href: string): () => void {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  const existed = Boolean(el)
  const previous = el?.href ?? null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.href = href
  return () => {
    if (!el) return
    if (existed && previous !== null) {
      el.href = previous
    } else {
      el.remove()
    }
  }
}

export function Seo({ title, description, image, type = 'website', publishedAt, modifiedAt, tags, jsonLd }: SeoProps) {
  useEffect(() => {
    const cleanups: (() => void)[] = []
    const previousTitle = document.title
    const fullTitle = title ? `${title} · ${profile.name}` : profile.name
    document.title = fullTitle

    const siteUrl = window.location.origin
    const canonicalUrl = `${siteUrl}${window.location.pathname}`
    const desc = description ?? profile.summary

    cleanups.push(upsertMeta('name', 'description', desc))
    cleanups.push(upsertLink('canonical', canonicalUrl))
    cleanups.push(upsertMeta('property', 'og:title', fullTitle))
    cleanups.push(upsertMeta('property', 'og:description', desc))
    cleanups.push(upsertMeta('property', 'og:type', type))
    cleanups.push(upsertMeta('property', 'og:url', canonicalUrl))
    cleanups.push(upsertMeta('property', 'og:site_name', profile.name))
    cleanups.push(upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'))
    cleanups.push(upsertMeta('name', 'twitter:title', fullTitle))
    cleanups.push(upsertMeta('name', 'twitter:description', desc))
    if (image) {
      cleanups.push(upsertMeta('property', 'og:image', image))
      cleanups.push(upsertMeta('name', 'twitter:image', image))
    }
    if (publishedAt) cleanups.push(upsertMeta('property', 'article:published_time', publishedAt))
    if (modifiedAt) cleanups.push(upsertMeta('property', 'article:modified_time', modifiedAt))
    if (tags && tags.length > 0) cleanups.push(upsertMeta('name', 'keywords', tags.join(', ')))

    let scriptEl: HTMLScriptElement | null = null
    if (jsonLd) {
      scriptEl = document.createElement('script')
      scriptEl.type = 'application/ld+json'
      scriptEl.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(scriptEl)
    }

    return () => {
      document.title = previousTitle
      cleanups.forEach((cleanup) => cleanup())
      scriptEl?.remove()
    }
  }, [title, description, image, type, publishedAt, modifiedAt, tags, jsonLd])

  return null
}
