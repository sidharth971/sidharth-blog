import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { PostStatus } from '@/types/post'

export function PublishBar({
  mode,
  status,
  slug,
  isSaving,
  onSaveDraft,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  mode: 'create' | 'edit'
  status: PostStatus | null
  slug: string
  isSaving: boolean
  onSaveDraft: () => void
  onPublish: () => void
  onUnpublish?: () => void
  onDelete?: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {status === 'published' ? (
          <>
            <span className="inline-flex size-2 rounded-full bg-emerald-500" />
            Published
            <Link to={`/blog/${slug}`} target="_blank" className="ml-1 inline-flex items-center gap-1 text-brand">
              View live <ExternalLink className="size-3" />
            </Link>
          </>
        ) : status === 'draft' ? (
          <>
            <span className="inline-flex size-2 rounded-full bg-amber-500" />
            Draft
          </>
        ) : (
          'Not saved yet'
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'edit' && onDelete && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this post?</DialogTitle>
                <DialogDescription>This can't be undone. The post will be permanently removed.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={onDelete} disabled={isSaving}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {status === 'published' && onUnpublish && (
          <Button variant="outline" size="sm" onClick={onUnpublish} disabled={isSaving}>
            Unpublish
          </Button>
        )}

        <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={isSaving}>
          Save draft
        </Button>
        <Button size="sm" onClick={onPublish} disabled={isSaving}>
          {status === 'published' ? 'Update' : 'Publish'}
        </Button>
      </div>
    </div>
  )
}
