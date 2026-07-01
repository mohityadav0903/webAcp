import { useEffect, useRef } from 'react';
import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { cn } from '../lib/cn.js';
import type { PendingAttachment } from '../lib/attachments.js';
import { Button } from './ui/button.js';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  attachments?: PendingAttachment[];
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  disabled?: boolean;
  streaming?: boolean;
  placeholder?: string;
  className?: string;
}

export function Composer({
  value,
  onChange,
  onSend,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  disabled,
  streaming,
  placeholder = 'Message…',
  className,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(value.trim() || attachments.length);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  return (
    <div className={cn('border-t border-border px-4 py-3.5', className)}>
      <div className="mx-auto max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground"
              >
                {att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.file.name}
                    className="size-10 rounded-md object-cover"
                  />
                ) : (
                  <span className="grid size-10 place-items-center rounded-md bg-muted text-lg">
                    📄
                  </span>
                )}
                <span className="max-w-[140px] truncate">{att.file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Remove"
                  disabled={streaming}
                  onClick={() => onRemoveAttachment?.(att.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.css,.html,.csv,.pdf"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) onAddFiles?.(files);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-xl"
            disabled={disabled || streaming}
            title="Attach file"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip />
          </Button>
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <Button
            type="button"
            size="icon"
            className="shrink-0 rounded-xl"
            disabled={disabled || streaming || !canSend}
            title="Send"
            onClick={onSend}
          >
            {streaming ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}
