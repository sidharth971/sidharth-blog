import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PostFormValues {
  title: string
  slug: string
  tags: string
  coverImageUrl: string
  excerpt: string
}

export function PostForm({
  values,
  onChange,
}: {
  values: PostFormValues
  onChange: (values: PostFormValues) => void
}) {
  function set<K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="What did you learn today?"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" value={values.slug} onChange={(e) => set('slug', e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags (comma separated)</Label>
        <Input
          id="tags"
          placeholder="aws, devops, sre"
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="cover">Cover image URL (optional)</Label>
        <Input
          id="cover"
          placeholder="https://…"
          value={values.coverImageUrl}
          onChange={(e) => set('coverImageUrl', e.target.value)}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="excerpt">Excerpt (optional — shown in blog list previews)</Label>
        <Input
          id="excerpt"
          placeholder="A short summary of this post…"
          value={values.excerpt}
          onChange={(e) => set('excerpt', e.target.value)}
        />
      </div>
    </div>
  )
}
