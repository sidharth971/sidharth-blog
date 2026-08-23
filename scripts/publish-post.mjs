#!/usr/bin/env node
// Publish a markdown file (with frontmatter) straight to Supabase, no browser needed.
// Usage: node scripts/publish-post.mjs path/to/post.md [--status=draft]
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import matter from 'gray-matter'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

function slugify(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function deriveExcerpt(markdown) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 160) || null
}

async function findOrCreateCategory(supabase, name) {
  const slug = slugify(name)
  const { data: existing, error: findError } = await supabase
    .from('categories')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return existing.id

  const { data: created, error: createError } = await supabase
    .from('categories')
    .insert({ name, slug })
    .select('id')
    .single()
  if (createError) throw createError
  console.log(`Created category "${name}"`)
  return created.id
}

async function findOrCreateSubcategory(supabase, categoryId, name) {
  const slug = slugify(name)
  const { data: existing, error: findError } = await supabase
    .from('subcategories')
    .select('id, slug')
    .eq('category_id', categoryId)
    .eq('slug', slug)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return existing.id

  const { data: created, error: createError } = await supabase
    .from('subcategories')
    .insert({ category_id: categoryId, name, slug })
    .select('id')
    .single()
  if (createError) throw createError
  console.log(`Created subcategory "${name}"`)
  return created.id
}

async function main() {
  const [filePath, ...flags] = process.argv.slice(2)
  if (!filePath) {
    console.error('Usage: node scripts/publish-post.mjs path/to/post.md [--status=draft]')
    process.exit(1)
  }

  const statusFlag = flags.find((f) => f.startsWith('--status='))?.split('=')[1]

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const ownerEmail = process.env.SUPABASE_OWNER_EMAIL
  const ownerPassword = process.env.SUPABASE_OWNER_PASSWORD

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
    process.exit(1)
  }
  if (!ownerEmail || !ownerPassword) {
    console.error('Missing SUPABASE_OWNER_EMAIL / SUPABASE_OWNER_PASSWORD in .env.local')
    process.exit(1)
  }

  const raw = readFileSync(resolve(filePath), 'utf8')
  const { data: frontmatter, content } = matter(raw)

  if (!frontmatter.title) {
    console.error('Frontmatter must include a "title"')
    process.exit(1)
  }
  if (!content.trim()) {
    console.error('Post has no content')
    process.exit(1)
  }

  const slug = frontmatter.slug ? slugify(frontmatter.slug) : slugify(frontmatter.title)
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
  const status = statusFlag ?? frontmatter.status ?? 'published'

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  })
  if (authError) {
    console.error('Sign-in failed:', authError.message)
    process.exit(1)
  }

  let categoryId = null
  let subcategoryId = null
  if (frontmatter.category) {
    categoryId = await findOrCreateCategory(supabase, frontmatter.category)
    if (frontmatter.subcategory) {
      subcategoryId = await findOrCreateSubcategory(supabase, categoryId, frontmatter.subcategory)
    }
  }

  const postInput = {
    title: frontmatter.title,
    slug,
    excerpt: frontmatter.excerpt ?? deriveExcerpt(content),
    content: content.trim(),
    cover_image_url: frontmatter.coverImageUrl ?? null,
    tags,
    status,
    category_id: categoryId,
    subcategory_id: subcategoryId,
  }

  const { data: existingPost, error: findError } = await supabase
    .from('posts')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (findError) throw findError

  let result
  if (existingPost) {
    const { data, error } = await supabase
      .from('posts')
      .update(postInput)
      .eq('id', existingPost.id)
      .select()
      .single()
    if (error) throw error
    result = data
    console.log(`Updated post "${result.title}"`)
  } else {
    const { data, error } = await supabase.from('posts').insert(postInput).select().single()
    if (error) throw error
    result = data
    console.log(`Created post "${result.title}"`)
  }

  await supabase.auth.signOut()

  const siteUrl = process.env.VITE_SITE_URL
  console.log(`Status: ${result.status}`)
  console.log(siteUrl ? `URL: ${siteUrl}/blog/${result.slug}` : `Path: /blog/${result.slug}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
