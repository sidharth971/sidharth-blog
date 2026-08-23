import { supabase } from '@/lib/supabaseClient'
import { slugify } from '@/lib/slugify'
import type { Category, CategoryWithSubcategories, Subcategory } from '@/types/category'

export async function getCategoriesWithSubcategories(): Promise<CategoryWithSubcategories[]> {
  const [{ data: categories, error: catError }, { data: subcategories, error: subError }] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('subcategories').select('*').order('name'),
  ])

  if (catError) throw catError
  if (subError) throw subError

  return (categories as Category[]).map((category) => ({
    ...category,
    subcategories: (subcategories as Subcategory[]).filter((sub) => sub.category_id === category.id),
  }))
}

export async function createCategory(name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, slug: slugify(name) })
    .select()
    .single()
  if (error) throw error
  return data as Category
}

export async function renameCategory(id: string, name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update({ name, slug: slugify(name) })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Category
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export async function createSubcategory(categoryId: string, name: string): Promise<Subcategory> {
  const { data, error } = await supabase
    .from('subcategories')
    .insert({ category_id: categoryId, name, slug: slugify(name) })
    .select()
    .single()
  if (error) throw error
  return data as Subcategory
}

export async function renameSubcategory(id: string, name: string): Promise<Subcategory> {
  const { data, error } = await supabase
    .from('subcategories')
    .update({ name, slug: slugify(name) })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Subcategory
}

export async function deleteSubcategory(id: string): Promise<void> {
  const { error } = await supabase.from('subcategories').delete().eq('id', id)
  if (error) throw error
}
