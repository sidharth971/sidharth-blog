import MDEditor from '@uiw/react-md-editor'
import { useTheme } from 'next-themes'

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { resolvedTheme } = useTheme()

  return (
    <div data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}>
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        height={520}
        preview="live"
        visiableDragbar={false}
      />
    </div>
  )
}
