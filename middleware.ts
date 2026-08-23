// Vercel Edge Middleware: injects real <title>/description/Open Graph/Twitter
// Card/canonical/JSON-LD tags into the static HTML shell for the routes that
// get shared or crawled, so link-unfurling bots and non-JS crawlers see the
// real content instead of the empty SPA shell. Everything else passes
// through untouched — the client-side <Seo> component (src/components/common/Seo.tsx)
// re-applies the same tags once React hydrates, so this is purely a
// "first response" improvement, not a second source of truth.
import { createClient } from '@supabase/supabase-js'
import { profile } from './src/data/profile'
import { buildArticleJsonLd, buildPersonJsonLd, buildBlogJsonLd } from './src/lib/seo/jsonld'

export const config = {
  matcher: ['/', '/resume', '/blog/:slug', '/category/:categorySlug', '/category/:categorySlug/:subcategorySlug'],
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function getPost(slug: string) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data } = await supabase
    .from('posts')
    .select('*, category:categories(id,name,slug), subcategory:subcategories(id,name,slug)')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return data
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const siteUrl = url.origin
  const response = await fetch(request)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return response

  let title = profile.name
  let description = profile.summary
  let image: string | undefined
  let type: 'website' | 'article' = 'website'
  let jsonLd: object | object[] = buildPersonJsonLd(profile, siteUrl)

  if (url.pathname === '/resume') {
    title = `Resume · ${profile.name}`
  } else if (url.pathname === '/') {
    title = `${profile.name} — Blog`
    description = `Notes from ${profile.name} on ${profile.title.toLowerCase()} — AWS, DevOps, MLOps, AIOps, and SRE.`
    jsonLd = buildBlogJsonLd(profile, siteUrl)
  } else {
    const slugMatch = url.pathname.match(/^\/blog\/([^/]+)$/)
    if (slugMatch) {
      const post = await getPost(slugMatch[1])
      if (post) {
        title = `${post.title} · ${profile.name}`
        description = post.excerpt ?? description
        image = post.cover_image_url ?? undefined
        type = 'article'
        jsonLd = buildArticleJsonLd(post, siteUrl)
      }
    }
  }

  const canonicalUrl = `${siteUrl}${url.pathname}`
  const headInject = `
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="${type}" />
<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
<meta property="og:site_name" content="${escapeHtml(profile.name)}" />
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />\n<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
`.trim()

  const rewriter = new HTMLRewriter().on('head', {
    element(element) {
      element.append(headInject, { html: true })
    },
  })

  return rewriter.transform(response)
}
