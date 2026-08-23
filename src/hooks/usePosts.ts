import { useEffect, useState } from 'react'
import type { Post } from '@/types/post'
import { getOwnPosts, getPublishedPosts } from '@/lib/posts'
import { toError } from '@/lib/toError'

export function usePublishedPosts(opts?: { categorySlug?: string; subcategorySlug?: string }) {
  const { categorySlug, subcategorySlug } = opts ?? {}
  const [posts, setPosts] = useState<Post[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getPublishedPosts({ categorySlug, subcategorySlug })
      .then((data) => {
        if (!cancelled) setPosts(data)
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
  }, [categorySlug, subcategorySlug])

  return { posts, isLoading, error }
}

export function useOwnPosts() {
  const [posts, setPosts] = useState<Post[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = () => {
    setIsLoading(true)
    return getOwnPosts()
      .then(setPosts)
      .catch((err) => setError(toError(err)))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { posts, isLoading, error, refetch }
}
