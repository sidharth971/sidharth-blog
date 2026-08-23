import { useState } from 'react'
import type { PostInput } from '@/types/post'
import { createPost, updatePost, deletePost } from '@/lib/posts'
import { toError } from '@/lib/toError'

export function usePostMutations() {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function save(input: PostInput, existingId?: string) {
    setIsSaving(true)
    setError(null)
    try {
      const result = existingId ? await updatePost(existingId, input) : await createPost(input)
      return result
    } catch (err) {
      const e = toError(err)
      setError(e)
      throw e
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(id: string) {
    setIsSaving(true)
    setError(null)
    try {
      await deletePost(id)
    } catch (err) {
      const e = toError(err)
      setError(e)
      throw e
    } finally {
      setIsSaving(false)
    }
  }

  return { save, remove, isSaving, error }
}
