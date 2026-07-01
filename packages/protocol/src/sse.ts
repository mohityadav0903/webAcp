import { z } from 'zod';
import { modelInfoSchema } from './schemas.js';

export const sseEventNames = [
  'thread',
  'config',
  'text',
  'thought',
  'tool_call',
  'tool_result',
  'error',
  'done',
  'ping',
] as const;
export type SseEventName = (typeof sseEventNames)[number];

export const sseThreadSchema = z.object({
  threadId: z.string(),
});

export const sseConfigSchema = z.object({
  models: z.array(modelInfoSchema).default([]),
  currentModel: z.string().nullable().optional(),
});

export const sseTextSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
});

export const sseThoughtSchema = z.object({
  type: z.literal('thought'),
  content: z.string(),
});

export const sseToolCallSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()).default({}),
});

export const sseToolResultPayloadSchema = z.object({
  success: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export const sseToolResultSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string(),
  name: z.string().optional(),
  result: sseToolResultPayloadSchema.optional(),
});

export const sseErrorSchema = z.object({
  message: z.string(),
});

export const sseDoneSchema = z.object({}).passthrough();

const ssePayloadSchemas = {
  thread: sseThreadSchema,
  config: sseConfigSchema,
  text: sseTextSchema,
  thought: sseThoughtSchema,
  tool_call: sseToolCallSchema,
  tool_result: sseToolResultSchema,
  error: sseErrorSchema,
  done: sseDoneSchema,
  ping: z.object({}).passthrough(),
} as const satisfies Record<SseEventName, z.ZodTypeAny>;

export type SsePayloadMap = {
  [K in SseEventName]: z.infer<(typeof ssePayloadSchemas)[K]>;
};

export type SseChatEvent = {
  [K in SseEventName]: { event: K; data: SsePayloadMap[K] };
}[SseEventName];

export function isSseEventName(value: string): value is SseEventName {
  return (sseEventNames as readonly string[]).includes(value);
}

export function parseSsePayload<E extends SseEventName>(
  event: E,
  raw: unknown,
): SsePayloadMap[E] | null {
  const result = ssePayloadSchemas[event].safeParse(raw);
  return result.success ? (result.data as SsePayloadMap[E]) : null;
}
