import type { StoredChatRole } from '@webacp/protocol';

export interface Thread {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  acpSessionId: string | null;
  workspaceCwd: string | null;
  sourceKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  threadId: string;
  role: StoredChatRole;
  content: string;
  toolName: string | null;
  createdAt: number;
}

export interface CreateThreadInput {
  id?: string;
  title?: string;
  provider?: string | null;
  model?: string | null;
  acpSessionId?: string | null;
  workspaceCwd?: string | null;
  sourceKey?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdateThreadInput {
  title?: string;
  provider?: string | null;
  model?: string | null;
  acpSessionId?: string | null;
  workspaceCwd?: string | null;
  sourceKey?: string | null;
}

export interface AddMessageInput {
  id?: string;
  threadId: string;
  role: StoredChatRole;
  content: string;
  toolName?: string | null;
  createdAt?: number;
}

export interface PersistenceAdapter {
  listThreads(): Promise<Thread[]>;
  getThread(id: string): Promise<Thread | null>;
  createThread(input: CreateThreadInput): Promise<Thread>;
  updateThread(id: string, patch: UpdateThreadInput): Promise<Thread>;
  deleteThread(id: string): Promise<void>;
  listMessages(threadId: string): Promise<StoredMessage[]>;
  addMessage(input: AddMessageInput): Promise<StoredMessage>;
  truncateAfter(
    threadId: string,
    messageId: string,
    inclusive: boolean,
  ): Promise<StoredMessage[]>;
  findThreadBySource?(workspaceCwd: string, sourceKey: string): Promise<Thread | null>;
}
