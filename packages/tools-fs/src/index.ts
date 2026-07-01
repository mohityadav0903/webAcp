import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { defineTool, defineToolPack, z, type ToolContext, type ToolPack } from '@webacp/tools';
import { resolveFsPath, workspaceRoot } from './path.js';

const readFileInput = z.object({
  path: z.string().describe('Workspace-relative file path (e.g. .webacp/uploads/…/file.md)'),
  offset: z.number().int().min(1).optional().describe('Start line (1-based)'),
  limit: z.number().int().min(1).optional().describe('Max lines to read'),
});

const writeFileInput = z.object({
  path: z.string().describe('File path to write'),
  content: z.string().describe('Full file contents'),
});

const listDirInput = z.object({
  path: z.string().describe('Directory path'),
});

const globInput = z.object({
  pattern: z.string().describe('Glob/path pattern'),
  cwd: z.string().optional().describe('Base directory'),
});

const grepInput = z.object({
  pattern: z.string().describe('Regex pattern'),
  path: z.string().describe('File or directory to search'),
  glob: z.string().optional().describe('Filter files by glob'),
});

const statInput = z.object({
  path: z.string().describe('File or directory path'),
});

const executeInput = z.object({
  command: z.string().describe('Shell command'),
  cwd: z.string().optional().describe('Working directory'),
  timeoutMs: z.number().int().min(1000).max(300_000).optional().describe('Timeout in ms'),
});

const editFileInput = z.object({
  path: z.string().describe('File path to edit'),
  old_string: z.string().describe('Exact text to replace (must be unique unless replace_all)'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z.boolean().optional().describe('Replace every occurrence'),
});

const batchEditInput = z.object({
  edits: z
    .array(editFileInput)
    .min(1)
    .max(50)
    .describe('Edits applied in order (same file may appear multiple times)'),
});

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

async function applySearchReplace(
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean | undefined,
  ctx: ToolContext,
): Promise<{ path: string; replacements: number }> {
  if (oldString === newString) {
    throw new Error('old_string and new_string must differ');
  }
  const resolved = resolveFsPath(path, ctx);
  const content = await readFile(resolved, 'utf8');
  const count = countOccurrences(content, oldString);
  if (count === 0) throw new Error(`old_string not found in ${path}`);
  if (!replaceAll && count > 1) {
    throw new Error(
      `old_string appears ${count} times in ${path}; set replace_all or use a more specific old_string`,
    );
  }
  const replacements = replaceAll ? count : 1;
  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await writeFile(resolved, updated, 'utf8');
  return { path, replacements };
}

function readProcessOutput(
  proc: ReturnType<typeof spawn>,
  includeStderr = false,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', () => {
      resolvePromise(includeStderr && stderr ? `${stdout}\n${stderr}` : stdout);
    });
  });
}

export const fsPack: ToolPack = defineToolPack({
  name: 'fs',
  runtime: 'local',
  description: 'Local filesystem and shell tools (run on the user machine).',
  tools: [
    defineTool({
      name: 'read_file',
      description: 'Read file contents from the local filesystem',
      input: readFileInput,
      handler: async ({ path, offset, limit }, ctx) => {
        const resolved = resolveFsPath(path, ctx);
        const content = await readFile(resolved, 'utf8');
        const lines = content.split('\n');
        const start = offset ? offset - 1 : 0;
        const end = limit ? start + limit : lines.length;
        const slice = lines.slice(start, end);
        return {
          path,
          content: slice.join('\n'),
          startLine: start + 1,
          endLine: start + slice.length,
          totalLines: lines.length,
        };
      },
    }),
    defineTool({
      name: 'write_file',
      description: 'Write content to a file on the local filesystem',
      input: writeFileInput,
      handler: async ({ path, content }, ctx) => {
        const resolved = resolveFsPath(path, ctx);
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content, 'utf8');
        return { path, bytesWritten: Buffer.byteLength(content, 'utf8') };
      },
    }),
    defineTool({
      name: 'edit_file',
      description:
        'Replace an exact string in a file (partial edit). Fails if old_string is missing or ambiguous.',
      input: editFileInput,
      handler: async (args, ctx) => applySearchReplace(args.path, args.old_string, args.new_string, args.replace_all, ctx),
    }),
    defineTool({
      name: 'search_replace',
      description: 'Alias for edit_file — exact string replace in a file',
      input: editFileInput,
      handler: async (args, ctx) => applySearchReplace(args.path, args.old_string, args.new_string, args.replace_all, ctx),
    }),
    defineTool({
      name: 'batch_edit',
      description: 'Apply multiple edit_file operations in order across one or more files',
      input: batchEditInput,
      handler: async ({ edits }, ctx) => {
        const results: Array<{ path: string; replacements: number }> = [];
        for (const edit of edits) {
          results.push(
            await applySearchReplace(edit.path, edit.old_string, edit.new_string, edit.replace_all, ctx),
          );
        }
        return { edits: results, totalReplacements: results.reduce((n, r) => n + r.replacements, 0) };
      },
    }),
    defineTool({
      name: 'list_dir',
      description: 'List directory entries',
      input: listDirInput,
      handler: async ({ path }, ctx) => {
        const resolved = resolveFsPath(path, ctx);
        const entries = await readdir(resolved, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
        }));
      },
    }),
    defineTool({
      name: 'glob',
      description: 'Find files matching a glob pattern',
      input: globInput,
      handler: async ({ pattern, cwd }, ctx) => {
        const base = cwd ? resolveFsPath(cwd, ctx) : workspaceRoot(ctx);
        const proc = spawn(
          'bash',
          ['-lc', `find '${base.replace(/'/g, "'\\''")}' -path '${pattern}' 2>/dev/null | head -200`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const stdout = await readProcessOutput(proc);
        return { matches: stdout.trim().split('\n').filter(Boolean) };
      },
    }),
    defineTool({
      name: 'grep',
      description: 'Search file contents with a regex pattern',
      input: grepInput,
      handler: async ({ pattern, path, glob: fileGlob }, ctx) => {
        const resolved = resolveFsPath(path, ctx);
        const globArg = fileGlob ? `--glob '${fileGlob}'` : '';
        const proc = spawn(
          'bash',
          [
            '-lc',
            `rg -n ${globArg} '${pattern.replace(/'/g, "'\\''")}' '${resolved}' 2>/dev/null | head -200`,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const stdout = await readProcessOutput(proc);
        return { matches: stdout.trim().split('\n').filter(Boolean) };
      },
    }),
    defineTool({
      name: 'stat',
      description: 'Get file or directory metadata',
      input: statInput,
      handler: async ({ path }, ctx) => {
        const resolved = resolveFsPath(path, ctx);
        const info = await stat(resolved);
        return {
          path,
          size: info.size,
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          modified: info.mtime.toISOString(),
          created: info.birthtime.toISOString(),
        };
      },
    }),
    defineTool({
      name: 'execute',
      description: 'Run a shell command on the local machine',
      input: executeInput,
      handler: async ({ command, cwd, timeoutMs }, ctx) => {
        const proc = spawn('bash', ['-lc', command], {
          cwd: cwd ? resolveFsPath(cwd, ctx) : workspaceRoot(ctx),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timeout = timeoutMs ?? 60_000;
        const result = await Promise.race([
          readProcessOutput(proc, true),
          new Promise<string>((_, reject) =>
            setTimeout(() => {
              proc.kill('SIGTERM');
              reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout),
          ),
        ]);
        return { exitCode: proc.exitCode ?? 0, output: result };
      },
    }),
  ],
});

export const fsToolPacks: ToolPack[] = [fsPack];
