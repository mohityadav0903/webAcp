import { useEffect, useState } from 'react';
import {
  useAgentStatus,
  useChat,
  useModelSelector,
  useProviders,
  useSetup,
  useThreads,
  useWebacpConfig,
  useWebacpStore,
  downloadThreadExport,
  uploadAttachment,
} from '@webacp/react';
import { DEFAULT_MAX_UPLOAD_BYTES, defaultAgentPairUrl } from '@webacp/protocol';
import { cn } from '../lib/cn.js';
import {
  createPendingAttachment,
  revokePendingAttachment,
  type PendingAttachment,
} from '../lib/attachments.js';
import { Composer } from './composer.js';
import { MessageList } from './message-list.js';
import { ProviderAuthBanner } from './provider-auth-banner.js';
import { SetupScreen } from './setup-screen.js';
import { ThreadSidebar } from './thread-sidebar.js';
import { TopBar } from './top-bar.js';

export interface WebacpChatBrand {
  title?: string;
  subtitle?: string;
}

export interface WebacpChatProps {
  /** API base URL (empty = same origin). */
  baseUrl?: string;
  agentPairUrl?: string;
  brand?: WebacpChatBrand;
  emptyMessage?: string;
  className?: string;
  /** Active thread from the URL (`/chat/:threadId`). */
  threadId?: string;
  /** Navigate when the active thread changes (new chat, select, fork, delete). */
  onThreadChange?: (threadId: string | null) => void;
}

/**
 * Drop-in themed chat UI. Wire your theme by overriding CSS variables
 * from `@webacp/ui/theme/default.css`.
 */
export function WebacpChat({
  baseUrl = '',
  agentPairUrl = defaultAgentPairUrl(),
  brand,
  emptyMessage,
  className,
  threadId,
  onThreadChange,
}: WebacpChatProps) {
  useWebacpConfig({ baseUrl, agentPairUrl, onThreadChange });
  useAgentStatus();
  useProviders();
  const { ready, setupStatus, openSetup, closeSetup } = useSetup();
  const setupOpen = useWebacpStore((s) => s.setupOpen);

  const { messages, streaming, provider, setProvider, send, retry, edit, fork } = useChat();
  const { threads, currentThreadId, selectThread, createThread, deleteThread } = useThreads();
  const { models, currentModel, setModel } = useModelSelector();

  useEffect(() => {
    if (!threadId) return;
    if (threadId !== currentThreadId) {
      void selectThread(threadId, { syncRoute: false });
    }
  }, [threadId, currentThreadId, selectThread]);

  const agentConnected = useWebacpStore((s) => s.agentConnected);
  const providers = useWebacpStore((s) => s.providers);
  const acpStatus = useWebacpStore((s) => s.acpStatus);
  const addError = useWebacpStore((s) => s.addError);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const selectedProvider = providers.find((p) => p.id === provider);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  const showSetup = setupOpen || !ready;

  const onSend = async () => {
    const text = input.trim();
    if ((!text && !attachments.length) || streaming || !ready) return;
    setInput('');
    const pending = attachments;
    setAttachments([]);
    try {
      const fileBlocks = await Promise.all(
        pending.map((a) => uploadAttachment(a.file, currentThreadId)),
      );
      for (const att of pending) revokePendingAttachment(att);
      await send(text, fileBlocks);
    } catch (err) {
      for (const att of pending) revokePendingAttachment(att);
      setAttachments(pending);
      addError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const onAddFiles = (files: FileList | File[]) => {
    const next: PendingAttachment[] = [];
    for (const file of files) {
      if (file.size > DEFAULT_MAX_UPLOAD_BYTES) {
        addError(`"${file.name}" exceeds size limit`);
        continue;
      }
      next.push(createPendingAttachment(file));
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };

  const onRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) revokePendingAttachment(att);
      return prev.filter((a) => a.id !== id);
    });
  };

  if (showSetup) {
    return (
      <SetupScreen
        brand={brand}
        className={className}
        onComplete={() => {
          if (ready) closeSetup();
        }}
      />
    );
  }

  return (
    <div className={cn('flex h-full min-h-screen bg-background font-sans text-foreground', className)}>
      <ThreadSidebar
        threads={threads}
        currentThreadId={currentThreadId}
        onSelect={(id) => void selectThread(id)}
        onNew={() => void createThread()}
        onDelete={(id) => void deleteThread(id)}
        brand={brand}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          providers={providers}
          provider={provider}
          onProviderChange={(id) => void setProvider(id)}
          models={models}
          currentModel={currentModel}
          onModelChange={(v) => void setModel(v)}
          agentConnected={agentConnected}
          streaming={streaming}
          setupHint={selectedProvider?.setupHint}
          workspaceLabel={setupStatus?.workspace.name ?? setupStatus?.workspace.cwd ?? null}
          onOpenSetup={openSetup}
          canExport={Boolean(currentThreadId)}
          onExportMarkdown={() => {
            if (currentThreadId) void downloadThreadExport(currentThreadId, 'markdown');
          }}
          onExportJson={() => {
            if (currentThreadId) void downloadThreadExport(currentThreadId, 'json');
          }}
        />

        {agentConnected && (
          <div className="px-4 pt-3">
            <ProviderAuthBanner provider={selectedProvider} acpStatus={acpStatus} />
          </div>
        )}

        <MessageList
          messages={messages}
          streaming={streaming}
          lastAssistantId={lastAssistantId}
          onEdit={(id, text) => void edit(id, text)}
          onRetry={() => void retry()}
          onFork={(id) => void fork(id)}
          emptyMessage={emptyMessage}
        />

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void onSend()}
          attachments={attachments}
          onAddFiles={onAddFiles}
          onRemoveAttachment={onRemoveAttachment}
          disabled={!agentConnected || !ready}
          streaming={streaming}
          placeholder={ready ? 'Message…' : 'Complete setup to start'}
        />
      </div>
    </div>
  );
}
