import { useState, type ReactNode } from 'react';
import type { ChatMessage } from '@webacp/react';
import { parseMessageContent } from '@webacp/protocol';
import { cn } from '../lib/cn.js';
import { MessageContent } from './message-content.js';
import { ToolCard } from './tool-card.js';
import { ThinkingBlock } from './thinking-block.js';

export interface MessageItemProps {
  msg: ChatMessage;
  streaming: boolean;
  isLastAssistant: boolean;
  onEdit: (text: string) => void;
  onRetry: () => void;
  onFork: () => void;
  className?: string;
}

export function MessageItem({
  msg,
  streaming,
  isLastAssistant,
  onEdit,
  onRetry,
  onFork,
  className,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const textOnly = parseMessageContent(msg.content).find((b) => b.type === 'text')?.text ?? msg.content;
  const [draft, setDraft] = useState(textOnly);
  const hasAttachments = (msg.blocks ?? parseMessageContent(msg.content)).some((b) => b.type !== 'text');

  if (msg.role === 'tool') return <ToolCard msg={msg} className={className} />;
  if (msg.role === 'thought') return <ThinkingBlock content={msg.content} className={className} />;

  if (msg.role === 'error') {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="max-h-48 overflow-y-auto rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive-foreground">
          <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
        </div>
      </div>
    );
  }

  if (msg.role === 'user' && editing) {
    return (
      <div className={cn('flex flex-col items-end gap-1', className)}>
        <div className="w-full max-w-[88%]">
          <textarea
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[60px] w-full resize-y rounded-xl border border-ring bg-card px-3.5 py-2.5 text-sm text-foreground outline-none"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-secondary-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                onEdit(draft);
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              Save & submit
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';

  return (
    <div className={cn('group flex flex-col gap-1', isUser ? 'items-end' : 'items-start', className)}>
      <div
        className={cn(
          'max-w-[88%] break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border bg-card text-card-foreground',
        )}
      >
        <MessageContent
          content={msg.content}
          blocks={msg.blocks}
          streaming={!isUser && streaming && isLastAssistant}
        />
      </div>
      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {isUser && !hasAttachments && (
          <ActionButton
            disabled={streaming}
            onClick={() => {
              setDraft(textOnly);
              setEditing(true);
            }}
          >
            Edit
          </ActionButton>
        )}
        {!isUser && isLastAssistant && (
          <ActionButton disabled={streaming} onClick={onRetry}>
            ↻ Retry
          </ActionButton>
        )}
        <ActionButton disabled={streaming} onClick={onFork}>
          ⑂ Fork
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-transparent px-2 py-0.5 text-[11.5px] text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
