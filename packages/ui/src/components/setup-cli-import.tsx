import type { DiscoveredCliSession } from '@webacp/react';
import { Download, Loader2, MessageSquare } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../lib/cn.js';
import { Alert, AlertDescription } from './ui/alert.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { ScrollArea } from './ui/scroll-area.js';

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const STORAGE_LABEL: Record<string, string> = {
  'claude-jsonl': 'JSONL',
  'cursor-acp': 'ACP session',
  'cursor-ide': 'IDE transcript',
  'codex-jsonl': 'rollout',
};

export interface SetupCliImportProps {
  cwd: string;
  sessions: DiscoveredCliSession[];
  loading?: boolean;
  importing?: boolean;
  importResult?: { imported: number; skipped: number } | null;
  importError?: string | null;
  onRefresh: () => void;
  onImport: () => void;
  casrInstalled?: boolean;
  className?: string;
}

export function SetupCliImport({
  cwd,
  sessions,
  loading,
  importing,
  importResult,
  importError,
  onRefresh,
  onImport,
  casrInstalled,
  className,
}: SetupCliImportProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, DiscoveredCliSession[]>();
    for (const s of sessions) {
      const list = map.get(s.provider) ?? [];
      list.push(s);
      map.set(s.provider, list);
    }
    return [...map.entries()];
  }, [sessions]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="size-4 animate-spin" />
        Scanning local CLI chats…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No local CLI chats found for this folder.
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Found <span className="font-medium text-foreground">{sessions.length}</span> local chats
          in <span className="font-mono text-xs">{cwd}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={importing}>
            Rescan
          </Button>
          <Button size="sm" onClick={onImport} disabled={importing}>
            {importing ? <Loader2 className="animate-spin" /> : <Download />}
            Import all
          </Button>
        </div>
      </div>

      <ScrollArea className="h-48 rounded-lg border border-border">
        <div className="space-y-3 p-3">
          {grouped.map(([provider, list]) => (
            <div key={provider}>
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="secondary">{PROVIDER_LABEL[provider] ?? provider}</Badge>
                <span className="text-xs text-muted-foreground">{list.length} sessions</span>
              </div>
              <ul className="space-y-1">
                {list.map((s) => (
                  <li
                    key={s.sourceKey}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.title ?? s.sessionId.slice(0, 8)}</div>
                      <div className="truncate text-muted-foreground">
                        {s.messageCount} msgs · {STORAGE_LABEL[s.storageKind] ?? s.storageKind}
                        {s.preview ? ` · ${s.preview}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>

      {importResult && (
        <Alert>
          <AlertDescription>
            Imported {importResult.imported} chat{importResult.imported === 1 ? '' : 's'}
            {importResult.skipped > 0 ? ` · skipped ${importResult.skipped} already imported` : ''}.
          </AlertDescription>
        </Alert>
      )}
      {importError && (
        <Alert variant="destructive">
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      )}
      {casrInstalled && (
        <p className="text-[11px] text-muted-foreground">
          casr detected — export imported chats to another CLI via chat top bar or{' '}
          <code className="rounded bg-muted px-1">casr &lt;provider&gt; resume &lt;session-id&gt;</code>
        </p>
      )}
    </div>
  );
}
