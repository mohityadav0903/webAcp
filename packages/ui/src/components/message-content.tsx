import type { ContentBlock } from '@webacp/protocol';
import { parseMessageContent } from '@webacp/protocol';
import { cn } from '../lib/cn.js';

export interface MessageContentProps {
  content: string;
  blocks?: ContentBlock[];
  streaming?: boolean;
  className?: string;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function MessageContent({ content, blocks, streaming, className }: MessageContentProps) {
  const resolved = blocks ?? parseMessageContent(content);
  const hasMedia = resolved.some((b) => b.type !== 'text');

  if (!hasMedia) {
    return (
      <span className={className}>
        {resolved.find((b) => b.type === 'text')?.text ?? content}
        {!content && streaming ? '' : !content ? ' ' : null}
      </span>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {resolved.map((block, i) => {
        if (block.type === 'text') {
          if (!block.text.trim()) return null;
          return (
            <span key={i} className="whitespace-pre-wrap">
              {block.text}
            </span>
          );
        }
        if (block.type === 'image') {
          if (block.path) {
            return (
              <div
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs"
              >
                <span>🖼</span>
                <span className="truncate" title={block.path}>
                  {block.name ?? basename(block.path)}
                </span>
              </div>
            );
          }
          if (!block.data) return null;
          const src = `data:${block.mimeType};base64,${block.data}`;
          return (
            <img
              key={i}
              src={src}
              alt={block.name ?? 'image'}
              className="max-h-64 max-w-full rounded-lg border border-border/50 object-contain"
            />
          );
        }
        return (
          <div
            key={i}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs"
            title={block.path}
          >
            <span>📄</span>
            <span className="truncate">{block.name ?? (block.path ? basename(block.path) : 'file')}</span>
          </div>
        );
      })}
    </div>
  );
}
