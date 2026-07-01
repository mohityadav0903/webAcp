import type { ThreadSummary } from '@webacp/react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Button } from './ui/button.js';
import { ScrollArea } from './ui/scroll-area.js';
import { Separator } from './ui/separator.js';
import { TrashIcon } from './icons.js';

export interface ThreadSidebarProps {
  threads: ThreadSummary[];
  currentThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  brand?: { title?: string; subtitle?: string };
  className?: string;
}

export function ThreadSidebar({
  threads,
  currentThreadId,
  onSelect,
  onNew,
  onDelete,
  brand = { title: 'WebACP', subtitle: 'context OS chat' },
  className,
}: ThreadSidebarProps) {
  return (
    <aside
      className={cn(
        'flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="px-4 py-4">
        <h1 className="text-base font-semibold tracking-tight">{brand.title}</h1>
        {brand.subtitle && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{brand.subtitle}</p>
        )}
      </div>

      <div className="px-3 pb-3">
        <Button className="w-full" size="sm" onClick={onNew}>
          <Plus />
          New chat
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      <ScrollArea className="flex-1 px-2 py-2">
        {threads.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet.</p>
        )}
        <div className="flex flex-col gap-0.5">
          {threads.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                t.id === currentThreadId && 'bg-sidebar-accent text-sidebar-foreground',
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate">{t.title || 'Untitled'}</span>
                {t.provider && (
                  <span className="block truncate text-[10px] text-muted-foreground/80">
                    {t.provider}
                    {t.imported ? ' · imported' : ''}
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 hover:text-destructive group-hover:opacity-100"
                title="Delete chat"
                aria-label="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${t.title || 'Untitled'}"?`)) onDelete(t.id);
                }}
              >
                <TrashIcon />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
