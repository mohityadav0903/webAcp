import { useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '@webacp/react';
import { cn } from '../lib/cn.js';
import { MessageItem } from './message-item.js';

export interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  lastAssistantId?: string;
  onEdit: (id: string, text: string) => void;
  onRetry: () => void;
  onFork: (id: string) => void;
  emptyMessage?: string;
  className?: string;
}

export function MessageList({
  messages,
  streaming,
  lastAssistantId,
  onEdit,
  onRetry,
  onFork,
  emptyMessage = 'Ask anything. The agent uses your CLI subscription.',
  className,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <div ref={scrollRef} className={cn('flex-1 overflow-y-auto px-4 py-5', className)}>
      <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
        {messages.length === 0 && (
          <p className="mt-[18vh] text-center text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            msg={m}
            streaming={streaming}
            isLastAssistant={m.id === lastAssistantId}
            onEdit={(text) => onEdit(m.id, text)}
            onRetry={onRetry}
            onFork={() => onFork(m.id)}
          />
        ))}
        {streaming && (
          <div className="inline-flex gap-1 py-1">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:200ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:400ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
