export interface Category {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface Subcategory {
  id: string
  category_id: string
  name: string
  slug: string
  created_at: string
}

export interface CategoryWithSubcategories extends Category {
  subcategories: Subcategory[]
}
