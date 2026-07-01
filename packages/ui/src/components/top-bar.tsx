import type { AcpProviderId, ModelInfo, ProviderInfo } from '@webacp/react';
import { FolderOpen, Settings, Download } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Label } from './ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';

export interface TopBarProps {
  providers: ProviderInfo[];
  provider: AcpProviderId;
  onProviderChange: (id: AcpProviderId) => void;
  models: ModelInfo[];
  currentModel: string | null;
  onModelChange: (value: string) => void;
  agentConnected: boolean;
  streaming?: boolean;
  setupHint?: string;
  onOpenSetup?: () => void;
  workspaceLabel?: string | null;
  canExport?: boolean;
  onExportMarkdown?: () => void;
  onExportJson?: () => void;
  className?: string;
}

export function TopBar({
  providers,
  provider,
  onProviderChange,
  models,
  currentModel,
  onModelChange,
  agentConnected,
  streaming,
  setupHint,
  onOpenSetup,
  workspaceLabel,
  canExport,
  onExportMarkdown,
  onExportJson,
  className,
}: TopBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Label htmlFor="provider-select">CLI</Label>
        <Select
          value={provider}
          disabled={streaming}
          onValueChange={(v) => onProviderChange(v as AcpProviderId)}
        >
          <SelectTrigger id="provider-select" className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {models.length > 0 && (
        <div className="flex items-center gap-2">
          <Label htmlFor="model-select">Model</Label>
          <Select
            value={currentModel ?? ''}
            disabled={streaming}
            onValueChange={onModelChange}
          >
            <SelectTrigger id="model-select" className="w-[180px]">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {workspaceLabel && (
          <span
            className="flex max-w-[180px] items-center gap-1.5 truncate text-xs text-muted-foreground"
            title={workspaceLabel}
          >
            <FolderOpen className="size-3.5 shrink-0" />
            {workspaceLabel}
          </span>
        )}
        {canExport && onExportMarkdown && (
          <Button variant="outline" size="sm" onClick={onExportMarkdown} disabled={streaming}>
            <Download />
            MD
          </Button>
        )}
        {canExport && onExportJson && (
          <Button variant="outline" size="sm" onClick={onExportJson} disabled={streaming}>
            JSON
          </Button>
        )}
        {onOpenSetup && (
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={onOpenSetup}
            title="Workspace & agents setup"
          >
            <Settings className="size-4" />
          </Button>
        )}
        <Badge variant={agentConnected ? 'success' : 'destructive'} className="normal-case">
          {agentConnected ? 'Agent connected' : 'Agent offline'}
        </Badge>
      </div>

      {setupHint && (
        <p className="w-full text-[11px] text-muted-foreground">{setupHint}</p>
      )}
    </div>
  );
}
