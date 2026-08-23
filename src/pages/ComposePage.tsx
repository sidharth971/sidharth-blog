import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { getOwnPostById } from '@/lib/posts'
import { usePostMutations } from '@/hooks/usePostMutations'
import { slugify } from '@/lib/slugify'
import { toError } from '@/lib/toError'
import { MarkdownEditor } from '@/components/compose/MarkdownEditor'
import { PostForm, type PostFormValues } from '@/components/compose/PostForm'
import { CategorySelect } from '@/components/compose/CategorySelect'
import { PublishBar } from '@/components/compose/PublishBar'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Seo } from '@/components/common/Seo'
import type { Post, PostStatus } from '@/types/post'

const emptyForm: PostFormValues = { title: '', slug: '', tags: '', coverImageUrl: '', excerpt: '' }

export function ComposePage() {
  const { id } = useParams<{ id: string }>()
  const mode = id ? 'edit' : 'create'
  const navigate = useNavigate()
  const { save, remove, isSaving } = usePostMutations()

  const [form, setForm] = useState<PostFormValues>(emptyForm)
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)
  const [status, setStatus] = useState<PostStatus | null>(null)
  const [postId, setPostId] = useState<string | undefined>(id)
  const [slugTouched, setSlugTouched] = useState(false)
  const [isLoading, setIsLoading] = useState(mode === 'edit')

  useEffect(() => {
    if (mode !== 'edit' || !id) return
    let cancelled = false
    getOwnPostById(id)
      .then((post) => {
        if (cancelled || !post) return
        hydrate(post)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode])

  function hydrate(post: Post) {
    setForm({
      title: post.title,
      slug: post.slug,
      tags: post.tags.join(', '),
      coverImageUrl: post.cover_image_url ?? '',
      excerpt: post.excerpt ?? '',
    })
    setContent(post.content)
    setCategoryId(post.category_id)
    setSubcategoryId(post.subcategory_id)
    setStatus(post.status)
    setPostId(post.id)
    setSlugTouched(true)
  }

  function handleFormChange(next: PostFormValues) {
    if (next.slug !== form.slug) {
      // user edited the slug field directly — stop auto-deriving it from the title
      setSlugTouched(true)
      setForm(next)
    } else if (!slugTouched && next.title !== form.title) {
      setForm({ ...next, slug: slugify(next.title) })
    } else {
      setForm(next)
    }
  }

  async function persist(nextStatus: PostStatus) {
    if (!form.title.trim() || !form.slug.trim()) {
      toast.error('Title and slug are required.')
      return
    }
    if (!content.trim()) {
      toast.error('Write some content before saving.')
      return
    }

    try {
      const result = await save(
        {
          title: form.title.trim(),
          slug: slugify(form.slug),
          content,
          excerpt: form.excerpt.trim() || null,
          cover_image_url: form.coverImageUrl.trim() || null,
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          status: nextStatus,
          category_id: categoryId,
          subcategory_id: subcategoryId,
        },
        postId,
      )
      setStatus(result.status)
      setPostId(result.id)
      toast.success(nextStatus === 'published' ? 'Published.' : 'Draft saved.')
      if (mode === 'create') navigate(`/dashboard/compose/${result.id}`, { replace: true })
    } catch (err) {
      toast.error(toError(err).message || 'Something went wrong.')
    }
  }

  async function handleDelete() {
    if (!postId) return
    try {
      await remove(postId)
      toast.success('Post deleted.')
      navigate('/dashboard')
    } catch (err) {
      toast.error(toError(err).message || 'Could not delete post.')
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Seo title={mode === 'edit' ? 'Edit Post' : 'New Post'} />

      <PostForm values={form} onChange={handleFormChange} />

      <CategorySelect
        categoryId={categoryId}
        subcategoryId={subcategoryId}
        onChange={(nextCategoryId, nextSubcategoryId) => {
          setCategoryId(nextCategoryId)
          setSubcategoryId(nextSubcategoryId)
        }}
      />

      <MarkdownEditor value={content} onChange={setContent} />

      <PublishBar
        mode={mode}
        status={status}
        slug={form.slug}
        isSaving={isSaving}
        onSaveDraft={() => persist('draft')}
        onPublish={() => persist('published')}
        onUnpublish={status === 'published' ? () => persist('draft') : undefined}
        onDelete={mode === 'edit' ? handleDelete : undefined}
      />
    </div>
  )
}
