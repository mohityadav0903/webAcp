import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export type ToolRuntime = 'server' | 'local';

/** Context passed to a tool handler at execution time. */
export interface ToolContext {
  /** Pack the tool belongs to. */
  pack: string;
  /** Arbitrary request-scoped values supplied by the host. */
  [key: string]: unknown;
}

export interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description?: string;
  input: I;
  handler: (args: z.infer<I>, ctx: ToolContext) => Promise<unknown> | unknown;
}

/** A tool definition with an erased input type, for storage in packs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;

export interface ToolPack {
  name: string;
  runtime: ToolRuntime;
  description?: string;
  tools: AnyToolDef[];
}

export function defineTool<I extends z.ZodTypeAny>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

export function defineToolPack(def: ToolPack): ToolPack {
  return def;
}

/** Flatten packs into a name -> { pack, tool } lookup. */
export function indexTools(packs: ToolPack[]): Map<string, { pack: ToolPack; tool: AnyToolDef }> {
  const map = new Map<string, { pack: ToolPack; tool: AnyToolDef }>();
  for (const pack of packs) {
    for (const tool of pack.tools) {
      map.set(tool.name, { pack, tool });
    }
  }
  return map;
}

/** Executor signature: resolve a tool call to a result value. */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Build an executor that runs each pack's handler in-process. */
export function packsExecutor(packs: ToolPack[]): ToolExecutor {
  const index = indexTools(packs);
  return async (toolName, args) => {
    const entry = index.get(toolName);
    if (!entry) throw new Error(`Unknown tool: ${toolName}`);
    const parsed = entry.tool.input.parse(args);
    return entry.tool.handler(parsed, { pack: entry.pack.name });
  };
}

function inputShape(input: z.ZodTypeAny): z.ZodRawShape {
  if (input instanceof z.ZodObject) return input.shape as z.ZodRawShape;
  return {};
}

export interface BuildMcpServerOptions {
  name: string;
  version?: string;
  packs: ToolPack[];
  /** How to resolve a tool call (run handler in-process, or route elsewhere). */
  execute: ToolExecutor;
}

/** Build an MCP server exposing all tools across the given packs. */
export function buildMcpServer(opts: BuildMcpServerOptions): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version ?? '0.0.1' });

  for (const pack of opts.packs) {
    for (const tool of pack.tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description ?? `${pack.name}.${tool.name}`,
          inputSchema: inputShape(tool.input),
        },
        async (args: Record<string, unknown>) => {
          const result = await opts.execute(tool.name, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        },
      );
    }
  }

  return server;
}

/** Handle a single stateless MCP HTTP request against a fresh server instance. */
export async function handleMcpHttpRequest(
  req: Request,
  factory: () => McpServer,
): Promise<Response> {
  const server = factory();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { z };
