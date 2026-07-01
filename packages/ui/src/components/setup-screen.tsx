import { useEffect, useState, type ReactNode } from 'react';
import type { AcpProviderId, DiscoveredCliSession } from '@webacp/react';
import { useSetup, useWebacpStore } from '@webacp/react';
import {
  CheckCircle2,
  Circle,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card.js';
import { Input } from './ui/input.js';
import { Kbd } from './ui/kbd.js';
import { Separator } from './ui/separator.js';
import { SetupProviderCard } from './setup-provider-card.js';
import { SetupCliImport } from './setup-cli-import.js';

export interface SetupScreenProps {
  brand?: { title?: string; subtitle?: string };
  onComplete?: () => void;
  className?: string;
}

function agentDone(status: ReturnType<typeof useSetup>['setupStatus']) {
  return Boolean(status?.agent.connected);
}

function workspaceDone(status: ReturnType<typeof useSetup>['setupStatus']) {
  return Boolean(status?.workspace.cwd && status.workspace.exists !== false);
}

function providersDone(status: ReturnType<typeof useSetup>['setupStatus']) {
  return Boolean(status?.providers.some((p) => p.status === 'ready'));
}

export function SetupScreen({ brand, onComplete, className }: SetupScreenProps) {
  const agentPairing = useWebacpStore((s) => s.agentPairing);
  const agentDaemonRunning = useWebacpStore((s) => s.agentDaemonRunning);
  const {
    setupStatus,
    ready,
    connectAgent,
    pickWorkspaceFolder,
    setWorkspacePath,
    probeCliProviders,
    setDefaultCliProvider,
    refresh,
    fetchCliSessions,
    importCliSessions,
    fetchCasrStatus,
  } = useSetup(3000);

  const [pathDraft, setPathDraft] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<AcpProviderId | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cliSessions, setCliSessions] = useState<DiscoveredCliSession[]>([]);
  const [cliScanning, setCliScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [casrInstalled, setCasrInstalled] = useState(false);

  const defaultProvider = setupStatus?.defaultProvider ?? null;
  const agentOk = agentDone(setupStatus);
  const workspaceOk = workspaceDone(setupStatus);
  const providersOk = providersDone(setupStatus);

  useEffect(() => {
    void fetchCasrStatus().then((s) => setCasrInstalled(Boolean(s?.installed)));
  }, [fetchCasrStatus]);

  useEffect(() => {
    if (setupStatus?.workspace.cwd) setPathDraft(setupStatus.workspace.cwd);
  }, [setupStatus?.workspace.cwd]);

  async function scanCliSessions(cwd?: string) {
    const target = cwd ?? setupStatus?.workspace.cwd;
    if (!target) {
      setCliSessions([]);
      return;
    }
    setCliScanning(true);
    setImportError(null);
    try {
      const data = await fetchCliSessions(target);
      setCliSessions(data?.sessions ?? []);
    } finally {
      setCliScanning(false);
    }
  }

  useEffect(() => {
    if (workspaceOk && setupStatus?.workspace.cwd) {
      void scanCliSessions(setupStatus.workspace.cwd);
    }
  }, [workspaceOk, setupStatus?.workspace.cwd]);

  async function runImportAll() {
    const cwd = setupStatus?.workspace.cwd;
    if (!cwd || cliSessions.length === 0) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importCliSessions(cwd, cliSessions);
      if (!result) throw new Error('Import failed');
      setImportResult(result);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function runScanAll() {
    setScanning(true);
    try {
      await probeCliProviders();
    } finally {
      setScanning(false);
    }
  }

  async function runProbeOne(id: AcpProviderId) {
    setProbingId(id);
    try {
      await probeCliProviders(id);
    } finally {
      setProbingId(null);
    }
  }

  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
      <header className="border-b border-border px-6 py-6">
        <div className="mx-auto max-w-5xl">
          <Badge variant="secondary" className="mb-2 normal-case tracking-normal">
            {brand?.title ?? 'WebACP'}
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace & agents</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {brand?.subtitle ?? 'Connect your machine, pick a folder, choose a CLI agent.'}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <SetupStepCard
            step={1}
            title="Local agent"
            description="Bridges this web app to your machine"
            done={agentOk}
          >
            <div className="flex items-center justify-between gap-3">
              <StatusLine
                ok={agentOk}
                label={
                  agentOk
                    ? 'Connected'
                    : agentPairing
                      ? 'Connecting…'
                      : agentDaemonRunning
                        ? 'Pairing…'
                        : 'Offline'
                }
              />
              {!agentOk && (
                <Button
                  size="sm"
                  disabled={agentPairing}
                  onClick={() => void connectAgent()}
                >
                  {agentPairing && <Loader2 className="animate-spin" />}
                  Connect
                </Button>
              )}
            </div>
            {!agentOk && (
              <Alert className="mt-4">
                <AlertTitle>One-time install</AlertTitle>
                <AlertDescription className="space-y-2">
                  <code className="block rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                    bun run install:agent
                  </code>
                  <p>
                    Or run <Kbd>webacp-agent run</Kbd> manually
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </SetupStepCard>

          <SetupStepCard
            step={2}
            title="Project folder"
            description="ACP agents run tools in this directory"
            done={workspaceOk}
            disabled={!agentOk}
          >
            {setupStatus?.workspace.cwd ? (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <FolderOpen className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {setupStatus.workspace.name ?? 'Project'}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {setupStatus.workspace.cwd}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a folder via the local agent — the browser cannot access your disk.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!agentOk || workspaceBusy}
                onClick={() => {
                  setWorkspaceError(null);
                  setImportResult(null);
                  setWorkspaceBusy(true);
                  void pickWorkspaceFolder()
                    .then(({ cliSessions: found }) => {
                      setCliSessions(found);
                    })
                    .catch((e: Error) => setWorkspaceError(e.message))
                    .finally(() => setWorkspaceBusy(false));
                }}
              >
                {workspaceBusy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FolderOpen />
                )}
                {workspaceBusy ? 'Opening…' : 'Choose folder'}
              </Button>
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                value={pathDraft}
                disabled={!agentOk}
                onChange={(e) => setPathDraft(e.target.value)}
                placeholder="/absolute/path/to/project"
                className="h-8 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!agentOk || !pathDraft.trim() || workspaceBusy}
                onClick={() => {
                  setWorkspaceError(null);
                  setImportResult(null);
                  setWorkspaceBusy(true);
                  void setWorkspacePath(pathDraft.trim())
                    .then((found) => setCliSessions(found))
                    .catch((e: Error) => setWorkspaceError(e.message))
                    .finally(() => setWorkspaceBusy(false));
                }}
              >
                Set
              </Button>
            </div>
            {workspaceError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{workspaceError}</AlertDescription>
              </Alert>
            )}
            {workspaceOk && setupStatus?.workspace.cwd && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">Import local CLI chats</p>
                <SetupCliImport
                  cwd={setupStatus.workspace.cwd}
                  sessions={cliSessions}
                  loading={cliScanning}
                  importing={importing}
                  importResult={importResult}
                  importError={importError}
                  onRefresh={() => void scanCliSessions()}
                  onImport={() => void runImportAll()}
                  casrInstalled={casrInstalled}
                />
              </div>
            )}
          </SetupStepCard>

          <SetupStepCard
            step={3}
            title="CLI agents"
            description="Install & sign in to at least one"
            done={providersOk}
            disabled={!agentOk || !workspaceOk}
            className="lg:col-span-2"
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={!agentOk || !workspaceOk || scanning}
                onClick={() => void runScanAll()}
              >
                {scanning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {scanning ? 'Scanning…' : 'Scan all'}
              </Button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {(setupStatus?.providers ?? []).map((probe) => (
                <SetupProviderCard
                  key={probe.id}
                  probe={probe}
                  isDefault={defaultProvider === probe.id}
                  probing={scanning || probingId === probe.id}
                  onUse={() => void setDefaultCliProvider(probe.id)}
                  onTest={() => void runProbeOne(probe.id)}
                />
              ))}
            </div>
          </SetupStepCard>
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-2">
            <StepPill done={agentOk} label="Agent" />
            <Separator orientation="vertical" className="h-4" />
            <StepPill done={workspaceOk} label="Folder" />
            <Separator orientation="vertical" className="h-4" />
            <StepPill done={providersOk} label="CLI" />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              <RefreshCw />
              Refresh
            </Button>
            <Button disabled={!ready} onClick={() => onComplete?.()}>
              Continue to chat
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SetupStepCard({
  step,
  title,
  description,
  done,
  disabled,
  children,
  className,
  action,
}: {
  step: number;
  title: string;
  description: string;
  done?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        'transition-opacity',
        disabled && 'pointer-events-none opacity-45',
        className,
      )}
    >
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-lg border',
              done
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {done ? <CheckCircle2 className="size-4" /> : <span className="text-sm font-semibold">{step}</span>}
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatusLine({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 text-success" />
      ) : (
        <Circle className="size-4 text-muted-foreground" />
      )}
      {label}
    </div>
  );
}

function StepPill({ done, label }: { done?: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs',
        done ? 'text-success' : 'text-muted-foreground',
      )}
    >
      {done ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Circle className="size-3.5" />
      )}
      {label}
    </span>
  );
}
