import { useEffect, useState } from 'react'
import type { CategoryWithSubcategories } from '@/types/category'
import { getCategoriesWithSubcategories } from '@/lib/categories'
import { toError } from '@/lib/toError'

export function useCategories() {
  const [categories, setCategories] = useState<CategoryWithSubcategories[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = () => {
    setIsLoading(true)
    return getCategoriesWithSubcategories()
      .then(setCategories)
      .catch((err) => setError(toError(err)))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { categories, isLoading, error, refetch }
}
