import { useState } from 'react';
import { cn } from '../lib/cn.js';

export function ThinkingBlock({ content, className }: { content: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('border-l-2 border-border pl-3', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? '▾' : '▸'} 💭 Thinking
      </button>
      {open && (
        <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {content}
        </div>
      )}
    </div>
  );
}
