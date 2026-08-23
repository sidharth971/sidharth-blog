import type { Category, Subcategory } from '@/types/category'

export type PostStatus = 'draft' | 'published'

export interface Post {
  id: string
  user_id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  cover_image_url: string | null
  tags: string[]
  status: PostStatus
  category_id: string | null
  subcategory_id: string | null
  category: Pick<Category, 'id' | 'name' | 'slug'> | null
  subcategory: Pick<Subcategory, 'id' | 'name' | 'slug'> | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface PostInput {
  title: string
  slug: string
  excerpt: string | null
  content: string
  cover_image_url: string | null
  tags: string[]
  status: PostStatus
  category_id: string | null
  subcategory_id: string | null
}
