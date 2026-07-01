import { useState } from 'react';
import type { ProviderProbe } from '@webacp/protocol';
import { PROVIDER_SETUP_GUIDES } from '@webacp/protocol';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Card, CardContent, CardFooter } from './ui/card.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible.js';

const STATUS_LABEL: Record<ProviderProbe['status'], string> = {
  checking: 'Checking…',
  not_installed: 'Not installed',
  login_required: 'Sign in required',
  ready: 'Ready',
  error: 'Error',
};

const STATUS_VARIANT: Record<
  ProviderProbe['status'],
  'muted' | 'warning' | 'success' | 'destructive'
> = {
  checking: 'muted',
  not_installed: 'muted',
  login_required: 'warning',
  ready: 'success',
  error: 'destructive',
};

export interface SetupProviderCardProps {
  probe: ProviderProbe;
  isDefault: boolean;
  probing: boolean;
  onUse: () => void;
  onTest: () => void;
  className?: string;
}

export function SetupProviderCard({
  probe,
  isDefault,
  probing,
  onUse,
  onTest,
  className,
}: SetupProviderCardProps) {
  const [open, setOpen] = useState(false);
  const guide = PROVIDER_SETUP_GUIDES[probe.id];
  const canUse = probe.status === 'ready';
  const status = probing && probe.status === 'checking' ? 'checking' : probe.status;

  return (
    <Card
      className={cn(
        'flex h-full flex-col overflow-hidden',
        isDefault && 'border-primary/40 ring-1 ring-primary/20',
        className,
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{probe.displayName}</h3>
            {probe.version && (
              <p className="text-[10px] text-muted-foreground">v{probe.version}</p>
            )}
          </div>
          <Badge variant={STATUS_VARIANT[status]}>
            {probing && status === 'checking' && (
              <Loader2 className="mr-1 size-3 animate-spin" />
            )}
            {STATUS_LABEL[status]}
          </Badge>
        </div>

        {isDefault && <Badge variant="default">Default</Badge>}

        {probe.error && status !== 'ready' && (
          <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
            {probe.error}
          </p>
        )}

        <div className="mt-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={probing}
            onClick={onTest}
          >
            {probing ? <Loader2 className="animate-spin" /> : null}
            Test
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={!canUse || probing}
            onClick={onUse}
          >
            Use
          </Button>
        </div>
      </CardContent>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CardFooter className="border-t border-border p-0">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-full justify-between rounded-none px-4 text-xs text-muted-foreground"
            >
              Setup instructions
              <ChevronDown
                className={cn('size-4 transition-transform', open && 'rotate-180')}
              />
            </Button>
          </CollapsibleTrigger>
        </CardFooter>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            <p>{guide.webacpNote}</p>
            {guide.installCommand && (
              <code className="block rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] text-foreground">
                {guide.installCommand}
              </code>
            )}
            {guide.loginCommand && (
              <code className="block rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] text-foreground">
                {guide.loginCommand}
              </code>
            )}
            <a
              href={guide.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {guide.docsLabel}
              <ExternalLink className="size-3" />
            </a>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
