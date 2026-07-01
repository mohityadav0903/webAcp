import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SessionNotFoundError } from 'cursor-acp-enriched';
import type { AcpProviderId, CliSessionMessage } from '@webacp/protocol';
import { parseClaudeJsonl } from './claude-jsonl-reader.js';
import { readCursorAcpStoreMessages } from './cursor-store-reader.js';

export interface DiscoveredCliSession {
  provider: AcpProviderId;
  storageKind: 'claude-jsonl' | 'cursor-acp' | 'cursor-ide' | 'codex-jsonl';
  sessionId: string;
  title: string | null;
  cwd: string;
  mtime: number;
  messageCount: number;
  preview: string | null;
  messages: CliSessionMessage[];
  sourceKey: string;
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\/+$/, '') || '/';
}

function encodeClaudeCwd(cwd: string): string {
  return normalizeCwd(cwd).replace(/[/\\: _]/g, '-');
}

function encodeCursorProject(cwd: string): string {
  return normalizeCwd(cwd).replace(/\//g, '-').replace(/^-/, '');
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    const userQuery = content.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
    if (userQuery) return userQuery[1]!.trim() || null;
    if (content.startsWith('<')) return null;
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === 'text' && typeof rec.text === 'string') {
        const text = rec.text;
        if (text && !text.startsWith('<')) parts.push(text);
      }
    }
    return parts.join('\n').trim() || null;
  }
  return null;
}

function titleFromMessages(messages: CliSessionMessage[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser?.text) {
    const line = firstUser.text.split('\n')[0]!.trim();
    if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  }
  return fallback;
}

async function readClaudeSessions(cwd: string): Promise<DiscoveredCliSession[]> {
  const dir = join(homedir(), '.claude', 'projects', encodeClaudeCwd(cwd));
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const out: DiscoveredCliSession[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const raw = await readFile(path, 'utf8');
    const messages = parseClaudeJsonl(raw);
    if (messages.length === 0) continue;
    const st = await stat(path);
    const sessionId = file.replace(/\.jsonl$/, '');
    out.push({
      provider: 'claude',
      storageKind: 'claude-jsonl',
      sessionId,
      title: titleFromMessages(messages, 'Claude chat'),
      cwd: normalizeCwd(cwd),
      mtime: st.mtimeMs,
      messageCount: messages.length,
      preview: messages.at(-1)?.text.slice(0, 120) ?? null,
      messages,
      sourceKey: `claude:${sessionId}`,
    });
  }
  return out;
}

async function readCursorAcpSessions(cwd: string): Promise<DiscoveredCliSession[]> {
  const root = join(homedir(), '.cursor', 'acp-sessions');
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }

  const out: DiscoveredCliSession[] = [];
  for (const id of dirs) {
    const sessionDir = join(root, id);
    const metaPath = join(sessionDir, 'meta.json');
    let meta: { cwd?: string; title?: string };
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8')) as { cwd?: string; title?: string };
    } catch {
      continue;
    }
    if (normalizeCwd(meta.cwd ?? '') !== normalizeCwd(cwd)) continue;
    let messages: CliSessionMessage[];
    try {
      messages = readCursorAcpStoreMessages(id);
    } catch (err) {
      if (err instanceof SessionNotFoundError) continue;
      throw err;
    }
    if (messages.length === 0) continue;
    const st = await stat(sessionDir);
    out.push({
      provider: 'cursor',
      storageKind: 'cursor-acp',
      sessionId: id,
      title: meta.title ?? titleFromMessages(messages, 'Cursor chat'),
      cwd: normalizeCwd(cwd),
      mtime: st.mtimeMs,
      messageCount: messages.length,
      preview: messages.at(-1)?.text.slice(0, 120) ?? null,
      messages,
      sourceKey: `cursor-acp:${id}`,
    });
  }
  return out;
}

async function readCursorIdeSessions(cwd: string): Promise<DiscoveredCliSession[]> {
  const dir = join(
    homedir(),
    '.cursor',
    'projects',
    encodeCursorProject(cwd),
    'agent-transcripts',
  );
  let files: string[] = [];
  async function walk(p: string) {
    let entries: string[];
    try {
      entries = await readdir(p);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(p, name);
      const st = await stat(full);
      if (st.isDirectory()) await walk(full);
      else if (name.endsWith('.jsonl')) files.push(full);
    }
  }
  await walk(dir);

  const out: DiscoveredCliSession[] = [];
  for (const path of files) {
    const raw = await readFile(path, 'utf8');
    const messages: CliSessionMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const role = row.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const msg = row.message as { content?: unknown } | undefined;
      const text = extractTextContent(msg?.content);
      if (text) messages.push({ role: role as 'user' | 'assistant', text });
    }
    if (messages.length === 0) continue;
    const st = await stat(path);
    const sessionId = path.split('/').pop()!.replace(/\.jsonl$/, '');
    out.push({
      provider: 'cursor',
      storageKind: 'cursor-ide',
      sessionId,
      title: titleFromMessages(messages, 'Cursor IDE chat'),
      cwd: normalizeCwd(cwd),
      mtime: st.mtimeMs,
      messageCount: messages.length,
      preview: messages.at(-1)?.text.slice(0, 120) ?? null,
      messages,
      sourceKey: `cursor-ide:${sessionId}`,
    });
  }
  return out;
}

async function readCodexSessions(cwd: string): Promise<DiscoveredCliSession[]> {
  const root = join(homedir(), '.codex', 'sessions');
  let files: string[] = [];
  async function walk(p: string) {
    let entries: string[];
    try {
      entries = await readdir(p);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(p, name);
      const st = await stat(full);
      if (st.isDirectory()) await walk(full);
      else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) files.push(full);
    }
  }
  await walk(root);

  const out: DiscoveredCliSession[] = [];
  const needle = normalizeCwd(cwd);
  for (const path of files) {
    const head = await readFile(path, 'utf8').then((t) => t.slice(0, 30_000));
    if (!head.includes(needle)) continue;
    const raw = await readFile(path, 'utf8');
    const messages: CliSessionMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (row.type === 'user_message' && typeof row.message === 'string') {
        messages.push({ role: 'user', text: row.message });
      } else if (row.type === 'assistant_message' && typeof row.message === 'string') {
        messages.push({ role: 'assistant', text: row.message });
      }
    }
    if (messages.length === 0) continue;
    const st = await stat(path);
    const sessionId = path.split('/').pop()!.replace(/\.jsonl$/, '');
    out.push({
      provider: 'codex',
      storageKind: 'codex-jsonl',
      sessionId,
      title: titleFromMessages(messages, 'Codex chat'),
      cwd: needle,
      mtime: st.mtimeMs,
      messageCount: messages.length,
      preview: messages.at(-1)?.text.slice(0, 120) ?? null,
      messages,
      sourceKey: `codex:${sessionId}`,
    });
  }
  return out;
}

export async function probeCliSessions(cwd: string): Promise<DiscoveredCliSession[]> {
  const normalized = normalizeCwd(cwd);
  const batches = await Promise.all([
    readClaudeSessions(normalized),
    readCursorAcpSessions(normalized),
    readCursorIdeSessions(normalized),
    readCodexSessions(normalized),
  ]);
  return batches
    .flat()
    .sort((a, b) => b.mtime - a.mtime);
}
