import { isAbsolute, resolve } from 'node:path';
import type { ToolContext } from '@webacp/tools';

export function workspaceRoot(ctx: ToolContext): string {
  return typeof ctx.workspaceCwd === 'string' ? ctx.workspaceCwd : process.cwd();
}

/** Resolve a workspace-relative or absolute path for local FS operations. */
export function resolveFsPath(path: string, ctx: ToolContext): string {
  if (isAbsolute(path)) return resolve(path);
  return resolve(workspaceRoot(ctx), path);
}
