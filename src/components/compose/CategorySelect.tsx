import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useCategories } from '@/hooks/useCategories'
import { createCategory, createSubcategory } from '@/lib/categories'
import { toError } from '@/lib/toError'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const NONE = '__none__'
const NEW = '__new__'

export function CategorySelect({
  categoryId,
  subcategoryId,
  onChange,
}: {
  categoryId: string | null
  subcategoryId: string | null
  onChange: (categoryId: string | null, subcategoryId: string | null) => void
}) {
  const { categories, refetch } = useCategories()
  const [addingCategory, setAddingCategory] = useState(false)
  const [addingSubcategory, setAddingSubcategory] = useState(false)
  const [newName, setNewName] = useState('')

  const selectedCategory = categories.find((c) => c.id === categoryId)

  async function handleCategorySelect(value: string) {
    if (value === NEW) {
      setAddingCategory(true)
      return
    }
    onChange(value === NONE ? null : value, null)
  }

  async function handleSubcategorySelect(value: string) {
    if (value === NEW) {
      setAddingSubcategory(true)
      return
    }
    onChange(categoryId, value === NONE ? null : value)
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      const category = await createCategory(newName.trim())
      await refetch()
      onChange(category.id, null)
      setNewName('')
      setAddingCategory(false)
    } catch (err) {
      toast.error(toError(err).message)
    }
  }

  async function handleCreateSubcategory(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !categoryId) return
    try {
      const subcategory = await createSubcategory(categoryId, newName.trim())
      await refetch()
      onChange(categoryId, subcategory.id)
      setNewName('')
      setAddingSubcategory(false)
    } catch (err) {
      toast.error(toError(err).message)
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Category</Label>
        {addingCategory ? (
          <form onSubmit={handleCreateCategory} className="flex gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. AWS"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingCategory(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Select value={categoryId ?? NONE} onValueChange={handleCategorySelect}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No category</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW}>+ Add category…</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Subcategory</Label>
        {addingSubcategory ? (
          <form onSubmit={handleCreateSubcategory} className="flex gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Lambda"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingSubcategory(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Select value={subcategoryId ?? NONE} onValueChange={handleSubcategorySelect} disabled={!categoryId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={categoryId ? 'No subcategory' : 'Pick a category first'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No subcategory</SelectItem>
              {selectedCategory?.subcategories.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  {sub.name}
                </SelectItem>
              ))}
              {categoryId && <SelectItem value={NEW}>+ Add subcategory…</SelectItem>}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
