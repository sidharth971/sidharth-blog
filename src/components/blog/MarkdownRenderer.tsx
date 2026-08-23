import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { cn } from '@/lib/utils'

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-neutral dark:prose-invert max-w-none',
        'prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-a:text-brand prose-a:no-underline hover:prose-a:underline',
        'prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border',
        'prose-img:rounded-lg prose-img:border prose-img:border-border',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
