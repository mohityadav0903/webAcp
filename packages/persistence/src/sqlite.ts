import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import type {
  AddMessageInput,
  CreateThreadInput,
  PersistenceAdapter,
  StoredMessage,
  Thread,
  UpdateThreadInput,
} from './types.js';

interface ThreadRow {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  acp_session_id: string | null;
  workspace_cwd: string | null;
  source_key: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  created_at: number;
}

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    acpSessionId: row.acp_session_id,
    workspaceCwd: row.workspace_cwd ?? null,
    sourceKey: row.source_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function migrateThreadsTable(db: Database) {
  const cols = new Set(
    (db.query(`PRAGMA table_info(threads)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has('workspace_cwd')) {
    db.exec('ALTER TABLE threads ADD COLUMN workspace_cwd TEXT');
  }
  if (!cols.has('source_key')) {
    db.exec('ALTER TABLE threads ADD COLUMN source_key TEXT');
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_threads_source ON threads(workspace_cwd, source_key)',
  );
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role as StoredMessage['role'],
    content: row.content,
    toolName: row.tool_name,
    createdAt: row.created_at,
  };
}

/** SQLite-backed persistence using bun:sqlite. Pass ':memory:' for ephemeral. */
export function sqliteAdapter(path = './webacp.db'): PersistenceAdapter {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      acp_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
  `);
  migrateThreadsTable(db);

  return {
    async listThreads() {
      const rows = db
        .query('SELECT * FROM threads ORDER BY updated_at DESC')
        .all() as ThreadRow[];
      return rows.map(toThread);
    },
    async getThread(id) {
      const row = db.query('SELECT * FROM threads WHERE id = ?').get(id) as ThreadRow | null;
      return row ? toThread(row) : null;
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
      db.query(
        `INSERT INTO threads (id, title, provider, model, acp_session_id, workspace_cwd, source_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        thread.id,
        thread.title,
        thread.provider,
        thread.model,
        thread.acpSessionId,
        thread.workspaceCwd,
        thread.sourceKey,
        thread.createdAt,
        thread.updatedAt,
      );
      return thread;
    },
    async updateThread(id, patch: UpdateThreadInput) {
      const existing = db.query('SELECT * FROM threads WHERE id = ?').get(id) as
        | ThreadRow
        | null;
      if (!existing) throw new Error(`Thread not found: ${id}`);
      const merged: ThreadRow = {
        ...existing,
        title: patch.title ?? existing.title,
        provider: patch.provider !== undefined ? patch.provider : existing.provider,
        model: patch.model !== undefined ? patch.model : existing.model,
        acp_session_id:
          patch.acpSessionId !== undefined ? patch.acpSessionId : existing.acp_session_id,
        workspace_cwd:
          patch.workspaceCwd !== undefined ? patch.workspaceCwd : existing.workspace_cwd,
        source_key: patch.sourceKey !== undefined ? patch.sourceKey : existing.source_key,
        updated_at: Date.now(),
      };
      db.query(
        `UPDATE threads SET title = ?, provider = ?, model = ?, acp_session_id = ?, workspace_cwd = ?, source_key = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        merged.title,
        merged.provider,
        merged.model,
        merged.acp_session_id,
        merged.workspace_cwd,
        merged.source_key,
        merged.updated_at,
        id,
      );
      return toThread(merged);
    },
    async deleteThread(id) {
      db.query('DELETE FROM messages WHERE thread_id = ?').run(id);
      db.query('DELETE FROM threads WHERE id = ?').run(id);
    },
    async listMessages(threadId) {
      const rows = db
        .query('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId) as MessageRow[];
      return rows.map(toMessage);
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
      db.query(
        `INSERT INTO messages (id, thread_id, role, content, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(msg.id, msg.threadId, msg.role, msg.content, msg.toolName, msg.createdAt);
      db.query('UPDATE threads SET updated_at = ? WHERE id = ?').run(msg.createdAt, msg.threadId);
      return msg;
    },
    async findThreadBySource(workspaceCwd, sourceKey) {
      const row = db
        .query('SELECT * FROM threads WHERE workspace_cwd = ? AND source_key = ? LIMIT 1')
        .get(workspaceCwd, sourceKey) as ThreadRow | null;
      return row ? toThread(row) : null;
    },
    async truncateAfter(threadId, messageId, inclusive) {
      const ref = db
        .query('SELECT rowid FROM messages WHERE id = ? AND thread_id = ?')
        .get(messageId, threadId) as { rowid: number } | null;
      if (ref) {
        const op = inclusive ? '>=' : '>';
        db.query(`DELETE FROM messages WHERE thread_id = ? AND rowid ${op} ?`).run(
          threadId,
          ref.rowid,
        );
      }
      const rows = db
        .query('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId) as MessageRow[];
      return rows.map(toMessage);
    },
  };
}
