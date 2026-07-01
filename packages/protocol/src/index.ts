import { z } from 'zod';
import { contentBlockSchema } from './content.js';
import {
  uploadMaterializedSchema,
  uploadMaterializeSchema,
} from './uploads.js';
import { historyTurnSchema, modelInfoSchema } from './schemas.js';

export * from './constants.js';
export * from './urls.js';
export * from './roles.js';
export * from './schemas.js';
export * from './sse.js';
export * from './api.js';
export * from './auth.js';
export * from './content.js';
export * from './setup.js';
export * from './cli-sessions.js';
export * from './uploads.js';

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export const pairRequestSchema = z.object({
  type: z.literal('pair.request'),
  token: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const pairReconnectSchema = z.object({
  type: z.literal('pair.reconnect'),
  agentId: z.string().min(1),
  secret: z.string().min(1),
  agentName: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const pairOkSchema = z.object({
  type: z.literal('pair.ok'),
  agentId: z.string(),
  webUrl: z.string().url(),
  secret: z.string().optional(),
});

export const pairErrorSchema = z.object({
  type: z.literal('pair.error'),
  message: z.string(),
});

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const pingSchema = z.object({ type: z.literal('ping') });
export const pongSchema = z.object({ type: z.literal('pong') });

// ---------------------------------------------------------------------------
// Generic tool routing (web -> agent execution on the user machine)
// ---------------------------------------------------------------------------

export const toolCallSchema = z.object({
  type: z.literal('tool.call'),
  id: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
});

export const toolResultSchema = z.object({
  type: z.literal('tool.result'),
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// MCP server descriptors passed through to the ACP agent
// ---------------------------------------------------------------------------

export const mcpServerRefSchema = z.object({
  name: z.string(),
  type: z.enum(['http', 'sse']).default('http'),
  url: z.string().url(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

// ---------------------------------------------------------------------------
// Chat (agent WS)
// ---------------------------------------------------------------------------

export const chatStartSchema = z.object({
  type: z.literal('chat.start'),
  sessionId: z.string(),
  threadId: z.string(),
  /** @deprecated Use `blocks`. Kept for preview / thread titles. */
  message: z.string().optional(),
  blocks: z.array(contentBlockSchema).optional(),
  mcpServers: z.array(mcpServerRefSchema).default([]),
  provider: z.string().optional(),
  model: z.string().optional(),
  acpSessionId: z.string().nullish(),
  history: z.array(historyTurnSchema).optional(),
});

export const chatAbortSchema = z.object({
  type: z.literal('chat.abort'),
  sessionId: z.string(),
});

export const setModelSchema = z.object({
  type: z.literal('session.set_model'),
  threadId: z.string(),
  value: z.string(),
});

export const acpEventSchema = z.object({
  type: z.literal('acp.event'),
  sessionId: z.string(),
  sseEvent: z.string(),
  data: z.unknown(),
});

export const chatDoneSchema = z.object({
  type: z.literal('chat.done'),
  sessionId: z.string(),
});

export const chatErrorSchema = z.object({
  type: z.literal('chat.error'),
  sessionId: z.string(),
  message: z.string(),
});

export const sessionConfigSchema = z.object({
  type: z.literal('session.config'),
  threadId: z.string(),
  models: z.array(modelInfoSchema).default([]),
  currentModel: z.string().nullable().optional(),
});

export const sessionBoundSchema = z.object({
  type: z.literal('session.bound'),
  threadId: z.string(),
  provider: z.string(),
  acpSessionId: z.string(),
});

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

export const agentMessageSchema = z.discriminatedUnion('type', [
  pairRequestSchema,
  pairReconnectSchema,
  pingSchema,
  toolResultSchema,
  uploadMaterializedSchema,
  acpEventSchema,
  chatDoneSchema,
  chatErrorSchema,
  sessionConfigSchema,
  sessionBoundSchema,
]);

export const webMessageSchema = z.discriminatedUnion('type', [
  pairOkSchema,
  pairErrorSchema,
  pongSchema,
  toolCallSchema,
  uploadMaterializeSchema,
  chatStartSchema,
  chatAbortSchema,
  setModelSchema,
]);

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PairReconnect = z.infer<typeof pairReconnectSchema>;
export type PairOk = z.infer<typeof pairOkSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type McpServerRef = z.infer<typeof mcpServerRefSchema>;
export type ChatStart = z.infer<typeof chatStartSchema>;
export type ChatAbort = z.infer<typeof chatAbortSchema>;
export type SetModel = z.infer<typeof setModelSchema>;
export type AcpEvent = z.infer<typeof acpEventSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type { HistoryTurn } from './schemas.js';
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type SessionBound = z.infer<typeof sessionBoundSchema>;
export type UploadMaterialize = z.infer<typeof uploadMaterializeSchema>;
export type UploadMaterialized = z.infer<typeof uploadMaterializedSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type WebMessage = z.infer<typeof webMessageSchema>;

export function parseAgentMessage(raw: unknown): AgentMessage {
  return agentMessageSchema.parse(raw);
}

export function parseWebMessage(raw: unknown): WebMessage {
  return webMessageSchema.parse(raw);
}
