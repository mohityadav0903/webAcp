import { z } from 'zod';
import { acpProviderIds } from './schemas.js';

export const cliSessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  text: z.string(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
});
export type CliSessionMessage = z.infer<typeof cliSessionMessageSchema>;

export const cliSessionStorageKindSchema = z.enum([
  'claude-jsonl',
  'cursor-acp',
  'cursor-ide',
  'codex-jsonl',
]);
export type CliSessionStorageKind = z.infer<typeof cliSessionStorageKindSchema>;

export const discoveredCliSessionSchema = z.object({
  provider: z.enum(acpProviderIds),
  storageKind: cliSessionStorageKindSchema,
  sessionId: z.string(),
  title: z.string().nullable(),
  cwd: z.string(),
  mtime: z.number(),
  messageCount: z.number(),
  preview: z.string().nullable(),
  messages: z.array(cliSessionMessageSchema),
  sourceKey: z.string(),
});
export type DiscoveredCliSession = z.infer<typeof discoveredCliSessionSchema>;

export const cliSessionsResponseSchema = z.object({
  cwd: z.string(),
  sessions: z.array(discoveredCliSessionSchema),
});
export type CliSessionsResponse = z.infer<typeof cliSessionsResponseSchema>;

export const importCliSessionsBodySchema = z.object({
  cwd: z.string(),
  sessions: z.array(discoveredCliSessionSchema),
});
export type ImportCliSessionsBody = z.infer<typeof importCliSessionsBodySchema>;

export const importCliSessionsResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  threadIds: z.array(z.string()),
});
export type ImportCliSessionsResponse = z.infer<typeof importCliSessionsResponseSchema>;

export const threadExportFormatSchema = z.enum(['markdown', 'json']);
export type ThreadExportFormat = z.infer<typeof threadExportFormatSchema>;

export const threadExportResponseSchema = z.object({
  format: threadExportFormatSchema,
  filename: z.string(),
  content: z.string(),
});
export type ThreadExportResponse = z.infer<typeof threadExportResponseSchema>;

export const casrStatusSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable().optional(),
});
export type CasrStatus = z.infer<typeof casrStatusSchema>;

export const casrConvertBodySchema = z.object({
  sessionId: z.string(),
  targetProvider: z.enum(acpProviderIds),
  sourceProvider: z.enum(acpProviderIds).optional(),
});
export type CasrConvertBody = z.infer<typeof casrConvertBodySchema>;

export const casrConvertResponseSchema = z.object({
  ok: z.boolean(),
  resumeCommand: z.string().optional(),
  newSessionId: z.string().optional(),
  message: z.string().optional(),
  raw: z.unknown().optional(),
});
export type CasrConvertResponse = z.infer<typeof casrConvertResponseSchema>;
