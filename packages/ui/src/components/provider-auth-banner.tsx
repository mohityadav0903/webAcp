import type { AcpConnectionStatus, ProviderInfo } from '@webacp/react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.js';
import { Kbd } from './ui/kbd.js';

export interface ProviderAuthBannerProps {
  provider: ProviderInfo | undefined;
  acpStatus: AcpConnectionStatus | null;
  className?: string;
}

const CLI_LOGIN: Record<string, string> = {
  claude: 'claude login',
  cursor: 'agent login',
  codex: 'codex login',
  gemini: 'gemini auth login',
  opencode: 'opencode auth',
};

/** Shown when the active CLI provider needs login or ACP auth failed. */
export function ProviderAuthBanner({ provider, acpStatus, className }: ProviderAuthBannerProps) {
  if (!provider || !acpStatus) return null;
  if (acpStatus.providerId && acpStatus.providerId !== provider.id) return null;

  const show = !!acpStatus.authError || (acpStatus.connected && !acpStatus.authenticated);
  if (!show) return null;

  return (
    <Alert variant="warning" className={cn('mx-auto max-w-3xl', className)}>
      <AlertTriangle />
      <AlertTitle>{provider.displayName} — sign in required</AlertTitle>
      <AlertDescription className="space-y-1">
        {acpStatus.authError && <p>{acpStatus.authError}</p>}
        {provider.authKind === 'cli' && (
          <p>
            Terminal: <Kbd>{CLI_LOGIN[provider.id] ?? provider.setupHint}</Kbd>
          </p>
        )}
        {provider.authKind === 'acp_terminal' && provider.authMethodId && (
          <p>
            {provider.setupHint} (ACP: {provider.authMethodId})
          </p>
        )}
        {!acpStatus.authError && <p>{provider.setupHint}</p>}
      </AlertDescription>
    </Alert>
  );
}
