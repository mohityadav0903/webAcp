import { useState } from 'react';
import type { ChatMessage } from '@webacp/react';
import { cn } from '../lib/cn.js';

export function ToolCard({ msg, className }: { msg: ChatMessage; className?: string }) {
  const [open, setOpen] = useState(false);
  const status = msg.toolStatus ?? 'pending';

  return (
    <div className={cn('w-full max-w-full overflow-hidden rounded-xl border border-border bg-card', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
      >
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
        <span>🔧</span>
        <span className="font-mono font-semibold">{msg.toolName}</span>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            status === 'pending' && 'bg-warning/15 text-warning',
            status === 'success' && 'bg-success/15 text-success',
            status === 'failed' && 'bg-destructive/15 text-destructive',
          )}
        >
          {status === 'pending' ? '⏳' : status === 'success' ? '✓' : '✗'} {status}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2.5 text-xs">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Arguments</p>
          <pre className="mb-2.5 overflow-x-auto rounded-md bg-background p-2 font-mono whitespace-pre-wrap break-words">
            {msg.content}
          </pre>
          {msg.toolResult !== undefined && (
            <>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {status === 'failed' ? 'Error' : 'Result'}
              </p>
              <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono whitespace-pre-wrap break-words">
                {msg.toolResult}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
