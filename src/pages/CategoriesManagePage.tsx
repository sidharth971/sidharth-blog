import { useState, type FormEvent } from 'react'
import { Plus, Trash2, FolderTree } from 'lucide-react'
import { toast } from 'sonner'
import { useCategories } from '@/hooks/useCategories'
import { createCategory, createSubcategory, deleteCategory, deleteSubcategory } from '@/lib/categories'
import { toError } from '@/lib/toError'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Seo } from '@/components/common/Seo'

function NewSubcategoryForm({ categoryId, onCreated }: { categoryId: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await createSubcategory(categoryId, name.trim())
      setName('')
      onCreated()
    } catch (err) {
      toast.error(toError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New subcategory…"
        className="h-8 text-sm"
      />
      <Button type="submit" size="sm" variant="outline" disabled={submitting}>
        <Plus className="size-3.5" />
      </Button>
    </form>
  )
}

export function CategoriesManagePage() {
  const { categories, isLoading, refetch } = useCategories()
  const [newCategoryName, setNewCategoryName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault()
    if (!newCategoryName.trim()) return
    setSubmitting(true)
    try {
      await createCategory(newCategoryName.trim())
      setNewCategoryName('')
      await refetch()
      toast.success('Category created.')
    } catch (err) {
      toast.error(toError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    try {
      await deleteCategory(id)
      await refetch()
      toast.success('Category deleted.')
    } catch (err) {
      toast.error(toError(err).message)
    }
  }

  async function handleDeleteSubcategory(id: string) {
    try {
      await deleteSubcategory(id)
      await refetch()
      toast.success('Subcategory deleted.')
    } catch (err) {
      toast.error(toError(err).message)
    }
  }

  return (
    <div className="space-y-6">
      <Seo title="Categories" />

      <div>
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="text-sm text-muted-foreground">
          Organize posts into topics (e.g. AWS, Kubernetes, Terraform) and, optionally, subtopics.
        </p>
      </div>

      <Card className="p-4">
        <form onSubmit={handleCreateCategory} className="flex gap-2">
          <Input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name (e.g. AWS)"
          />
          <Button type="submit" disabled={submitting}>
            <Plus className="size-4" />
            Add category
          </Button>
        </form>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : categories.length === 0 ? (
        <EmptyState icon={FolderTree} title="No categories yet" description="Add your first category above." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((category) => (
            <Card key={category.id} className="p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{category.name}</h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDeleteCategory(category.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              {category.subcategories.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {category.subcategories.map((sub) => (
                    <Badge key={sub.id} variant="secondary" className="gap-1 font-normal">
                      {sub.name}
                      <button
                        type="button"
                        onClick={() => handleDeleteSubcategory(sub.id)}
                        aria-label={`Delete ${sub.name}`}
                        className="ml-0.5 opacity-60 hover:opacity-100"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <NewSubcategoryForm categoryId={category.id} onCreated={refetch} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
