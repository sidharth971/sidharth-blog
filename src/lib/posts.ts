import { supabase } from '@/lib/supabaseClient'
import type { Post, PostInput } from '@/types/post'

const POST_SELECT = '*, category:categories(id,name,slug), subcategory:subcategories(id,name,slug)'

export async function getPublishedPosts(opts?: {
  limit?: number
  offset?: number
  categorySlug?: string
  subcategorySlug?: string
  ascending?: boolean
}): Promise<Post[]> {
  const { limit = 200, offset = 0, categorySlug, subcategorySlug, ascending } = opts ?? {}
  // Category/subcategory pages are usually a numbered or ordered series (e.g. "Day 1..N")
  // meant to be read in publish order; the unfiltered home feed stays newest-first.
  const sortAscending = ascending ?? Boolean(categorySlug || subcategorySlug)
  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('status', 'published')
    .order('published_at', { ascending: sortAscending })
    .range(offset, offset + limit - 1)

  if (subcategorySlug) {
    query = query.eq('subcategory.slug', subcategorySlug)
  } else if (categorySlug) {
    query = query.eq('category.slug', categorySlug)
  }

  const { data, error } = await query
  if (error) throw error
  // Embedded-resource filters keep rows whose relation didn't match with a null
  // relation instead of excluding them, so filter defensively on the client too.
  const rows = (data as Post[]).filter((row) => {
    if (subcategorySlug) return row.subcategory?.slug === subcategorySlug
    if (categorySlug) return row.category?.slug === categorySlug
    return true
  })
  return rows
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select(POST_SELECT).eq('slug', slug).maybeSingle()

  if (error) throw error
  return data as Post | null
}

export async function getOwnPosts(): Promise<Post[]> {
  const { data, error } = await supabase.from('posts').select(POST_SELECT).order('updated_at', { ascending: false })

  if (error) throw error
  return data as Post[]
}

export async function getOwnPostById(id: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select(POST_SELECT).eq('id', id).maybeSingle()

  if (error) throw error
  return data as Post | null
}

export async function createPost(input: PostInput): Promise<Post> {
  const { data, error } = await supabase.from('posts').insert(input).select(POST_SELECT).single()

  if (error) throw error
  return data as Post
}

export async function updatePost(id: string, input: Partial<PostInput>): Promise<Post> {
  const { data, error } = await supabase.from('posts').update(input).eq('id', id).select(POST_SELECT).single()

  if (error) throw error
  return data as Post
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', id)
  if (error) throw error
}

export async function isSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
  let query = supabase.from('posts').select('id').eq('slug', slug)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return Boolean(data)
}
