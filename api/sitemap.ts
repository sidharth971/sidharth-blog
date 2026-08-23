import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const STATIC_PATHS = ['/', '/resume']

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function urlEntry(loc: string, lastmod?: string) {
  return `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
}

export default async function handler(request: Request): Promise<Response> {
  const siteUrl = new URL(request.url).origin
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response('Supabase env vars not configured', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const [{ data: posts }, { data: categories }, { data: subcategories }] = await Promise.all([
    supabase.from('posts').select('slug, updated_at').eq('status', 'published'),
    supabase.from('categories').select('slug'),
    supabase.from('subcategories').select('slug, category:categories(slug)'),
  ])

  const entries = [
    ...STATIC_PATHS.map((path) => urlEntry(`${siteUrl}${path}`)),
    ...(categories ?? []).map((c) => urlEntry(`${siteUrl}/category/${c.slug}`)),
    ...(subcategories ?? [])
      .filter((s): s is typeof s & { category: { slug: string } } => Boolean(s.category))
      .map((s) => urlEntry(`${siteUrl}/category/${s.category.slug}/${s.slug}`)),
    ...(posts ?? []).map((p) => urlEntry(`${siteUrl}/blog/${p.slug}`, p.updated_at?.slice(0, 10))),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
