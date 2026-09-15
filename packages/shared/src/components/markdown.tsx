import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';

/**
 * Render AI/assistant message content as GitHub-flavored Markdown (tables,
 * lists, code, bold). Styling is done with descendant selectors on the wrapper
 * so we don't need custom element renderers. Inherits the bubble's text color.
 *
 * NOTE: react-markdown (v10) renders the block elements directly, with no
 * wrapper of its own, so vertical rhythm (space-y-*) MUST live on the element
 * that is their direct parent — the inner div below — not on the outer wrapper.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'break-words text-sm leading-relaxed',
        '[&_p]:whitespace-pre-wrap',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>ul]:mt-0.5 [&_li>ol]:mt-0.5',
        '[&_a]:underline',
        // Headings get extra space above (via padding, which also applies to a
        // leading heading) so sections read as sections, not run-on text.
        '[&_strong]:font-semibold [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:text-base [&_h2]:text-[15px] [&_h1]:pt-1.5 [&_h2]:pt-1.5 [&_h3]:pt-1',
        '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]',
        '[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:pl-3 [&_blockquote]:opacity-80',
        '[&_hr]:my-3 [&_hr]:border-t [&_hr]:border-current/15',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
        '[&_th]:border [&_th]:border-current/20 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border [&_td]:border-current/20 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
        className,
      )}
    >
      <div className="space-y-2.5 overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    </div>
  );
}
