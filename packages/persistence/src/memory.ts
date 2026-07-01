import { randomUUID } from 'node:crypto';
import type {
  AddMessageInput,
  CreateThreadInput,
  PersistenceAdapter,
  StoredMessage,
  Thread,
  UpdateThreadInput,
} from './types.js';

export function memoryAdapter(): PersistenceAdapter {
  const threads = new Map<string, Thread>();
  const messages = new Map<string, StoredMessage[]>();

  return {
    async listThreads() {
      return [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async getThread(id) {
      return threads.get(id) ?? null;
    },
    async createThread(input: CreateThreadInput) {
      const now = Date.now();
      const thread: Thread = {
        id: input.id ?? randomUUID(),
        title: input.title ?? 'New chat',
        provider: input.provider ?? null,
        model: input.model ?? null,
        acpSessionId: input.acpSessionId ?? null,
        workspaceCwd: input.workspaceCwd ?? null,
        sourceKey: input.sourceKey ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      };
      threads.set(thread.id, thread);
      messages.set(thread.id, []);
      return thread;
    },
    async updateThread(id, patch: UpdateThreadInput) {
      const existing = threads.get(id);
      if (!existing) throw new Error(`Thread not found: ${id}`);
      const updated: Thread = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.acpSessionId !== undefined ? { acpSessionId: patch.acpSessionId } : {}),
        ...(patch.workspaceCwd !== undefined ? { workspaceCwd: patch.workspaceCwd } : {}),
        ...(patch.sourceKey !== undefined ? { sourceKey: patch.sourceKey } : {}),
        updatedAt: Date.now(),
      };
      threads.set(id, updated);
      return updated;
    },
    async deleteThread(id) {
      threads.delete(id);
      messages.delete(id);
    },
    async listMessages(threadId) {
      return messages.get(threadId) ?? [];
    },
    async addMessage(input: AddMessageInput) {
      const msg: StoredMessage = {
        id: input.id ?? randomUUID(),
        threadId: input.threadId,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        createdAt: input.createdAt ?? Date.now(),
      };
      const list = messages.get(input.threadId) ?? [];
      list.push(msg);
      messages.set(input.threadId, list);
      const thread = threads.get(input.threadId);
      if (thread) thread.updatedAt = msg.createdAt;
      return msg;
    },
    async findThreadBySource(workspaceCwd, sourceKey) {
      for (const t of threads.values()) {
        if (t.workspaceCwd === workspaceCwd && t.sourceKey === sourceKey) return t;
      }
      return null;
    },
    async truncateAfter(threadId, messageId, inclusive) {
      const list = messages.get(threadId) ?? [];
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) return list;
      const cut = inclusive ? idx : idx + 1;
      const kept = list.slice(0, cut);
      messages.set(threadId, kept);
      return kept;
    },
  };
}
