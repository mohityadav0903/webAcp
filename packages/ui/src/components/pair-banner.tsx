import { connectLocalAgent } from '@webacp/react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.js';
import { Button } from './ui/button.js';
import { Kbd } from './ui/kbd.js';

export interface PairBannerProps {
  agentPairing: boolean;
  agentDaemonRunning: boolean;
  onConnect?: () => void;
  className?: string;
}

export function PairBanner({
  agentPairing,
  agentDaemonRunning,
  onConnect,
  className,
}: PairBannerProps) {
  if (agentPairing) {
    return (
      <Alert className={cn('mx-auto max-w-3xl', className)}>
        <Loader2 className="animate-spin" />
        <AlertTitle>Connecting local agent</AlertTitle>
        <AlertDescription>Pairing with your machine…</AlertDescription>
      </Alert>
    );
  }

  if (agentDaemonRunning) {
    return (
      <Alert className={cn('mx-auto max-w-3xl', className)}>
        <Loader2 className="animate-spin" />
        <AlertTitle>Agent running</AlertTitle>
        <AlertDescription>Completing pairing…</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className={cn('mx-auto max-w-3xl', className)}>
      <AlertTitle>Local agent required</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>One-time setup (runs on login after this):</p>
        <code className="block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
          bun run install:agent
        </code>
        <p>
          Or manually: <Kbd>webacp-agent run</Kbd>
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (onConnect ? onConnect() : void connectLocalAgent())}
        >
          Connect now
        </Button>
      </AlertDescription>
    </Alert>
  );
}
