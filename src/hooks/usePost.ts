import { useEffect, useState } from 'react'
import type { Post } from '@/types/post'
import { getPostBySlug } from '@/lib/posts'
import { toError } from '@/lib/toError'

export function usePost(slug: string | undefined) {
  const [post, setPost] = useState<Post | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setIsLoading(true)
    getPostBySlug(slug)
      .then((data) => {
        if (!cancelled) setPost(data)
      })
      .catch((err) => {
        if (!cancelled) setError(toError(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  return { post, isLoading, error }
}
